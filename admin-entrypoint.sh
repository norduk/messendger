#!/bin/bash
# Substitute environment variables in main.js.template
envsubst '${ADMIN_API_KEY}' < /usr/share/nginx/html/main.js.template > /usr/share/nginx/html/main.js

# Start nginx
exec nginx -g "daemon off;"
