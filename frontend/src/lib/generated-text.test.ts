import { describe, expect, it } from "vitest";
import { sanitizeGeneratedText } from "@/lib/generated-text";

describe("sanitizeGeneratedText", () => {
  it("removes provider extras and a signature from historical agent output", () => {
    const text = "## Nhận định\nDữ liệu cần rà soát.\n'extras': {'signature': 'very-long-private-value'}";

    expect(sanitizeGeneratedText(text)).toBe("## Nhận định\nDữ liệu cần rà soát.");
  });

  it("keeps ordinary markdown unchanged", () => {
    expect(sanitizeGeneratedText("- Không có null\n- Đã kiểm chứng")).toBe(
      "- Không có null\n- Đã kiểm chứng"
    );
  });
});
