import { describe, expect, it } from "vitest";
import { safeUrl } from "../../../src/shared/lib/url-policy";

describe("absolute HTTP/HTTPS URL policy", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    [
      "http://localhost:5173/reports?id=a%20b#source",
      "http://localhost:5173/reports?id=a%20b#source",
    ],
    ["HTTPS://EXAMPLE.COM/report", "https://example.com/report"],
    ["https://example.com/nguồn", "https://example.com/ngu%E1%BB%93n"],
  ])("normalizes an allowed absolute URL: %s", (value, expected) => {
    expect(safeUrl(value)).toBe(expected);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/private.txt",
    "ftp://example.com/file",
    "mailto:user@example.com",
    "/reports",
    "./report",
    "../report",
    "//example.com/report",
    "#source",
    "?id=1",
    "",
    "not a URL",
    "https://",
    "https://[invalid",
    "https:example.com",
    "https:/example.com",
    "https:///example.com",
    "https:////example.com",
    "https://example.com\\@evil.test",
    "https://exa\nmple.com",
    " https://example.com",
  ])("rejects unsafe, relative or malformed input: %s", (value) => {
    expect(safeUrl(value)).toBeUndefined();
  });
});
