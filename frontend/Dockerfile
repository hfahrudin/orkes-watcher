FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Template + entrypoint for runtime config (API_URL) — see docker/ and lib/api.ts. This is
# what lets `docker compose up -d` (no --build) pick up a changed API_URL: the image itself
# has no backend URL baked into it anywhere.
COPY docker/env-config.template.js /usr/share/nginx/html/env-config.template.js
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV API_URL=http://localhost:8000
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
