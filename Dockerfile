FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
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
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY api ./api

EXPOSE 1338

CMD ["node", "dist/app/index.js"]
