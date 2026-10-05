/**
 * Dates and times are stored in UTC and shown in each person's own language
 * and timezone (from their profile).
 */
export const formatDateTime = (iso: string, locale: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(iso),
  );

export const formatTime = (iso: string, locale: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: "medium", timeZone }).format(new Date(iso));

/** "3 minutes ago", "in 2 hours", in the given language. */
export const timeAgo = (iso: string, locale: string): string => {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return format.format(Math.round(seconds), "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
};

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const allTimeZones = (): string[] => {
  const supported =
    (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  // Some runtimes list UTC among the zones and some do not; either way it goes first.
  return ["UTC", ...supported.filter((zone) => zone !== "UTC")];
};

/** Browsers still report a few zones under names retired years ago; people look for the current ones. */
const CURRENT_ZONE_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** "Asia/Kolkata": the zone under the name people know it by today. */
export const timeZoneName = (timeZone: string): string =>
  (CURRENT_ZONE_NAMES[timeZone] ?? timeZone).replace(/_/g, " ");

const utcOffset = (timeZone: string): string => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(
      new Date(),
    );
    const offset = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") ?? "";
    return `UTC${offset || "+00:00"}`;
  } catch {
    return "";
  }
};

/** "Asia/Kolkata (UTC+05:30)": the zone's current name with today's offset from UTC. */
export const timeZoneLabel = (timeZone: string): string => {
  if (timeZone === "UTC") return "UTC";
  const offset = utcOffset(timeZone);
  return offset ? `${timeZoneName(timeZone)} (${offset})` : timeZoneName(timeZone);
};

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";
