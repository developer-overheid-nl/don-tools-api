import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const sourceUrl = "https://api.developer.overheid.nl/tools/v1/openapi.json";
const templateRepository = "https://github.com/developer-overheid-nl/codegen-templates.git";
const templateCommit = "ec83f706dfa21b080edf2cbe5e186d2440b49eb2";
const openApiGeneratorCliVersion = "2.40.1";
const redoclyVersion = "2.46.2";
const donCheckerVersion = "1.1.0";
const biomeVersion = "2.5.9";
const legacyComponentKinds = ["schemas", "responses", "headers", "securitySchemes"];
const operationMethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const generatedEntries = ["api", "app", "controllers", "decorators", "models", "tsconfig.json"];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const run = (command, args, cwd = projectRoot) => {
  execFileSync(command, args, { cwd, stdio: "inherit" });
};

export const normalizeOpenApi = (input) => {
  if (!isRecord(input) || !isRecord(input.components)) {
    throw new TypeError("OpenAPI document must contain a components object");
  }

  const document = structuredClone(input);
  for (const kind of legacyComponentKinds) {
    if (!(kind in document)) continue;
    if (!isDeepStrictEqual(document[kind], document.components[kind])) {
      throw new Error(`Legacy root component ${kind} differs from components.${kind}`);
    }
    delete document[kind];
  }
  if (isRecord(document.paths)) {
    for (const pathItem of Object.values(document.paths)) {
      if (!isRecord(pathItem)) continue;
      for (const method of operationMethods) {
        const operation = pathItem[method];
        if (!isRecord(operation) || !Array.isArray(operation.security)) continue;
        operation.security = operation.security.flatMap((requirement) => {
          if (!isRecord(requirement)) return [requirement];
          const schemes = Object.keys(requirement).sort();
          if (schemes.length !== 2 || schemes[0] !== "apiKey" || schemes[1] !== "clientCredentials") {
            return [requirement];
          }
          return [{ apiKey: requirement.apiKey }, { clientCredentials: requirement.clientCredentials }];
        });
      }
    }
  }
  return document;
};

const fetchOpenApi = async () => {
  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Unable to download OpenAPI document: ${response.status} ${response.statusText}`);
  return normalizeOpenApi(await response.json());
};

const resolveTemplateDirectory = (temporaryDirectory) => {
  const override = process.env.CODEGEN_TEMPLATE_DIR;
  if (override) {
    const directory = resolve(override);
    if (!existsSync(join(directory, "generator-config.yaml"))) {
      throw new Error(`CODEGEN_TEMPLATE_DIR is not a NestJS Fastify template: ${directory}`);
    }
    return directory;
  }

  const repositoryDirectory = join(temporaryDirectory, "codegen-templates");
  run("git", ["clone", "--quiet", "--no-checkout", templateRepository, repositoryDirectory]);
  run("git", ["checkout", "--quiet", "--detach", templateCommit], repositoryDirectory);
  return join(repositoryDirectory, "nestjs-fastify");
};

const synchronizeGeneratedOutput = (generatedDirectory, bundledOpenApi) => {
  for (const entry of generatedEntries) {
    const source = join(generatedDirectory, entry);
    if (!existsSync(source)) throw new Error(`Generator did not create ${entry}`);
    const destination = join(projectRoot, entry);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }
  cpSync(bundledOpenApi, join(projectRoot, "api", "openapi.yaml"));
};

export const generateApi = async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "don-tools-api-codegen-"));
  try {
    const normalizedOpenApi = join(temporaryDirectory, "openapi.normalized.json");
    const bundledOpenApi = join(temporaryDirectory, "openapi.bundled.yaml");
    const generatedDirectory = join(temporaryDirectory, "generated");
    const templateDirectory = resolveTemplateDirectory(temporaryDirectory);

    writeFileSync(normalizedOpenApi, `${JSON.stringify(await fetchOpenApi(), null, 2)}\n`);
    run("npx", [
      "-y",
      `@redocly/cli@${redoclyVersion}`,
      "bundle",
      normalizedOpenApi,
      "--output",
      bundledOpenApi,
      "--ext",
      "yaml",
    ]);
    run("npx", [
      "-y",
      `@developer-overheid-nl/don-checker@${donCheckerVersion}`,
      "validate",
      "--standard",
      "adr",
      "--version",
      "2.1.0",
      "--input",
      bundledOpenApi,
      "--format",
      "table",
      "--fail-on",
      "error",
    ]);
    run("npx", [
      "-y",
      `@openapitools/openapi-generator-cli@${openApiGeneratorCliVersion}`,
      "generate",
      "-i",
      bundledOpenApi,
      "-g",
      "typescript-nestjs-server",
      "-o",
      generatedDirectory,
      "-t",
      templateDirectory,
      "-c",
      join(templateDirectory, "generator-config.yaml"),
      "--additional-properties=npmName=tools-api-v1,npmVersion=1.0.0,nestVersion=11.2.1,rxjsVersion=7.8.2,tsVersion=6.0.3,nodeVersion=22.20.1,licenseName=EUPL-1.2",
    ]);
    synchronizeGeneratedOutput(generatedDirectory, bundledOpenApi);
    run("npx", [
      "-y",
      `@biomejs/biome@${biomeVersion}`,
      "check",
      "--write",
      "--unsafe",
      "api",
      "app",
      "controllers",
      "decorators",
      "models",
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateApi().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
