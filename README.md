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
  - `POST /v1/bruno/convert`
  - Body (OasInput): één van
    - `{ "oasUrl": "https://example.com/openapi.yaml" }`
    - `{ "oasBody": "<stringified JSON of YAML>" }`
  - Response: `application/octet-stream` (ZIP) met `Content-Disposition: attachment`

- Postman collectie genereren
  - `POST /v1/postman/convert`
  - Body (OasInput): één van
    - `{ "oasUrl": "https://example.com/openapi.yaml" }`
    - `{ "oasBody": "<stringified JSON of YAML>" }`
  - Response: `application/json` met `Content-Disposition: attachment`

- Convert OpenAPI versie 3.0 ⇆ 3.1
  - `POST /v1/oas/convert-version`
  - Body (OasInput): één van
    - `{ "oasUrl": "https://example.com/openapi.yaml" }`
    - `{ "oasBody": "<stringified JSON of YAML>" }`
  - Response: OpenAPI document (JSON of YAML) met aangepaste versie

- Lint OpenAPI (ADR 2.1 ruleset)
  - `POST /v1/lint`
  - Body (OasInput): één van
    - `{ "oasUrl": "https://example.com/openapi.yaml" }`
    - `{ "oasBody": "<stringified JSON of YAML>" }`
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

## Docker

Build en run met Docker (installeert benodigde CLI tools in het image):

```bash
docker build -t don-tools-api .
docker run --rm -p 1338:1338 \
  -e PDOK_REGISTER_ENDPOINT=https://register.example/v1/apis \
  -e AUTH_TOKEN_URL=https://auth.don.apps.digilab.network/realms/don/protocol/openid-connect/token \
  -e AUTH_CLIENT_ID=don-admin-client \
  -e AUTH_CLIENT_SECRET=... \
  don-tools-api
```

De server luistert in de container op poort `1338`.
