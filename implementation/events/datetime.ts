const formatters = new Map<string, Intl.DateTimeFormat>();

// Creating a formatter is costly and throws a RangeError for an unknown time zone, so it is done once per zone.
export const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

// Formats an instant as an RFC 3339 date-time with the UTC offset of the given time zone (ADR: always include an offset).
export const formatDateTime = (instant: Date, timeZone: string): string => {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((Date.parse(`${local}Z`) - wholeSeconds) / 60_000);
  if (offsetMinutes === 0) return `${local}Z`;
  const sign = offsetMinutes > 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${local}${sign}${hours}:${minutes}`;
};

export const parseDateTime = (value: string): Date | undefined => {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
};

export const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};
