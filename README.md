# DON Tools API v1

HTTP API voor de tools op `developer.overheid.nl`.

Deze repository bevat de API-laag voor versie 1 van de Tools API: routing, OpenAPI-validatie,
response headers, foutafhandeling en de koppeling naar de daadwerkelijke businesslogica. Die
businesslogica staat in `@developer-overheid-nl/don-tools` en wordt los beheerd in
`don-tools`.

## Wat zit hierin?

- NestJS met Fastify als HTTP runtime
- OpenAPI request- en responsevalidatie via `openapi-backend`
- Gegenereerde controller- en modelbestanden op basis van `api/openapi.yaml`
- Implementatie-adapter in `implementation/index.ts`
- Gestructureerde Pino-logging met veilige request-id's en één completion-log per request
- Docker image voor deployment op poort `1338`

## Endpoints

De gebundelde OpenAPI-specificatie staat in `api/openapi.yaml`.

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
npm run generate   # opnieuw genereren vanuit de live OAS
```

## Omgevingsvariabelen

- `PORT`: poort waarop de API luistert, standaard `1338`
- `HOST`: host waarop Fastify bindt, standaard `0.0.0.0`
- `LOG_LEVEL`: minimale Pino-loglevel, standaard `info`
- `SERVICE_NAME`: servicenaam in ieder logrecord, standaard `tools-api-v1`
- `OAS_FETCH_TIMEOUT_MS`: timeout voor externe specificaties, standaard `45000`
- `OPENAPI_MOCK`: zet mock responses aan met `true`, `1`, `yes` of `on`

Mock mode kan ook direct via:

```sh
npm run dev-mock
```

## Code genereren

`npm run generate` haalt de OAS op van
`https://api.developer.overheid.nl/tools/v1/openapi.json`. Het script:

- controleert en verwijdert vier identieke legacy-componentvelden op rootniveau;
- bundelt de OAS met een vastgezette Redocly-versie;
- valideert de bundel met DON ADR 2.1;
- genereert NestJS/Fastify met een vastgezette templatecommit en OpenAPI Generator-versie;
- vervangt alleen de gegenereerde mappen en laat `implementation/` ongemoeid.

De enige projectspecifieke code na generatie is de adapter in `implementation/index.ts`.
Die roept de acht functies uit `@developer-overheid-nl/don-tools` aan.

Voor generatie zijn Node.js 22+, npm, Git en een Java-runtime nodig.

## Relatie met `don-tools`

`don-tools-api` is alleen de HTTP-adapter. De herbruikbare logica zit in de
apart gepubliceerde package:

```sh
npm install @developer-overheid-nl/don-tools@0.0.3
```

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
npm run typecheck
npm run build
npm test
```

Bij wijzigingen aan de OAS of de template: draai ook `npm run generate` en controleer
dat alleen de verwachte gegenereerde bestanden veranderen.

## Repository-indeling

```text
api/             OpenAPI contract en gegenereerde API interfaces
app/             NestJS/Fastify bootstrap en OpenAPI middleware
controllers/     Gegenereerde NestJS controllers
decorators/      Gegenereerde request decorators
implementation/  Handgeschreven adapter naar don-tools
models/          Gegenereerde request/response modellen
scripts/         Reproduceerbare OAS-normalisatie en codegeneratie
test/            Vitest tests
```
