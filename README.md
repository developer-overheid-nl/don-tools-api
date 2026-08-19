# DON Tools API

API voor de tools op developer.overheid.nl. De service verwerkt OpenAPI- en Arazzo-documenten en biedt endpoints voor conversie, bundling, validatie, generatie en Postman-export.

## Vereisten

- Node.js 22 of nieuwer
- npm 11 of nieuwer

Gebruik `npm install` voor lokale installaties. De ADR ruleset is een git-dependency die build-stappen nodig heeft tijdens installatie.

## Installatie

```sh
npm install
```

## Lokaal draaien

```sh
npm start
```

De API luistert standaard op poort `1338`.

Voor mock-responses:

```sh
npm run start-mock
```

## Testen en linten

```sh
npm test
npm run lint
```

## Docker

```sh
docker build -t don-tools-api .
docker run --rm -p 1338:1338 don-tools-api
```

## Configuratie

Secrets horen niet in git. Maak lokaal een `.env` op basis van `.env.example` als je de Keycloak-clientregistratie wilt testen:

```sh
cp .env.example .env
```

De meeste endpoints werken zonder extra configuratie. `POST /v1/auth/clients` gebruikt Keycloak en heeft deze waarden nodig:

- `AUTH_CLIENT_ID`
- `AUTH_CLIENT_SECRET`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`

## Logging

De API schrijft gestructureerde JSON-logs naar stdout. Stel het minimale niveau in met `LOG_LEVEL`; de standaardwaarde is `info`.

Elk HTTP-request krijgt een `X-Request-ID`. Een aangeleverde waarde wordt hergebruikt, anders genereert de API er zelf een. Requestlogs en requestgebonden applicatielogs bevatten dit ID. De requestlogs bevatten methode, pad, operationId, status en doorlooptijd, maar geen requestbody, querystring, upstream-pad of gevoelige headers. Ook een afgebroken verbinding levert precies één requestrecord op, met `aborted: true`. De applicatie maakt geen lokale logbestanden aan.

Bij `SIGTERM` en `SIGINT` probeert de server open verbindingen eerst netjes af te handelen. Na `SHUTDOWN_GRACE_PERIOD_MS` (standaard 10000 ms) sluit de server resterende verbindingen geforceerd en schrijft hij daarvan een waarschuwing.

## Endpoints

- `GET /v1/openapi.json`
- `POST /v1/oas/convert`
- `POST /v1/oas/bundle`
- `POST /v1/oas/generate`
- `POST /v1/oas/validate`
- `POST /v1/oas/postman`
- `POST /v1/arazzo/markdown`
- `POST /v1/arazzo/mermaid`
- `POST /v1/auth/clients`

Zie [api/openapi.json](api/openapi.json) voor het volledige contract.
