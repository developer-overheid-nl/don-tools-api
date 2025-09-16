# DON Tools API

Tools API voor developer.overheid.nl. Biedt conversies (OpenAPI → Bruno/Postman) en linting (ADR 2.1 ruleset), plus een generieke harvester die index.json-bronnen kan inlezen en APIs registreert via een extern endpoint.

## Run lokaal

- Vereisten (lokaal runnen zonder Docker):
  - Go 1.24+
  - Node.js + npm met CLI tools: `@stoplight/spectral-cli`, `openapi-to-bruno`, `openapi-to-postmanv2`
    - Alternatief: gebruik de Dockerfile; daarin worden deze tools geïnstalleerd.

1) Optioneel: zet env-variabelen in `.env` (zie Configuratie).

2) Start de server:

```bash
go run cmd/main.go
```

De API luistert op poort `1338`.

## Endpoints

- Bruno collectie genereren
  - `GET /v1/bruno/convert?oasUrl=https://example.com/openapi.yaml`
  - `POST /v1/bruno/convert` (body = OpenAPI JSON/YAML)
  - Response: `application/octet-stream` (ZIP) met `Content-Disposition: attachment`

- Postman collectie genereren
  - `GET /v1/postman/convert?oasUrl=https://example.com/openapi.yaml`
  - `POST /v1/postman/convert` (body = OpenAPI JSON/YAML)
  - Response: `application/json` met `Content-Disposition: attachment`

- Lint OpenAPI (ADR 2.1 ruleset)
  - `GET /v1/lint?oasUrl=https://example.com/openapi.yaml`
  - `POST /v1/lint` (body = OpenAPI JSON/YAML)
  - Response: JSON met lintresultaten + score

- OpenAPI documentatie
  - `GET /v1/openapi.json`

## Harvester (PDOK)

De harvester is op dit moment ingericht voor één bron (PDOK). De job bevat de bronconfiguratie als object en gebruikt env-variabelen voor de waarden die per omgeving verschillen.

- Bronconfiguratie (PDOK):
  - `indexUrl`: env `PDOK_INDEX_URL` (default `https://api.pdok.nl/index.json`)
  - `organisationUri`: env `PDOK_ORGANISATION_URI` (default `https://www.pdok.nl`)
  - `contact`: vast `{ name: "PDOK Support", url: "https://www.pdok.nl/support1", email: "support@pdok.nl" }`
  - `uiSuffix`: `ui/`, `oasPath`: `openapi.json`

- Payload naar register (`ApiPost`):
  - `{ "oasUrl": "...", "organisationUri": "...", "contact": { ... } }`

## Configuratie (env)

- Algemene
  - `API_VERSION` (default `1.0.0`)

- Harvester
  - `PDOK_REGISTER_ENDPOINT` (POST endpoint, verschilt per omgeving)
  - `HARVEST_ENABLED` of `PDOK_IMPORT_ENABLED` = `true` om scheduler te starten
  - `HARVEST_CRON` of `PDOK_IMPORT_CRON` (bijv. `@every 6h`)
  - `PDOK_INDEX_URL`, `PDOK_ORGANISATION_URI`

Plaats env in `.env`; deze wordt automatisch geladen door de app.

## Docker

Build en run met Docker (installeert benodigde CLI tools in het image):

```bash
docker build -t don-tools-api .
docker run --rm -p 1338:1338 \
  -e API_VERSION=1.0.0 \
  -e HARVEST_ENABLED=true \
  -e PDOK_REGISTER_ENDPOINT=https://register.example/v1/apis \
  -e PDOK_INDEX_URL=https://api.pdok.nl/index.json \
  -e PDOK_ORGANISATION_URI=https://www.pdok.nl \
  don-tools-api
```

De server luistert in de container op poort `1338`.
