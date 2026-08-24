import { describe, expect, it } from "vitest";
import { normalizeMarkdownText } from "./markdown";

describe("normalizeMarkdownText", () => {
  it("extracts Markdown from serialized provider content blocks", () => {
    const value = "[{'type': 'text', 'text': '**1. Xu hướng chính**\\n\\nNội dung'}, {'type': 'text', 'text': 'Tiếp theo', 'extras': {'signature': 'secret'}}]";

    expect(normalizeMarkdownText(value)).toBe("**1. Xu hướng chính**\n\nNội dung\nTiếp theo");
  });

  it("leaves ordinary Markdown unchanged", () => {
    expect(normalizeMarkdownText("**Xu hướng**\n\n- Một điểm")).toBe("**Xu hướng**\n\n- Một điểm");
  });
});
