FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache git \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:"
RUN npm ci
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
RUN apk add --no-cache --virtual .git-deps git \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global url."https://github.com/".insteadOf "git@github.com:" \
  && npm ci --omit=dev \
  && apk del .git-deps
COPY --from=build /app/dist ./dist
COPY api ./api

EXPOSE 1338

CMD ["node", "dist/app/index.js"]
