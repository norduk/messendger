#!/bin/sh
sed "s|ENV_API_KEY|${ADMIN_API_KEY}|g" /usr/share/nginx/html/index.html.template > /usr/share/nginx/html/index.html
