FROM mcr.microsoft.com/playwright:v1.49.0-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc novnc websockify tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV DATA_DIR=/data PORT=3000 DISPLAY=:99
VOLUME /data
EXPOSE 3000 6080

COPY <<'EOF' /app/entry.sh
#!/bin/bash
set -e
mkdir -p /data/accounts
Xvfb :99 -screen 0 1280x900x24 &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
websockify --web=/usr/share/novnc 6080 localhost:5900 &
node dist/index.js
EOF
RUN chmod +x /app/entry.sh

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/app/entry.sh"]