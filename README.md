# DON Tools API v1

HTTP API voor de tools op `developer.overheid.nl`.

Deze repository bevat de API-laag voor versie 1 van de Tools API: routing, OpenAPI-validatie,
response headers, foutafhandeling en de koppeling naar de daadwerkelijke businesslogica. Die
businesslogica staat in `@developer-overheid-nl/don-tools` en wordt los beheerd in `don-tools`.

## Wat zit hierin?

- NestJS met Fastify als HTTP runtime
- OpenAPI request- en responsevalidatie via `openapi-backend`
- Gegenereerde controller- en modelbestanden op basis van `api/openapi.json`
- Implementatie-adapter in `implementation/tools-api.service.ts`
- Docker image voor deployment op poort `1338`

## Endpoints

De OpenAPI-specificatie staat in `api/openapi.json`.

Bij runtime wordt deze ook beschikbaar gemaakt op:

- `GET /openapi.json`

Belangrijkste tools-endpoints:

- `POST /v1/oas/validate`
- `POST /v1/oas/convert`
- `POST /v1/oas/bundle`
- `POST /v1/oas/generate`
- `POST /v1/oas/postman`
- `POST /v1/arazzo/markdown`
- `POST /v1/arazzo/mermaid`
- `POST /v1/auth/clients`

## Lokaal ontwikkelen

Vereisten:

- Node.js 22+
- npm

Installeren en starten:

```sh
npm install
npm run dev
```

De API luistert standaard op `http://localhost:1338`.

Handige scripts:

```sh
npm run build      # TypeScript build naar dist/
npm start          # start de gebouwde app
npm test           # Vitest tests
npm run lint       # Biome lint
npm run typecheck  # TypeScript typecheck zonder output
```

## Omgevingsvariabelen

- `PORT`: poort waarop de API luistert, standaard `1338`
- `HOST`: host waarop Fastify bindt, standaard `0.0.0.0`
- `OPENAPI_MOCK`: zet mock responses aan met `true`, `1`, `yes` of `on`

Mock mode kan ook direct via:

```sh
npm run dev-mock
```

## Relatie met `don-tools`

`don-tools-api` is de v1 HTTP-adapter. De herbruikbare logica zit in
`@developer-overheid-nl/don-tools`.

Zodra de logic package op npm gepubliceerd is, pin deze API op een expliciete packageversie:

```sh
npm install @developer-overheid-nl/don-tools@<version>
```

Gebruik liever een npm-versie dan een GitHub dependency in CI/CD. Dat voorkomt dat builds afhankelijk
worden van GitHub SSH keys of repository tokens.

## Docker

Build lokaal:

```sh
docker build -t don-tools-api .
```

Run lokaal:

```sh
docker run --rm -p 1338:1338 don-tools-api
```

## Checks voor een wijziging

Draai minimaal:

```sh
npm run lint
npm run build
npm test
```

Bij wijzigingen aan `api/openapi.json` of gegenereerde bestanden: controleer ook of
`controllers/`, `models/` en `api/` nog overeenkomen met het contract.

## Repository-indeling

```text
api/             OpenAPI contract en gegenereerde API interfaces
app/             NestJS/Fastify bootstrap en OpenAPI middleware
controllers/     Gegenereerde NestJS controllers
decorators/      Gegenereerde request decorators
implementation/  Handgeschreven adapter naar don-tools
models/          Gegenereerde request/response modellen
test/            Vitest tests
```
