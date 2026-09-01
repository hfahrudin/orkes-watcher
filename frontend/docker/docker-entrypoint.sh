#!/bin/sh
set -e

# Regenerate env-config.js from the real environment every time the container starts —
# this is what makes API_URL a runtime setting instead of something frozen into the image
# at `docker build` time. Changing it in .env and running `docker compose up -d` (no
# --build) is enough to take effect.
envsubst '${API_URL}' < /usr/share/nginx/html/env-config.template.js > /usr/share/nginx/html/env-config.js

exec nginx -g 'daemon off;'
