const DEFAULT_MAX_LENGTH = 128;

const internalSanitize = (value, { lowercase, maxLength }) => {
  if (typeof value !== "string") {
    return "";
  }

  let working = value.trim();
  if (working.length === 0) {
    return "";
  }

  try {
    working = working.normalize("NFKD").replace(/\p{M}+/gu, "");
  } catch {
    // ignore environments without String.prototype.normalize
  }

  working = working
    .replace(/["']/g, "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[^0-9A-Za-z._\s-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .trim();

  if (lowercase) {
    working = working.toLowerCase();
  }

  if (maxLength > 0 && working.length > maxLength) {
    working = working.slice(0, maxLength);
  }

  return working;
};

const sanitizeFileName = (value, options = {}) => {
  const { fallback = "", lowercase = false, maxLength = DEFAULT_MAX_LENGTH } = options;
  const params = { lowercase, maxLength };
  const sanitized = internalSanitize(value, params);
  if (sanitized) {
    return sanitized;
  }
  if (typeof fallback === "string" && fallback.length > 0) {
    const fallbackSanitized = internalSanitize(fallback, params);
    if (fallbackSanitized) {
      return fallbackSanitized;
    }
  }
  return "";
};

module.exports = {
  sanitizeFileName,
};
