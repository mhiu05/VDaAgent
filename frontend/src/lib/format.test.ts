import { describe, expect, it } from "vitest";
import { formatPercent } from "@/lib/format";
import { parseSseChunk } from "@/lib/sse";

describe("formatPercent", () => {
  it("renders ratios as a percentage", () => {
    expect(formatPercent(0.125)).toBe("12,5%");
  });
});

describe("parseSseChunk", () => {
  it("retains split frames until the delimiter arrives", () => {
    const first = parseSseChunk('event: token\ndata: {"text":"xin');
    expect(first.events).toHaveLength(0);
    const second = parseSseChunk(' chào"}\n\n', first.remainder);
    expect(second.events).toEqual([{ event: "token", data: { text: "xin chào" } }]);
  });

  it("preserves event ids for duplicate tolerance", () => {
    expect(parseSseChunk("id: milestone-1\nevent: ready\ndata: {}\n\n").events).toEqual([
      { id: "milestone-1", event: "ready", data: {} },
    ]);
  });
});
