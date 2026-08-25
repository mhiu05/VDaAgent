const INTERNAL_MODEL_METADATA = /(?:^|[\n,\[{])\s*["']?(?:extras|signature)["']?\s*:/i;

/** Hide provider transport metadata that may exist in legacy AI output. */
export function sanitizeGeneratedText(text: string): string {
  const match = INTERNAL_MODEL_METADATA.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}
