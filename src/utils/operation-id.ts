export const toLowerCamelCase = (operationId: string): string => {
  const normalized = operationId
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9_$]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1)))
    .join("")
    .replace(/^[^a-zA-Z_$]+/, "");

  return normalized ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : operationId;
};
