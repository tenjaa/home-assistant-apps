# tiny-TRMNL

A tiny [TRMNL](https://trmnl.com/) webserver for Home Assistant.
No database (maybe a tiny database like SQLite in the future), no complexity (maybe a little bit of complexity in the future).

## Config API

Screen definitions are stored in `screens.json`.

- `POST /api/config/screens`
- Accepts either a raw JSON array of screen configs or an object with a `screenConfigs` property.
- Validates the payload, stores it in `screens.json`, and reloads the active screens without restarting the app.

**Disclaimer:** This project is not affiliated with, endorsed by, or associated with [TRMNL](https://trmnl.com/). It is an independent implementation.
