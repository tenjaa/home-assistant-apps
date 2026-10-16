const $ = (id) => document.getElementById(id);
const form = $('form');
let screens = [];
let savedIds = new Set();
let selected = -1;
let calendars = [];
let dirty = false;
let busy = false;
let previewVersion = 0;

function message(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle('error', error);
}

async function request(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return response;
}

function changed() {
  dirty = true;
  $('save').disabled = busy;
  message($('status'), 'Unsaved changes');
  invalidatePreview();
}

function invalidatePreview() {
  previewVersion++;
  $('preview').hidden = true;
  $('preview-size').style.height = '0';
  message($('preview-status'), 'Select Update preview to render this screen.');
  $('endpoints').hidden = true;
}

function renderList() {
  $('screens').replaceChildren();
  $('empty').hidden = screens.length > 0;
  screens.forEach((screen, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = busy;
    button.setAttribute('aria-current', String(index === selected));
    button.textContent = screen.screenId || 'Untitled screen';
    const detail = document.createElement('small');
    detail.textContent = `${screen.pluginId} / ${screen.screenSize.width} x ${screen.screenSize.height}`;
    button.append(detail);
    button.addEventListener('click', () => selectScreen(index));
    $('screens').append(button);
  });
}

function pluginFields(screen) {
  const isWeather = screen.pluginId === 'weather';
  $('calendar-settings').hidden = screen.pluginId !== 'calendar';
  $('weather-settings').hidden = !isWeather;
  for (const name of ['locationName', 'latitude', 'longitude', 'timezone']) {
    form.elements.namedItem(name).disabled = !isWeather;
    form.elements.namedItem(name).required = isWeather && name !== 'timezone';
  }
}

function selectScreen(index) {
  selected = index;
  invalidatePreview();
  const screen = screens[index];
  $('editor').hidden = !screen;
  $('preview-panel').hidden = !screen;
  renderList();
  if (!screen) return;
  for (const name of ['screenId', 'pluginId', 'refresh']) {
    form.elements.namedItem(name).value = screen[name];
  }
  for (const name of ['width', 'height']) {
    form.elements.namedItem(name).value = screen.screenSize[name];
  }
  for (const name of ['locationName', 'latitude', 'longitude', 'timezone']) {
    form.elements.namedItem(name).value = screen.pluginConfig[name] ?? '';
  }
  pluginFields(screen);
  renderCalendars();
}

function renderCalendars() {
  $('calendars').replaceChildren();
  const screen = screens[selected];
  if (screen?.pluginId !== 'calendar') return;
  screen.pluginConfig.calendars.forEach((calendar, index) => {
    const row = document.createElement('div');
    row.className = 'calendar-row';
    const label = document.createElement('label');
    label.textContent = 'Calendar';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Calendar');
    select.add(new Option('Choose a calendar', ''));
    for (const available of calendars) {
      select.add(
        new Option(
          `${available.name} (${available.entity_id})`,
          available.entity_id,
        ),
      );
    }
    if (
      calendar.entity &&
      !calendars.some((item) => item.entity_id === calendar.entity)
    ) {
      select.add(
        new Option(`${calendar.entity} (configured)`, calendar.entity),
      );
    }
    select.add(new Option('Enter entity ID manually...', '__manual'));
    select.value = calendar.entity;
    select.required = true;
    label.append(select);
    const manualLabel = document.createElement('label');
    manualLabel.textContent = 'Calendar entity ID';
    manualLabel.hidden = true;
    const manual = document.createElement('input');
    manual.placeholder = 'calendar.family';
    manual.disabled = true;
    manualLabel.append(manual);
    select.addEventListener('change', () => {
      const isManual = select.value === '__manual';
      manualLabel.hidden = !isManual;
      manual.disabled = !isManual;
      manual.required = isManual;
      calendar.entity = isManual ? manual.value : select.value;
      changed();
    });
    manual.addEventListener('input', () => {
      calendar.entity = manual.value;
      changed();
    });
    const markerLabel = document.createElement('label');
    markerLabel.textContent = 'One-character label';
    const marker = document.createElement('input');
    marker.value = calendar.label;
    marker.minLength = 1;
    marker.maxLength = 1;
    marker.required = true;
    marker.addEventListener('input', () => {
      calendar.label = marker.value;
      changed();
    });
    markerLabel.append(marker);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove calendar';
    remove.addEventListener('click', () => {
      screen.pluginConfig.calendars.splice(index, 1);
      changed();
      renderCalendars();
    });
    row.append(label, manualLabel, markerLabel, remove);
    $('calendars').append(row);
  });
}

form.addEventListener('input', (event) => {
  const screen = screens[selected];
  const input = event.target;
  if (!screen || !input.name) return;
  const value = input.type === 'number' ? input.valueAsNumber : input.value;
  if (['width', 'height'].includes(input.name))
    screen.screenSize[input.name] = value;
  else if (
    ['locationName', 'latitude', 'longitude', 'timezone'].includes(input.name)
  ) {
    if (input.name === 'timezone' && !value)
      delete screen.pluginConfig.timezone;
    else screen.pluginConfig[input.name] = value;
  } else if (input.name === 'pluginId') {
    screen.pluginId = value;
    screen.pluginConfig =
      value === 'calendar'
        ? { calendars: [] }
        : value === 'weather'
          ? {
              locationName: 'Hannover, Germany',
              latitude: 52.3759,
              longitude: 9.732,
              timezone: 'Europe/Berlin',
            }
          : {};
    selectScreen(selected);
  } else screen[input.name] = value;
  changed();
  renderList();
});

$('add').addEventListener('click', () => {
  let number = screens.length + 1;
  while (screens.some((screen) => screen.screenId === `screen-${number}`))
    number++;
  screens.push({
    screenId: `screen-${number}`,
    pluginId: 'quote',
    refresh: 3600,
    screenSize: { width: 800, height: 480 },
    pluginConfig: {},
  });
  changed();
  selectScreen(screens.length - 1);
});
$('delete').addEventListener('click', () => {
  if (
    !confirm(
      `Delete "${screens[selected].screenId}"? This takes effect when you save.`,
    )
  )
    return;
  screens.splice(selected, 1);
  changed();
  selectScreen(Math.min(selected, screens.length - 1));
});
$('add-calendar').addEventListener('click', () => {
  screens[selected].pluginConfig.calendars.push({ entity: '', label: 'A' });
  changed();
  renderCalendars();
});

async function loadCalendars() {
  $('reload-calendars').disabled = true;
  message($('calendar-status'), 'Loading calendars...');
  try {
    const response = await request('api/config/calendars');
    calendars = (await response.json()).calendars;
    message(
      $('calendar-status'),
      calendars.length
        ? `${calendars.length} calendars available`
        : 'No calendars found. You can enter an entity ID manually.',
    );
    renderCalendars();
  } catch (error) {
    message(
      $('calendar-status'),
      `${error.message}. You can enter an entity ID manually or retry.`,
      true,
    );
  } finally {
    $('reload-calendars').disabled = false;
  }
}
$('reload-calendars').addEventListener('click', loadCalendars);

function resizePreview() {
  const screen = screens[selected];
  if (!screen || $('preview').hidden) return;
  const scale = Math.min(
    1,
    $('preview-container').clientWidth / screen.screenSize.width,
  );
  $('preview').style.width = `${screen.screenSize.width}px`;
  $('preview').style.height = `${screen.screenSize.height}px`;
  $('preview').style.transform = `scale(${scale})`;
  $('preview-size').style.height = `${screen.screenSize.height * scale}px`;
}
new ResizeObserver(resizePreview).observe($('preview-container'));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const version = ++previewVersion;
  const screen = structuredClone(screens[selected]);
  message($('preview-status'), 'Rendering preview...');
  try {
    const response = await request('api/config/preview', screen);
    const html = await response.text();
    if (version !== previewVersion) return;
    $('preview').srcdoc = html;
    $('preview').hidden = false;
    $('resolution').textContent =
      `${screen.screenSize.width} x ${screen.screenSize.height}`;
    message(
      $('preview-status'),
      'Preview of your current settings (not saved).',
    );
    resizePreview();
  } catch (error) {
    if (version === previewVersion)
      message($('preview-status'), error.message, true);
  }
});

function setBusy(value) {
  busy = value;
  $('fields').disabled = value;
  for (const id of ['add', 'delete', 'save']) $(id).disabled = value;
  renderList();
}

$('save').addEventListener('click', async () => {
  if (selected >= 0 && !form.reportValidity()) return;
  setBusy(true);
  message(
    $('status'),
    'Saving and generating display images. This may take a moment...',
  );
  try {
    const response = await request('api/config/screens', {
      screenConfigs: screens,
    });
    screens = (await response.json()).screenConfigs;
    savedIds = new Set(screens.map((screen) => screen.screenId));
    dirty = false;
    selectScreen(selected);
    message(
      $('status'),
      'All screens saved. Displays will receive the changes on their next request.',
    );
  } catch (error) {
    message($('status'), `Could not save: ${error.message}`, true);
  } finally {
    setBusy(false);
    $('save').disabled = !dirty;
    updateLinks();
  }
});

function updateLinks() {
  const screen = screens[selected];
  $('endpoints').hidden = !screen || dirty || !savedIds.has(screen.screenId);
  if (!screen) return;
  $('image-link').href = `api/image/${encodeURIComponent(screen.screenId)}`;
  $('html-link').href = `api/html/${encodeURIComponent(screen.screenId)}`;
}
$('screens').addEventListener('click', updateLinks);
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function initialize() {
  try {
    const response = await request('api/config/screens');
    screens = (await response.json()).screenConfigs;
    savedIds = new Set(screens.map((screen) => screen.screenId));
    $('workspace').hidden = false;
    selectScreen(screens.length ? 0 : -1);
    updateLinks();
    message($('status'), 'All changes saved');
    await loadCalendars();
  } catch (error) {
    message(
      $('status'),
      `Could not load screens: ${error.message}. Reload this page to retry.`,
      true,
    );
  }
}
initialize();
