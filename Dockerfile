# Build the SPA, then serve it with a minimal unprivileged nginx on port 8080, at /.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged runs as a non-root user (uid 101) and listens on 8080
FROM nginxinc/nginx-unprivileged:alpine
# pick up the security fixes released since the base image was built
USER root
RUN apk upgrade --no-cache
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
