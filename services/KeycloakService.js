const { randomUUID } = require("node:crypto");
const { URL, URLSearchParams } = require("node:url");
const Service = require("./Service");

const KEYCLOAK_CLIENT_DESCRIPTION = "Dit is een read-only api key. Meer info: https://apis.developer.overheid.nl/apis/toevoegen";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_ERROR_BODY_LENGTH = 8192;

const ERROR_CODES = {
  CONFIG: "config",
  CONFLICT: "conflict",
  UNAUTHORIZED: "unauthorized",
  CLIENT_ID_MISSING: "client_id_missing",
  GENERIC: "generic",
};

class KeycloakError extends Error {
  constructor(message, code = ERROR_CODES.GENERIC) {
    super(message);
    this.name = "KeycloakError";
    this.code = code;
  }
}

const resolveFetch = (fetchImpl) => {
  if (typeof fetchImpl === "function") {
    return fetchImpl;
  }
  if (typeof fetch === "function") {
    return fetch;
  }
  throw new KeycloakError("Fetch API is niet beschikbaar in de huidige runtime.", ERROR_CODES.CONFIG);
};

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

const buildKeycloakPayload = (clientId, email) => {
  const payload = {
    clientId,
    name: clientId,
    enabled: true,
    publicClient: true,
    directAccessGrantsEnabled: false,
    standardFlowEnabled: false,
    serviceAccountsEnabled: false,
    authorizationServicesEnabled: false,
    protocol: "openid-connect",
    description: KEYCLOAK_CLIENT_DESCRIPTION,
  };

  const attributes = {};
  if (email) {
    attributes.email = email;
  }
  if (Object.keys(attributes).length > 0) {
    payload.attributes = attributes;
  }
  return payload;
};

const extractClientIdFromLocation = (locationHeader) => {
  const trimmed = trimString(locationHeader);
  if (!trimmed) {
    throw new KeycloakError("Keycloak response bevat geen Location header", ERROR_CODES.GENERIC);
  }

  try {
    const url = new URL(trimmed);
    const candidate = trimString(url.pathname.split("/").pop());
    if (candidate) {
      return candidate;
    }
  } catch {
    // fall back to manual parsing
  }

  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash >= 0 && lastSlash < trimmed.length - 1) {
    const candidate = trimString(trimmed.slice(lastSlash + 1));
    if (candidate) {
      return candidate;
    }
  }

  throw new KeycloakError(`Kan clientId niet bepalen uit Keycloak Location header: ${trimmed}`, ERROR_CODES.GENERIC);
};

const buildUrlFromEnv = (baseUrl, realm, suffix) => {
  const baseTrimmed = trimString(baseUrl).replace(/\/+$/, "");
  const realmTrimmed = trimString(realm);
  if (!baseTrimmed || !realmTrimmed) {
    return "";
  }
  return `${baseTrimmed}${suffix}${encodeURIComponent(realmTrimmed)}`;
};

const createTimeoutSignal = (timeoutMs) => {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      cleanup: () => {},
    };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => clearTimeout(timeoutId);
  return {
    signal: controller.signal,
    cleanup,
  };
};

const parseUntrustClientInput = (params) => {
  const payload = Service.extractRequestBody(params);
  if (!payload || typeof payload !== "object") {
    Service.throwHttpError(400, "body ontbreekt");
  }
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email) {
    Service.throwHttpError(400, "email is verplicht");
  }
  return { email };
};

const translateKeycloakError = (error) => {
  if (!(error instanceof KeycloakError)) {
    return null;
  }
  switch (error.code) {
    case ERROR_CODES.CONFIG:
      return { status: 500, message: "Keycloak configuratie ontbreekt" };
    case ERROR_CODES.CONFLICT:
      return { status: 409, message: "Keycloak client bestaat al" };
    case ERROR_CODES.UNAUTHORIZED:
      return { status: 403, message: "Geen toegang tot Keycloak admin API" };
    case ERROR_CODES.CLIENT_ID_MISSING:
      return { status: 400, message: "clientId ontbreekt of is ongeldig" };
    default:
      return { status: 500, message: error.message || "Er is een fout opgetreden bij Keycloak." };
  }
};

class KeycloakService {
  constructor({
    adminClientsURL = "",
    tokenURL = "",
    clientId = "",
    clientSecret = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
  } = {}) {
    this.adminClientsURL = trimString(adminClientsURL);
    this.tokenURL = trimString(tokenURL);
    this.clientId = trimString(clientId);
    this.clientSecret = trimString(clientSecret);
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.fetch = resolveFetch(fetchImpl);
  }

  static fromEnv() {
    const adminBase = buildUrlFromEnv(process.env.KEYCLOAK_BASE_URL, process.env.KEYCLOAK_REALM, "/admin/realms/");
    const adminClientsURL = adminBase ? `${adminBase}/clients` : "";

    const tokenBase = buildUrlFromEnv(process.env.KEYCLOAK_BASE_URL, process.env.KEYCLOAK_REALM, "/realms/");
    const tokenURL = tokenBase ? `${tokenBase}/protocol/openid-connect/token` : "";

    return new KeycloakService({
      adminClientsURL,
      tokenURL,
      clientId: process.env.AUTH_CLIENT_ID,
      clientSecret: process.env.AUTH_CLIENT_SECRET,
    });
  }

  isConfigured() {
    return (
      Boolean(this.adminClientsURL) && Boolean(this.tokenURL) && Boolean(this.clientId) && Boolean(this.clientSecret)
    );
  }

  async createClient(input) {
    if (!this.isConfigured()) {
      throw new KeycloakError("Keycloak configuratie ontbreekt", ERROR_CODES.CONFIG);
    }

    const email = trimString(typeof input === "string" ? input : input?.email);

    const token = await this.fetchToken();
    const clientId = randomUUID();
    const payload = buildKeycloakPayload(clientId, email);

    const { signal, cleanup } = createTimeoutSignal(this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.adminClientsURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new KeycloakError("Timeout tijdens verzoek naar Keycloak", ERROR_CODES.GENERIC);
      }
      throw new KeycloakError(`Netwerkfout richting Keycloak: ${error.message}`, ERROR_CODES.GENERIC);
    } finally {
      cleanup();
    }

    const responseText = truncate(await response.text());

    switch (response.status) {
      case 201: {
        const location = response.headers.get("location");
        const newClientId = extractClientIdFromLocation(location);
        return {
          apiKey: newClientId,
        };
      }
      case 204:
        throw new KeycloakError("clientId ontbreekt of is ongeldig", ERROR_CODES.CLIENT_ID_MISSING);
      case 409:
        throw new KeycloakError("Keycloak client bestaat al", ERROR_CODES.CONFLICT);
      case 401:
      case 403:
        throw new KeycloakError("Geen toegang tot Keycloak admin API", ERROR_CODES.UNAUTHORIZED);
      default: {
        const message = responseText || response.statusText || "Onbekende fout";
        throw new KeycloakError(`Keycloak response ${response.status}: ${message}`, ERROR_CODES.GENERIC);
      }
    }
  }

  async fetchToken() {
    if (!this.tokenURL || !this.clientId || !this.clientSecret) {
      throw new KeycloakError("Keycloak configuratie ontbreekt", ERROR_CODES.CONFIG);
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const { signal, cleanup } = createTimeoutSignal(this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.tokenURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal,
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new KeycloakError("Timeout tijdens ophalen van Keycloak token", ERROR_CODES.GENERIC);
      }
      throw new KeycloakError(`Netwerkfout richting Keycloak token endpoint: ${error.message}`, ERROR_CODES.GENERIC);
    } finally {
      cleanup();
    }

    const text = truncate(await response.text());
    if (!response.ok) {
      const unauthorizedStatuses = new Set([400, 401, 403]);
      if (unauthorizedStatuses.has(response.status)) {
        throw new KeycloakError("autorisatie voor keycloak mislukt", ERROR_CODES.UNAUTHORIZED);
      }
      throw new KeycloakError(
        `Keycloak token response ${response.status}: ${text || response.statusText}`,
        ERROR_CODES.GENERIC,
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      throw new KeycloakError("Keycloak token response bevat geen geldig JSON", ERROR_CODES.GENERIC);
    }

    const token = trimString(parsed.access_token);
    if (!token) {
      throw new KeycloakError("Keycloak token ontbreekt in response", ERROR_CODES.GENERIC);
    }
    return token;
  }
}

module.exports = {
  KeycloakService,
  KeycloakError,
  ERROR_CODES,
  parseUntrustClientInput,
  translateKeycloakError,
};
