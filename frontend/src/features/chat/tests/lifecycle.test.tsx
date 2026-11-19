import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../../../app/i18n/messages";
import { createChatMockService } from "../../../mocks/chat/entry";
import {
  createChatRepository,
  isBundle,
  migrateBundle,
} from "../../../mocks/chat/repository";
import { makeBundle, agents } from "../../../mocks/chat/fixtures";
import { createStorage } from "../../../mocks/core/storage";
import { fixtureEpoch } from "../../../mocks/core/clock";
import type { MockContext, Scenario } from "../../../mocks/core/scenarios";
import { applyMessage, canUse } from "../model/types";
import { Composer, validateFiles } from "../components/Composer";
import { MarkdownContent } from "../components/MarkdownContent";
let scope = 0;
const context = (scenario: Scenario = "success"): MockContext => ({
  clock: { now: () => new Date(fixtureEpoch), sleep: async () => {} },
  seed: 42,
  storage: createStorage("localStorage"),
  scenario,
});
beforeEach(() => {
  scope++;
});
describe("persistent chat and lifecycle", () => {
  it("migrates v1 text snapshots and rejects malformed metadata", () => {
    const b = makeBundle("success");
    const migrated = migrateBundle({ ...b, version: 1 });
    expect(migrated?.version).toBe(2);
    expect(migrated?.conversations[0].messages).toEqual(
      b.conversations[0].messages,
    );
    expect(isBundle({ version: 2, conversations: [null] })).toBe(false);
    const invalid = structuredClone(b);
    invalid.conversations[0].attachments = [
      { id: "a", name: "x", size: NaN, type: "csv", presence: "memory" },
    ];
    expect(isBundle(invalid)).toBe(false);
  });
  it("keeps history and drafts isolated and resets just one principal", async () => {
    const s = createChatMockService(context());
    const a = `a-${scope}`,
      b = `b-${scope}`;
    const loaded = await s.load(a);
    const cid = loaded.data!.conversations[0].id;
    await s.saveDraft(a, cid, "draft A", []);
    await s.saveDraft(b, cid, "draft B", []);
    expect((await s.load(a)).data!.conversations[0].draft).toBe("draft A");
    const fresh = createChatMockService(context());
    expect((await fresh.load(a)).data!.conversations[0].draft).toBe("draft A");
    await s.reset(a);
    expect((await s.load(b)).data!.conversations[0].draft).toBe("draft B");
    expect((await s.load(a)).data!.conversations[0].draft).toBe("");
  });
  it.each(["success", "duplicate-delivery", "out-of-order"] as Scenario[])(
    "deduplicates request and message updates in %s",
    async (scenario) => {
      const s = createChatMockService(context(scenario));
      const id = `${scenario}-${scope}`;
      const c = (await s.load(id)).data!.conversations[0];
      const publish = vi.fn();
      const signal = new AbortController().signal;
      await Promise.all([
        s.send(id, c.id, "Question", [], "same", signal, publish),
        s.send(id, c.id, "Question", [], "same", signal, publish),
      ]);
      const result = await s.load(id);
      expect(
        result.data!.conversations[0].messages.filter(
          (m) => m.requestId === "same",
        ),
      ).toHaveLength(1);
      expect(
        result.data!.conversations[0].messages.filter(
          (m) => m.id === "same-reply",
        ),
      ).toHaveLength(1);
      expect(result.data!.conversations[0].messages.at(-1)?.body).not.toBe(
        "Old update",
      );
    },
  );
  it("retains partial answers on interruption and does not invent an acknowledged answer", async () => {
    for (const scenario of ["interrupted", "unknown-ack"] as Scenario[]) {
      const s = createChatMockService(context(scenario));
      const id = `${scenario}-${scope}`;
      const c = (await s.load(id)).data!.conversations[0];
      await s.send(
        id,
        c.id,
        "Question",
        [],
        "r",
        new AbortController().signal,
        () => {},
      );
      const result = (await s.load(id)).data!.conversations[0];
      expect(result.messages.at(-1)?.state).toBe("response-interrupted");
      if (scenario === "unknown-ack")
        expect(result.messages.at(-1)?.author).toBe("user");
    }
  });
  it("replay has partial updates and cancellation is unavailable by default", async () => {
    const s = createChatMockService(context("demo-replay"));
    expect(s.delivery).toBe("replay");
    expect(createChatMockService(context("offline")).connection).toBe("offline");
    const id = `replay-${scope}`;
    const c = (await s.load(id)).data!.conversations[0];
    const states: string[] = [];
    await s.send(id, c.id, "Q", [], "r", new AbortController().signal, (b) =>
      states.push(b.conversations[0].messages.at(-1)!.state),
    );
    expect(states).toContain("responding");
    expect(states.at(-1)).toBe("complete");
    expect(await createChatMockService(context()).cancel(id, "r")).toBe(false);
  });
  it("gates unknown capabilities and rejects empty or missing-byte sends", async () => {
    expect(canUse("unknown")).toBe(false);
    expect(canUse("available")).toBe(true);
    expect(canUse("unsupported")).toBe(false);
    const s = createChatMockService(context("unsupported-capability"));
    expect(s.catalog()[0].capabilities.attachments).toBe("unsupported");
    const c = (await s.load(`unsupported-${scope}`)).data!.conversations[0];
    expect(
      (
        await s.send(
          `unsupported-${scope}`,
          c.id,
          " ",
          [],
          "a",
          new AbortController().signal,
          () => {},
        )
      ).error,
    ).toBeDefined();
  });
  it("validates snapshots and keeps blocked IDB usable in memory", async () => {
    expect(isBundle({ version: 2, conversations: [{ id: "corrupt" }] })).toBe(
      false,
    );
    const repo = createChatRepository(true);
    const b = makeBundle("empty");
    await repo.write("a", b);
    expect(await repo.read("a")).toEqual(b);
    expect(repo.degraded).toBe(true);
    await repo.reset("a");
    expect(await repo.read("a")).toBeNull();
  });
  it("ignores stale sequence updates", () => {
    const m = makeBundle("success").conversations[0].messages[0];
    expect(applyMessage([m], { ...m, sequence: 0, body: "stale" })).toEqual([
      m,
    ]);
  });
});
describe("composer and Markdown safety", () => {
  it("offers cancellation from the agent capability outside mock replay", () => {
    const cancel = vi.fn();
    const c = makeBundle("empty").conversations[0];
    render(
      <I18nextProvider i18n={i18n}>
        <Composer
          conversation={c}
          agents={agents.map((agent) => ({
            ...agent,
            capabilities: { ...agent.capabilities, cancel: "available" },
          }))}
          pending
          replay={false}
          offline={false}
          bytes={{ current: new Map() }}
          allocateId={() => "file"}
          onDraft={() => {}}
          onSend={() => {}}
          onCancel={cancel}
          prompt=""
        />
      </I18nextProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("chat:cancelResponse") }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not send during IME, whitespace or Shift+Enter", () => {
    const send = vi.fn();
    const c = makeBundle("empty").conversations[0];
    render(
      <I18nextProvider i18n={i18n}>
        <Composer
          conversation={c}
          agents={agents}
          pending={false}
          replay={false}
          offline={false}
          bytes={{ current: new Map() }}
          allocateId={() => "file"}
          onDraft={() => {}}
          onSend={send}
          onCancel={() => {}}
          prompt=""
        />
      </I18nextProvider>,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Xin chào" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("rejects unsupported/oversize/excess attachments", () => {
    expect(
      validateFiles([new File(["a"], "a.csv", { type: "text/csv" })], 0),
    ).toBe(true);
    expect(
      validateFiles(
        [new File(["a"], "a.exe", { type: "application/octet-stream" })],
        0,
      ),
    ).toBe(false);
    expect(
      validateFiles(
        Array.from(
          { length: 6 },
          () => new File(["a"], "a.csv", { type: "text/csv" }),
        ),
        0,
      ),
    ).toBe(false);
    const f = new File(["x"], "a.pdf", { type: "application/pdf" });
    Object.defineProperty(f, "size", { value: 11 * 1024 * 1024 });
    expect(validateFiles([f], 0)).toBe(false);
  });
  it("renders no raw HTML, remote image, executable links or second h1", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MarkdownContent
          body={
            "# Title\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n![remote](https://evil.test/a.png)\n[good](https://example.com)"
          }
        />
      </I18nextProvider>,
    );
    expect(container.querySelector("script,img,h1")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByRole("link", { name: "good" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
  it("shows a link title and its supplied summary on hover", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MarkdownContent body={'[Acta Mathematica](https://example.com "Tạp chí toán học bình duyệt.")'} />
      </I18nextProvider>,
    );
    await userEvent.hover(screen.getByRole("link", { name: "Acta Mathematica" }));
    expect(await screen.findByText("Acta Mathematica", { selector: ".link-preview strong" })).toBeInTheDocument();
    expect(screen.getByText("Tạp chí toán học bình duyệt.")).toBeInTheDocument();
  });
});
