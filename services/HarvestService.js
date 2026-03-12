const logger = require("../logger");

const PDOK_OAS_PATH = "openapi.json";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 500;
const MAX_ERROR_BODY_LENGTH = 8192;

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

const truncate = (value, limit = MAX_ERROR_BODY_LENGTH) => {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}…`;
};

const resolveFetch = (fetchImpl) => {
  if (typeof fetchImpl === "function") {
    return fetchImpl;
  }
  if (typeof fetch === "function") {
    return fetch;
  }
  throw new Error("Fetch API is niet beschikbaar in de huidige runtime.");
};

const buildUrlFromEnv = (baseUrl, realm, prefix, suffix = "") => {
  const baseTrimmed = trimString(baseUrl).replace(/\/+$/, "");
  const realmTrimmed = trimString(realm);
  if (!baseTrimmed || !realmTrimmed) {
    return "";
  }
  return `${baseTrimmed}${prefix}${encodeURIComponent(realmTrimmed)}${suffix}`;
};

const buildRequestSignal = (externalSignal, timeoutMs) => {
  if (externalSignal) {
    if (
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.any === "function" &&
      typeof AbortSignal.timeout === "function"
    ) {
      return AbortSignal.any([externalSignal, AbortSignal.timeout(timeoutMs)]);
    }
    return externalSignal;
  }
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
};

const isAbortError = (error) =>
  error?.name === "AbortError" || error?.name === "TimeoutError";

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(new Error("Request geannuleerd"));
      return;
    }

    let settled = false;
    let timeoutId;
    let abortHandler;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    abortHandler = () => rejectOnce(new Error("Request geannuleerd"));
    timeoutId = setTimeout(resolveOnce, ms);
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

const normalizeContact = (contact) => {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) {
    return undefined;
  }
  const normalized = {};
  const name = trimString(contact.name);
  const url = trimString(contact.url);
  const email = trimString(contact.email);
  if (name) {
    normalized.name = name;
  }
  if (url) {
    normalized.url = url;
  }
  if (email) {
    normalized.email = email;
  }
  if (Object.keys(normalized).length === 0) {
    return undefined;
  }
  return normalized;
};

const deriveOASURLWith = (href) => {
  const trimmedHref = trimString(href).replace(/\/+$/, "");
  if (!trimmedHref) {
    throw new Error("lege href voor OAS-afleiding");
  }
  return `${trimmedHref}/${PDOK_OAS_PATH}`;
};

const extractIndexHrefs = (data) => {
  let parsed;
  try {
    parsed = JSON.parse(typeof data === "string" ? data : String(data || ""));
  } catch (error) {
    throw new Error(`parse index.json: ${error.message}`);
  }

  const apis = Array.isArray(parsed?.apis) ? parsed.apis : [];
  const out = [];
  for (const apiEntry of apis) {
    const links = apiEntry?.links;
    if (Array.isArray(links)) {
      for (const link of links) {
        const href = trimString(link?.href);
        if (href) {
          out.push(href);
        }
      }
      continue;
    }
    if (links && typeof links === "object") {
      const href = trimString(links.href);
      if (href) {
        out.push(href);
      }
    }
  }
  return out;
};

class HarvestService {
  constructor({
    registerEndpoint = "",
    tokenURL = "",
    clientID = "",
    clientSecret = "",
    fetchImpl,
  } = {}) {
    this.registerEndpoint = trimString(registerEndpoint);
    this.tokenURL = trimString(tokenURL);
    this.clientID = trimString(clientID);
    this.clientSecret = trimString(clientSecret);
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
    this.rateLimitDelayMs = DEFAULT_RATE_LIMIT_DELAY_MS;
    this.fetch = resolveFetch(fetchImpl);
  }

  static fromEnv() {
    const tokenFromEnv = trimString(process.env.AUTH_TOKEN_URL);
    const tokenURL =
      tokenFromEnv ||
      buildUrlFromEnv(
        process.env.KEYCLOAK_BASE_URL,
        process.env.KEYCLOAK_REALM,
        "/realms/",
        "/protocol/openid-connect/token",
      );
    return new HarvestService({
      registerEndpoint: process.env.PDOK_REGISTER_ENDPOINT,
      tokenURL,
      clientID: process.env.AUTH_CLIENT_ID,
      clientSecret: process.env.AUTH_CLIENT_SECRET,
    });
  }

  isConfigured() {
    return Boolean(this.registerEndpoint);
  }

  hasAuthConfig() {
    return (
      Boolean(this.tokenURL) &&
      Boolean(this.clientID) &&
      Boolean(this.clientSecret)
    );
  }

  async runOnce(source, { signal } = {}) {
    if (!this.isConfigured()) {
      throw new Error(
        "register endpoint is not configured (PDOK_REGISTER_ENDPOINT)",
      );
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("harvest source is ongeldig");
    }
    const indexUrl = trimString(source.indexUrl);
    if (!indexUrl) {
      throw new Error("source indexUrl is empty");
    }

    const hrefs = await this.fetchIndexHrefs(indexUrl, signal);
    const sourceName = trimString(source.name) || indexUrl;
    if (hrefs.length === 0) {
      logger.info(`[HarvestService] geen API-links gevonden in ${indexUrl}`);
      return {
        source: sourceName,
        scanned: 0,
        posted: 0,
        badRequest: 0,
        failed: 0,
      };
    }

    const token = await this.getAccessToken(signal);
    const organisationUri = trimString(source.organisationUri);
    const contact = normalizeContact(source.contact);

    let posted = 0;
    let badRequest = 0;
    const failures = [];

    for (let i = 0; i < hrefs.length; i += 1) {
      if (i > 0) {
        await delay(this.rateLimitDelayMs, signal);
      }
      const href = hrefs[i];
      const oasUrl = deriveOASURLWith(href);
      const payload = {
        oasUrl,
      };
      if (organisationUri) {
        payload.organisationUri = organisationUri;
      }
      if (contact) {
        payload.contact = contact;
      }

      try {
        await this.postAPI(payload, token, signal);
        posted += 1;
      } catch (error) {
        const status = typeof error?.status === "number" ? error.status : 0;
        if (status === 400) {
          badRequest += 1;
          logger.warn(
            `[HarvestService] bad request op ${oasUrl}: ${error.message}`,
          );
          continue;
        }
        failures.push(`${oasUrl}: ${error.message}`);
      }
    }

    const summary = {
      source: sourceName,
      scanned: hrefs.length,
      posted,
      badRequest,
      failed: failures.length,
    };
    if (failures.length > 0) {
      const error = new Error(
        `${failures.length} failures; first: ${failures[0]}`,
      );
      error.summary = summary;
      error.failures = failures;
      throw error;
    }
    return summary;
  }

  async fetchIndexHrefs(indexUrl, signal) {
    const requestSignal = buildRequestSignal(signal, this.timeoutMs);
    let response;
    try {
      response = await this.fetch(indexUrl, {
        method: "GET",
        signal: requestSignal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`timeout tijdens ophalen van index: ${indexUrl}`);
      }
      throw new Error(`netwerkfout bij ophalen van index: ${error.message}`);
    }

    const body = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `unexpected status ${response.status} from index: ${truncate(body, 4096)}`,
      );
    }
    return extractIndexHrefs(body);
  }

  async postAPI(payload, bearer, signal) {
    const requestSignal = buildRequestSignal(signal, this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.registerEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(trimString(bearer) ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        const timeoutError = new Error(
          "timeout tijdens post naar register endpoint",
        );
        timeoutError.status = 0;
        throw timeoutError;
      }
      const networkError = new Error(
        `netwerkfout richting register endpoint: ${error.message}`,
      );
      networkError.status = 0;
      throw networkError;
    }

    const body = truncate(await response.text());
    if (response.status < 200 || response.status >= 300) {
      const requestError = new Error(
        `unexpected status ${response.status} from register endpoint ${this.registerEndpoint}: ${body}`,
      );
      requestError.status = response.status;
      requestError.responseBody = body;
      throw requestError;
    }
    return { status: response.status, body };
  }

  async getAccessToken(signal) {
    if (!this.hasAuthConfig()) {
      throw new Error(
        "auth not configured (AUTH_TOKEN_URL, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET)",
      );
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientID,
      client_secret: this.clientSecret,
    });

    const requestSignal = buildRequestSignal(signal, this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.tokenURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: requestSignal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error("timeout tijdens ophalen van access token");
      }
      throw new Error(`netwerkfout richting token endpoint: ${error.message}`);
    }

    const text = truncate(await response.text());
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`token endpoint status ${response.status}: ${text}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(text || "{}");
    } catch (error) {
      throw new Error(`token response is geen geldige JSON: ${error.message}`);
    }
    const accessToken = trimString(parsed.access_token);
    if (!accessToken) {
      throw new Error("empty access_token in response");
    }
    return accessToken;
  }
}

module.exports = {
  HarvestService,
  deriveOASURLWith,
  extractIndexHrefs,
};
