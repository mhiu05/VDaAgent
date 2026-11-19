# syntax=docker/dockerfile:1
# frontend: Vite build served by nginx on :80 with SPA fallback (doc 16).
# Build context: ./frontend. Node 24 matches frontend/package.json "engines".
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Sources on top of the installed deps; compose.test.yaml runs Vitest from this stage.
FROM deps AS source
COPY . ./

FROM source AS builder
# mock | hybrid | api (doc 14c "Runtime selection"). The image is the deployed app, so it
# defaults to the real API like compose does; build with VITE_SERVICE_MODE=mock for the demo UI.
ARG VITE_SERVICE_MODE=hybrid
ENV VITE_SERVICE_MODE=${VITE_SERVICE_MODE}
RUN npm run build

FROM nginx:alpine AS runner
RUN printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    server_name localhost;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '    location = /demo-credentials.json { return 404; }' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '    error_page 500 502 503 504 /50x.html;' \
    '    location = /50x.html {' \
    '        root /usr/share/nginx/html;' \
    '    }' \
    '}' > /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
