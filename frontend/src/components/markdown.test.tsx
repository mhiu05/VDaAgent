import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { MarkdownContent, normalizeMarkdownText } from "./markdown";

describe("normalizeMarkdownText", () => {
  it("extracts Markdown from serialized provider content blocks", () => {
    const value = "[{'type': 'text', 'text': '**1. Xu hướng chính**\\n\\nNội dung'}, {'type': 'text', 'text': 'Tiếp theo', 'extras': {'signature': 'secret'}}]";

    expect(normalizeMarkdownText(value)).toBe("**1. Xu hướng chính**\n\nNội dung\nTiếp theo");
  });

  it("leaves ordinary Markdown unchanged", () => {
    expect(normalizeMarkdownText("**Xu hướng**\n\n- Một điểm")).toBe("**Xu hướng**\n\n- Một điểm");
  });
  it("renders an inline Null metric without a list bullet", () => {
    const { container } = render(
      <MarkdownContent text={'## 2. Chất lượng dữ liệu\n- Null: Cột `Sales_Rep` có giá trị trống.\n- Cardinality/uniqueness:\n  - `Transaction_ID`: duy nhất'} />,
    );

    expect(container.querySelector(".report-markdown-list-section")?.textContent).toBe("Null");
    expect(container.querySelector(".report-markdown-list-detail")?.textContent).toContain("Cột Sales_Rep có giá trị trống.");
  });
});
