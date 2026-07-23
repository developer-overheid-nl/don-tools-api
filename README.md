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
