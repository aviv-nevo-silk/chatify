#!/bin/sh
set -e

if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  echo "Generating self-signed SSL certificate..."
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
    -subj "/C=US/ST=State/L=City/O=Chatify/CN=localhost"
fi

echo "Chatify dev server starting on https://localhost:3001 (mapped from container :3000)"
echo "  - dev page:  https://localhost:3001/dev.html"
echo "  - taskpane:  https://localhost:3001/taskpane.html"
exec npm run dev
