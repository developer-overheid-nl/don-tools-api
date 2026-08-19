const { fetch } = require("@stoplight/spectral-runtime");
const Service = require("./Service");
const logger = require("../logger");

const DEFAULT_ERROR_MESSAGE = "Het ophalen van de specificatie is mislukt.";
const DEFAULT_TIMEOUT_MS = 45000;

const resolveTimeoutMs = () => {
  const envValue = Number(process.env.OAS_FETCH_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return DEFAULT_TIMEOUT_MS;
};

const buildFetchOptions = () => {
  const controller = new AbortController();
  const timeout = resolveTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const options = {
    signal: controller.signal,
  };
  return { options, cleanup: () => clearTimeout(timeoutId), timeout };
};

const normalizeErrorDetail = (error) => {
  const parts = [];
  if (error?.message) {
    parts.push(error.message);
  }
  if (error?.code) {
    parts.push(`code=${error.code}`);
  }
  if (error?.type) {
    parts.push(`type=${error.type}`);
  }
  return parts.join(" ").trim() || "Onbekende netwerkfout";
};

const doFetch = async (url, { origin }) => {
  const { options, cleanup, timeout } = buildFetchOptions();
  try {
    const headers = {};
    if (origin) {
      headers.Origin = origin;
    }
    options.headers = headers;
    const response = await fetch(url, options);
    if (!response.ok) {
      const preview = await response.text().catch(() => "");
      const trimmed = preview ? preview.slice(0, 200) : "";
      const error = new Error(`Server gaf status ${response.status}${trimmed ? `: ${trimmed}` : ""}`);
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } catch (error) {
    error.timeout = timeout;
    throw error;
  } finally {
    cleanup();
  }
};

const fetchSpecification = async (url, { errorMessage = DEFAULT_ERROR_MESSAGE } = {}) => {
  const origin = "https://developer.overheid.nl";
  const attempts = origin ? [{ origin }, { origin: undefined }] : [{ origin: undefined }];
  const targetUrl = new URL(url);
  const target = {
    origin: targetUrl.origin,
    resourceType: "openapi_specification",
  };
  let lastError;
  for (const attempt of attempts) {
    try {
      return await doFetch(url, attempt);
    } catch (error) {
      lastError = error;
      logger.warn("Remote specification fetch attempt failed", {
        event: "remote_specification.fetch_attempt.failed",
        target,
        withOriginHeader: Boolean(attempt.origin),
        timeoutMs: error?.timeout,
        error: {
          name: error?.name || "Error",
          ...(error?.status ? { status: error.status } : {}),
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.type ? { type: error.type } : {}),
        },
      });
      // continue to next attempt
    }
  }

  const detail = normalizeErrorDetail(lastError);
  throw Service.rejectResponse(
    {
      message: errorMessage,
      detail,
      timeout: lastError?.timeout,
    },
    400,
  );
};

module.exports = {
  fetchSpecification,
};
