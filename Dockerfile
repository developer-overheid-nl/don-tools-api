# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=git_auth_token,required=false \
  apk add --no-cache git \
  && GIT_AUTH_TOKEN="$(cat /run/secrets/git_auth_token 2>/dev/null || true)" \
  && GIT_URL="https://github.com/" \
  && if [ -n "${GIT_AUTH_TOKEN}" ]; then GIT_URL="https://x-access-token:${GIT_AUTH_TOKEN}@github.com/"; fi \
  && git config --global --add "url.${GIT_URL}.insteadOf" "ssh://git@github.com/" \
  && git config --global --add "url.${GIT_URL}.insteadOf" "git@github.com:" \
  && npm ci \
  && rm -f ~/.gitconfig
COPY tsconfig.json ./
COPY api ./api
COPY controllers ./controllers
COPY decorators ./decorators
COPY models ./models
COPY implementation ./implementation
COPY app ./app
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=git_auth_token,required=false \
  apk add --no-cache --virtual .git-deps git \
  && GIT_AUTH_TOKEN="$(cat /run/secrets/git_auth_token 2>/dev/null || true)" \
  && GIT_URL="https://github.com/" \
  && if [ -n "${GIT_AUTH_TOKEN}" ]; then GIT_URL="https://x-access-token:${GIT_AUTH_TOKEN}@github.com/"; fi \
  && git config --global --add "url.${GIT_URL}.insteadOf" "ssh://git@github.com/" \
  && git config --global --add "url.${GIT_URL}.insteadOf" "git@github.com:" \
  && npm ci --omit=dev \
  && rm -f ~/.gitconfig \
  && apk del .git-deps
COPY --from=build /app/dist ./dist
COPY api ./api

EXPOSE 1338

CMD ["node", "dist/app/index.js"]
