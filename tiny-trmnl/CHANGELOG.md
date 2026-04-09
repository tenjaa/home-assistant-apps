<!-- https://developers.home-assistant.io/docs/add-ons/presentation#keeping-a-changelog -->

## 0.0.5

- Move screen definitions out of Home Assistant add-on options into `/data/screens.json`
- Create a demo `/data/screens.json` automatically on first run when none exists

## 0.0.4

- Fix add-on option validation by switching to the new `baseUrl`/`ha`/`screenConfigs` config structure
- Remove stale required `quotes` option from Home Assistant schema

## 0.0.3

- Don't crash if gathering data fails, just show an error message on the screen

## 0.0.2

- Support multiple different screens

## 0.0.1

- Initial release
