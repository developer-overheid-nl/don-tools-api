FROM golang:latest

# Node.js + npm for npx-based tools used by services
RUN apt-get update && \
    apt-get install -y --no-install-recommends nodejs npm ca-certificates && \
    npm install -g openapi-to-bruno openapi-to-postmanv2 @stoplight/spectral-cli && \
    npm cache clean --force && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ENV GIN_MODE=release
RUN go build -o main ./cmd/main.go

EXPOSE 1338

CMD ["./main"]
