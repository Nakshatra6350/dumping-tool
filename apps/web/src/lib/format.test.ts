import { describe, expect, it } from "vitest";
import { allTimeZones, formatDateTime, initials, timeAgo, timeZoneLabel, timeZoneName } from "./format";

describe("timezone names", () => {
  it("shows zones under their current names, not the retired ones browsers still report", () => {
    expect(timeZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(timeZoneName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(timeZoneName("Asia/Saigon")).toBe("Asia/Ho Chi Minh");
    // Names that are already current only lose their underscores.
    expect(timeZoneName("America/New_York")).toBe("America/New York");
    expect(timeZoneName("UTC")).toBe("UTC");
  });

  it("adds the offset from UTC, which is what people recognise", () => {
    expect(timeZoneLabel("Asia/Calcutta")).toBe("Asia/Kolkata (UTC+05:30)");
    expect(timeZoneLabel("Asia/Kathmandu")).toBe("Asia/Kathmandu (UTC+05:45)");
    expect(timeZoneLabel("UTC")).toBe("UTC");
    // A zone this runtime does not know still gets a label instead of an error.
    expect(timeZoneLabel("Mars/Olympus_Mons")).toBe("Mars/Olympus Mons");
  });

  it("always offers UTC, first", () => {
    expect(allTimeZones()[0]).toBe("UTC");
  });
});

describe("dates", () => {
  it("shows a stored UTC time in the reader's own timezone and language", () => {
    const stored = "2026-01-15T18:45:00.000Z";
    expect(formatDateTime(stored, "en", "UTC")).toContain("6:45");
    // The same moment is already the next day in India.
    expect(formatDateTime(stored, "en", "Asia/Kolkata")).toContain("Jan 16");
    expect(formatDateTime(stored, "en", "Asia/Kolkata")).toContain("12:15");
    expect(formatDateTime(stored, "hi", "Asia/Kolkata")).toContain("जन");
  });

  it("describes how long ago something happened", () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    expect(timeAgo(minutesAgo(5), "en")).toBe("5 minutes ago");
    expect(timeAgo(minutesAgo(180), "en")).toBe("3 hours ago");
    expect(timeAgo(minutesAgo(60 * 24 * 2), "en")).toBe("2 days ago");
    expect(timeAgo(minutesAgo(5), "hi")).toContain("5 मिनट");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Nakshatra Garg")).toBe("NG");
    expect(initials("  asha  ")).toBe("A");
    expect(initials("Ravi Kumar Sharma")).toBe("RK");
    expect(initials("")).toBe("?");
  });
});
