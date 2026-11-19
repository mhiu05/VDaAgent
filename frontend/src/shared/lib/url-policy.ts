export function safeUrl(url: string): string | undefined {
  // URL() repairs missing slashes, backslashes and embedded whitespace. Do not
  // turn malformed agent/source input into an executable link by repairing it.
  if (
    typeof url !== "string" ||
    !/^https?:\/\/[^/\\\s]/i.test(url) ||
    /[\s\\]/u.test(url) ||
    [...url].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
