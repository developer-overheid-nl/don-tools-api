const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const jsYaml = require("js-yaml");
const Service = require("./Service");
const { resolveOasInput } = require("./OasInputService");
const { sanitizeFileName } = require("../utils/fileName");
const logger = require("../logger");

const DEFAULT_FILENAME = "openapi";
const REDOCLY_BIN = require.resolve("@redocly/cli/bin/cli");
const execFileAsync = promisify(execFile);

const guessPreferredExtension = (contents) => {
  if (typeof contents !== "string") {
    return ".json";
  }
  const trimmed = contents.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return ".json";
  }
  return ".yaml";
};

const deriveDocumentName = (doc, source) => {
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const infoTitle = typeof doc.info?.title === "string" ? doc.info.title.trim() : "";
    if (infoTitle) {
      const sanitized = sanitizeFileName(infoTitle, { fallback: DEFAULT_FILENAME });
      if (sanitized) {
        return sanitized;
      }
    }
  }
  if (typeof source === "string" && source !== "request-body") {
    try {
      const parsed = new URL(source);
      const basePath = parsed.pathname || "";
      if (basePath) {
        const basename = path.posix.basename(basePath);
        const withoutExt = basename.replace(/\.[^.]+$/, "");
        const sanitized = sanitizeFileName(withoutExt, { fallback: DEFAULT_FILENAME });
        if (sanitized) {
          return sanitized;
        }
      }
    } catch {
      // ignore invalid URL
    }
  }
  return DEFAULT_FILENAME;
};

const runRedoclyBundle = async (inputPath, outputPath, ext) => {
  const args = [
    REDOCLY_BIN,
    "bundle",
    inputPath,
    "--output",
    outputPath,
    "--ext",
    ext,
    "--dereferenced",
  ];
  return execFileAsync(process.execPath, args, { maxBuffer: 20 * 1024 * 1024 });
};

const bundle = async (input) => {
  const resolved = await resolveOasInput(input);
  const contents = typeof resolved.contents === "string" ? resolved.contents : "";
  if (!contents.trim()) {
    throw Service.rejectResponse(
      {
        message: "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody.",
      },
      400,
    );
  }

  let tmpDir;
  const inputExt = guessPreferredExtension(contents);
  const inputPath = () => path.join(tmpDir, `input${inputExt}`);
  const outputPath = (ext) => path.join(tmpDir, `bundle.${ext}`);

  let bundledText;
  let document;
  let outputExt = "json";
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oas-bundle-"));
    await fs.writeFile(inputPath(), contents, "utf8");
    try {
      await runRedoclyBundle(inputPath(), outputPath("json"), "json");
      bundledText = await fs.readFile(outputPath("json"), "utf8");
      document = JSON.parse(bundledText);
    } catch (jsonError) {
      const errText = `${jsonError?.stderr || ""}${jsonError?.stdout || ""}${jsonError?.message || ""}`;
      const hasCircular = errText.toLowerCase().includes("circular reference");
      if (!hasCircular) {
        throw jsonError;
      }
      logger.warn("[OasBundleService] JSON bundle failed due to circular refs, retrying with YAML", {
        message: jsonError?.message,
      });
      outputExt = "yaml";
      await runRedoclyBundle(inputPath(), outputPath("yaml"), "yaml");
      bundledText = await fs.readFile(outputPath("yaml"), "utf8");
      document = jsYaml.load(bundledText);
    }
  } catch (error) {
    logger.error("[OasBundleService] bundle failed via redocly CLI", {
      message: error?.message,
      stack: error?.stack,
    });
    const status = typeof error?.status === "number" && error.status >= 400 ? error.status : 400;
    throw Service.rejectResponse(
      {
        message: "Het bundelen van de OpenAPI specificatie is mislukt.",
        detail: error?.message,
      },
      status,
    );
  } finally {
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw Service.rejectResponse(
      {
        message: "Onverwachte structuur na bundelen.",
      },
      500,
    );
  }

  const docName = deriveDocumentName(document, resolved.source);
  const buffer = Buffer.from(bundledText, "utf8");
  const filename = `${docName}.${outputExt}`;
  const contentType = outputExt === "json" ? "application/json" : "application/yaml";

  return {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    rawBody: buffer,
  };
};

module.exports = {
  bundle,
};
