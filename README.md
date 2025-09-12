# API registratie

API van het API register (apis.developer.overheid.nl)

## Overview

- API version: 1.0.0
- Build date: 2025-04-02
- Generator version: 7.7.0

## Lokaal draaien

1. Start de afhankelijkheden:

   ```bash
   docker compose up -d
   ```

2. Start de server:

   ```bash
   go run cmd/main.go
   ```

De API luistert standaard op poort **1337**.

### Bruno collectie genereren

Converteer een OpenAPI specificatie (via URL) naar een [Bruno](https://docs.usebruno.com/converters/openapi-to-bruno) collectie (ZIP):

```
GET /v1/tools/bruno/convert?oasUrl=https://example.com/openapi.yaml

Response: `application/zip` met `Content-Disposition: attachment`
```

### Postman collectie genereren

Converteer een OpenAPI specificatie (via URL) naar een Postman Collection (JSON):

```
GET /v1/tools/postman/convert?oasUrl=https://example.com/openapi.yaml

Response: `application/json` met `Content-Disposition: attachment`
```

## Database en pgAdmin

De applicatie gebruikt PostgreSQL. De docker-compose start automatisch een Postgres container met bovenstaande credentials.

Voor het beheren van de database kun je optioneel [pgAdmin](https://www.pgadmin.org/) gebruiken:

```bash
docker run --rm -p 5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=admin@example.com \
  -e PGADMIN_DEFAULT_PASSWORD=admin \
  dpage/pgadmin4
```

Navigeer naar `http://localhost:5050`, voeg een nieuwe server toe en gebruik de waarden:

- Host: `localhost`
- Port: `5432`
- Username: `don`
- Password: `don`
- Database: `don_v1`
