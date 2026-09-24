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
- Events-agenda in PostgreSQL met een Pleio-harvester in `implementation/events/`
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
- `GET|POST /v1/events` en `GET|PUT|DELETE /v1/events/{id}`

## Events

De events-endpoints vervangen de statische `static/agenda/events.json` van `don-site`.
Events komen uit twee bronnen:

- `manual`: aangemaakt en beheerd via `POST`, `PUT` en `DELETE`;
- `pleio`: geharvest uit Pleio-sites. Een harvest haalt alle aankomende events op via de
  GraphQL-query `activities` (introspection staat bij Pleio uit, dus de query is vast) en
  doet een upsert op `(bron, Pleio-guid)`. Alleen events waarvan `timeUpdated` veranderd is
  worden bijgewerkt. Toekomstige events die de bron niet meer toont, worden verwijderd;
  afgelopen events blijven bewaard.

Geharveste events zijn alleen bij de bron te wijzigen (`PUT` geeft `409`). Een `DELETE`
verbergt zo'n event, zodat een volgende harvest het niet terugzet.

De harvest draait in het proces: bij het opstarten en daarna volgens `PLEIO_HARVEST_CRON`.
Een PostgreSQL advisory lock zorgt dat bij meerdere replicas maar één instantie tegelijk
harvest. Migraties draaien bij het eerste gebruik van de database, ook onder een advisory lock.

Tijden volgen ADR 2.2: RFC 3339 met UTC-offset (`2026-10-06T15:30:00+02:00`). Velden heten
`startsAt`/`endsAt`, omdat de ADR-regel voor namen met `Date` `format: date` afdwingt.

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
- `LOG_LEVEL`: minimale loglevel (`debug`, `info`, `warn` of `error`), standaard `info`
- `OAS_FETCH_TIMEOUT_MS`: timeout voor externe specificaties, standaard `45000`
- `OPENAPI_MOCK`: zet mock responses aan met `true`, `1`, `yes` of `on`
- `OPENAPI_VALIDATE_RESPONSES`: valideert succesvolle responses tegen de OAS wanneer deze op `true` staat
- `DB_HOSTNAME`, `DB_PORT` (standaard `5432`), `DB_USERNAME`, `DB_PASSWORD`, `DB_DBNAME`,
  `DB_SCHEMA` (standaard `public`): PostgreSQL voor de events. Zonder `DB_HOSTNAME` geven de
  events-endpoints `503` en draait er geen harvest; de tools-endpoints werken gewoon.
- `DB_POOL_MAX`: maximaal aantal databaseverbindingen, standaard `5`
- `PUBLIC_BASE_URL`: publiek adres vóór de gateway (bijvoorbeeld
  `https://api.developer.overheid.nl/tools`), gebruikt in `Location` en `Link`
- `EVENTS_TIME_ZONE`: tijdzone voor de offset in responses, standaard `Europe/Amsterdam`
- `PLEIO_SOURCES`: kommagescheiden Pleio-sites, standaard `https://digilab.pleio.nl`
- `PLEIO_HARVEST_ENABLED`: zet de harvest aan of uit, standaard `true`
- `PLEIO_HARVEST_CRON`: cron-schema in `EVENTS_TIME_ZONE`, standaard `0 6 * * *`
- `PLEIO_TIMEOUT_MS`: timeout per Pleio-request, standaard `30000`

Iedere logregel is één JSON-object op `stdout` met `time`, `level`, `msg`,
`app`, `component` en `operation`. `app` is altijd `tools-api`. HTTP-logs
gebruiken daarnaast `request_id`, `method`, `route`, `path`, `status_code`,
`duration_ms` en `response_bytes`. Querystrings worden niet in `path`
opgenomen; alleen een `5xx` response wordt als `ERROR` gelogd.

Mock mode kan ook direct via:

```sh
npm run dev-mock
```

## Authenticatie

De publieke gateway controleert vóór deze app een `X-Api-Key` óf een OAuth2
client-credentials-token. De runtime zelf verwacht daarom alleen verkeer van die vertrouwde
gateway. Bij lokaal gebruik vindt geen inkomende authenticatie plaats. De `AUTH_CLIENT_ID` en
`AUTH_CLIENT_SECRET` uit `.env` zijn uitsluitend bestemd voor de uitgaande Keycloak-adminaanroep
van `POST /v1/auth/clients`.

## Code genereren

`npm run generate` haalt de OAS op van
`https://api.developer.overheid.nl/tools/v1/openapi.json`. Met
`OPENAPI_SOURCE=api/openapi.yaml npm run generate` genereert het vanuit een lokaal bestand,
bijvoorbeeld om nieuwe operaties toe te voegen die nog niet gepubliceerd zijn. CI gebruikt dit
om te controleren dat de gegenereerde code bij de gecommitte OAS past. Het script:

- valt terug op de gecommitte `api/openapi.yaml` als de gepubliceerde OAS niet op te halen is;
- controleert en verwijdert vier identieke legacy-componentvelden op rootniveau;
- corrigeert de API-key en client-credentials-eis naar twee alternatieve security-requirements;
- bundelt de OAS met een vastgezette Redocly-versie;
- valideert de bundel met DON ADR 2.1;
- genereert NestJS/Fastify met een vastgezette templatecommit en OpenAPI Generator-versie;
- vervangt alleen de gegenereerde mappen en laat `implementation/` ongemoeid.

De projectspecifieke code na generatie staat in `implementation/`: de adapter in
`implementation/index.ts` roept de acht functies uit `@developer-overheid-nl/don-tools` aan,
en `implementation/events/` bevat de events-opslag en de Pleio-harvester.

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

De integratietests voor events draaien alleen met een PostgreSQL-database:

```sh
docker run --rm -d --name don-events-pg -p 55432:5432 -e POSTGRES_PASSWORD=don postgres:17
TEST_DB_HOSTNAME=localhost TEST_DB_PORT=55432 TEST_DB_USERNAME=postgres TEST_DB_PASSWORD=don TEST_DB_DBNAME=postgres npm test
```

Bij wijzigingen aan de OAS of de template: draai ook `npm run generate` en controleer
dat alleen de verwachte gegenereerde bestanden veranderen.

## Repository-indeling

```text
api/             OpenAPI contract en gegenereerde API interfaces
app/             NestJS/Fastify bootstrap en OpenAPI middleware
controllers/     Gegenereerde NestJS controllers
decorators/      Gegenereerde request decorators
implementation/  Handgeschreven adapter naar don-tools en de events-implementatie
models/          Gegenereerde request/response modellen
scripts/         Reproduceerbare OAS-normalisatie en codegeneratie
test/            Vitest tests
```
