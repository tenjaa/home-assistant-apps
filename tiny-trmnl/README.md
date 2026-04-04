# tiny-trmnl
A very tiny trmnl webserver without any database or other complex needs

## Configuration

This project reads configuration from environment variables.

- `HOME_ASSISTANT_TOKEN` (required)
- `CALENDARS` (required JSON object)
- `HOME_ASSISTANT_BASE_URL` (optional, defaults to `http://homeassistant.local:8123`)

Example:

```zsh
export HOME_ASSISTANT_TOKEN='your-token'
export CALENDARS='{"N":{"entity":"calendar.name1"},"M":{"entity":"calendar.name2"}}'
export HOME_ASSISTANT_BASE_URL='http://homeassistant.local:8123'
```

