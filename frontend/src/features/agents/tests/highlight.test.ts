// Folder viewer rendering (doc 04 "Rendering in the UI").
import { describe, expect, it } from "vitest";
import { highlight, languageOf, viewKind } from "../model/highlight";

describe("folder viewer rendering", () => {
  it("picks the view for a path", () => {
    expect(viewKind("prompts/system.md")).toBe("markdown");
    expect(viewKind("helpers/a.py")).toBe("code");
    expect(viewKind("routines/sang.yaml")).toBe("code");
    expect(viewKind("files/units.csv")).toBe("csv");
    expect(viewKind("notes.txt")).toBe("text");
    expect(languageOf("pyproject.toml")).toBe("toml");
  });

  it("tokenizes comments, strings, numbers and keywords", () => {
    const py = highlight('def f(x):  # note\n    return "a" + 1', "python");
    expect(py.map((t) => t.text).join("")).toBe('def f(x):  # note\n    return "a" + 1');
    expect(py.filter((t) => t.kind).map((t) => [t.kind, t.text])).toEqual([
      ["keyword", "def"], ["comment", "# note"], ["keyword", "return"], ["string", '"a"'], ["number", "1"],
    ]);
    const yaml = highlight("cron: '0 8 * * *'\nenabled: true", "yaml");
    expect(yaml.filter((t) => t.kind).map((t) => [t.kind, t.text])).toEqual([
      ["key", "cron:"], ["string", "'0 8 * * *'"], ["key", "enabled:"], ["keyword", "true"],
    ]);
    expect(highlight('{"a": 1}', "json").filter((t) => t.kind).map((t) => t.kind)).toEqual(["key", "number"]);
  });
});
