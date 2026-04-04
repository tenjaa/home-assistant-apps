#!/usr/bin/env sh
set -eu

echo "[trmnl-entrypoint] Listing /data"
ls -la /data || true

echo "[trmnl-entrypoint] Printing /data/options.json"
cat /data/options.json || true

# Preserve normal container behavior when a command is provided.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "[trmnl-entrypoint] No default command found; exiting."
