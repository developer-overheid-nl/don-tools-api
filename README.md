# Tools API

HTTP API for developer.overheid.nl tools.

This repository contains only the API transport layer: OpenAPI validation, Fastify routing, response headers, and error
mapping. Business logic lives in `@developer-overheid-nl/don-tools-logic`, currently consumed locally from
`../don-tools-api-v2`.

## Stack

- Node.js 22+
- TypeScript, native ESM, `NodeNext`
- Fastify v5
- `fastify-openapi-glue` for OpenAPI operation binding
- Vitest
- Biome

## Development

```sh
npm install
npm run dev
npm run build
npm start
npm test
npm run lint
```

The OpenAPI contract is `api/openapi.json`. The API also serves it at `GET /v1/openapi.json`.

## Split

- `don-tools-api`: API adapter, OpenAPI contract, HTTP error handling
- `don-tools-api-v2`: reusable logic package

The local package dependency is:

```json
"@developer-overheid-nl/don-tools-logic": "file:../don-tools-api-v2"
```
