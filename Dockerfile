FROM node:lts-alpine AS runtime

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
