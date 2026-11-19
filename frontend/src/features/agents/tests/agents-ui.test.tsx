// Agents and the builder in the real shell (docs 05, 14 "Builder screens", 04 "Folder viewer").
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../../app/App";
import { createMockServices } from "../../../app/services/create-mock-services";
import {
  AGENT_BUILDER_KEY, type AgentBuilderService, type BuilderAgent, type BuilderJob, type Routine,
} from "../services/builder-service";

beforeAll(async () => {
  await import("../pages/AgentsPage");
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const agent = (id: string, name: string, isLead = false): BuilderAgent => ({
  id, slug: id, name, avatar: { emoji: name[0], color: "#2563eb" }, description: `${name} mô tả`, origin: "starter",
  isLead, status: "idle", statusDetail: null, createdAt: "2026-10-01T00:00:00Z",
});

function fake() {
  let onJob: (job: BuilderJob) => void = () => undefined;
  const routines: Routine[] = [];
  const ok = <T,>(data: T) => Promise.resolve({ data });
  const service: AgentBuilderService = {
    agents: () => ok([agent("lead", "Điều phối", true), agent("data", "Data")]),
    agent: (id) => ok(agent(id, "Data")),
    updateAgent: vi.fn((id, p) => ok({ ...agent(id, "Data"), ...p })),
    deleteAgent: vi.fn(() => ok(null)),
    create: vi.fn((n) => ok(n.slug === "taken" ? "" : "j1").then((r) => n.slug === "taken"
      ? { error: { code: "slugTaken", messageKey: "", retryable: false } } : r)),
    reset: vi.fn(() => ok("j9")),
    job: vi.fn((id) => ok({ id, agentId: null, kind: "agent_create", status: "running" as const, output: "" })),
    onJob: (l) => { onJob = l; return () => undefined; },
    prompt: () => ok({ text: "Bạn là Data.", commit: "abc" }),
    savePrompt: vi.fn((_, text) => ok({ text, commit: "def" })),
    skills: () => ok([{ name: "xlsx", description: "Excel", catalogId: "c1", author: "user:alice" }]),
    catalogSkills: () => ok([
      { id: "c1", name: "xlsx", title: "Excel", description: "Bảng tính", tags: ["office"] },
      { id: "c2", name: "pdf", title: "PDF", description: "Tài liệu", tags: ["docs"] },
    ]),
    skillPreview: () => ok({ skillMd: "# PDF skill", files: ["SKILL.md", "run.py"], hasCode: true }),
    installSkill: vi.fn(() => ok("j2")),
    removeSkill: vi.fn(() => ok("j3")),
    presets: () => ok([{ id: "data", title: "Dữ liệu", description: "pandas", packages: ["pandas"] }]),
    packages: () => ok([{ name: "pandas", spec: "pandas>=2" }]),
    addPackages: vi.fn(() => ok("j4")),
    removePackage: vi.fn(() => ok("j5")),
    routines: () => ok([...routines]),
    saveRoutine: vi.fn((_, name, r) => {
      const saved = { name, ...r, nextFires: ["2026-10-19T01:00:00Z"], lastStartedAt: null, lastEndedAt: null, error: null };
      routines.push(saved);
      return ok(saved);
    }),
    deleteRoutine: vi.fn(() => ok(null)),
    credentialSets: () => ok([{ set: "warehouse", description: "Kho", keys: ["WAREHOUSE_DSN"] }]),
    credentials: () => ok([]),
    saveCredentials: vi.fn((_, sets) => ok(sets.map((s: string) => ({ set: s, keys: ["WAREHOUSE_DSN"] })))),
    starters: () => ok([{ slug: "chart", name: "Chart", avatar: { emoji: "📊", color: "#16a34a" }, description: "Biểu đồ", presets: [], credentials: [] }]),
    tree: vi.fn((_, path) => ok(path === "" ? [
      { name: ".venv", type: "dir" as const, size: null, mtime: null, items: null, symlinkTarget: null },
      { name: "prompts", type: "dir" as const, size: 10, mtime: null, items: 1, symlinkTarget: null },
    ] : [{ name: "system.md", type: "file" as const, size: 12, mtime: null, items: null, symlinkTarget: null }])),
    file: vi.fn(() => ok({ kind: "text" as const, text: "# Vai trò Data", mediaType: "text/plain" })),
    log: () => ok([{ commit: "abc1234def", author: "contoso-harness", message: "tạo agent", at: "2026-10-01T00:00:00Z", execId: null }]),
    diff: () => ok("diff --git a/x b/x"),
    archiveUrl: (id, path) => `/api/agents/${id}/archive?path=${path}`,
  };
  return { service, emit: (job: BuilderJob) => onJob(job) };
}

async function mount(path: string) {
  const services = createMockServices();
  await services.auth.login("user@vdaagent.test", "DemoUser!2026");
  const f = fake();
  services.workspace[AGENT_BUILDER_KEY] = f.service;
  history.replaceState({}, "", path);
  render(<App services={services} />);
  return f;
}

describe("agent builder", () => {
  it("finishes a tracked job even when its terminal realtime event is missed", async () => {
    const { service } = await mount("/agents/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Mã (slug)"), "offline-agent");
    await user.selectOptions(screen.getByLabelText("Mẫu"), "chart");
    await user.click(screen.getByRole("button", { name: "Tạo agent" }));
    await waitFor(() => expect(service.job).toHaveBeenCalledWith("j1"));
    vi.mocked(service.job).mockResolvedValue({ data: {
      id: "j1", agentId: "data", kind: "agent_create", status: "done", output: "",
    } });
    await waitFor(() => expect(location.pathname).toBe("/agents/data/info"), { timeout: 6000 });
  });

  it("creates an agent from a starter and opens it when the job is done", async () => {
    const { service, emit } = await mount("/agents/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Mã (slug)"), "chart-2");
    await user.selectOptions(screen.getByLabelText("Mẫu"), "chart");
    expect(screen.getByLabelText("Tên hiển thị")).toHaveValue("Chart");
    await user.click(screen.getByRole("button", { name: "Tạo agent" }));
    expect(service.create).toHaveBeenCalledWith({ slug: "chart-2", name: "Chart", avatar: { emoji: "📊", color: "#16a34a" },
      description: "Biểu đồ", starter: "chart", presets: [], credentials: [] });
    expect(await screen.findByText("Đang cài… (tạo agent)")).toBeInTheDocument();
    emit({ id: "j1", agentId: "data", kind: "agent_create", status: "done", output: "" });
    await waitFor(() => expect(location.pathname).toBe("/agents/data/info"));
  });

  it("edits the role, warns past 8,000 characters and saves", async () => {
    const { service } = await mount("/agents/data/role");
    const box = await screen.findByLabelText("Vai trò");
    expect(box).toHaveValue("Bạn là Data.");
    const user = userEvent.setup();
    await user.clear(box);
    await user.click(box);
    await user.paste("x".repeat(8001));
    expect(screen.getByText(/dài hơn 8.000 ký tự/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(service.savePrompt).toHaveBeenCalledWith("data", "x".repeat(8001));
    expect(await screen.findByText("Đã lưu.")).toBeInTheDocument();
  });

  it("filters the catalog, previews with a code warning and installs, showing failed output", async () => {
    const { service, emit } = await mount("/agents/data/skills");
    const user = userEvent.setup();
    expect(await screen.findByText("Đã cài")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Mọi nhãn"), "docs");
    expect(screen.queryByRole("button", { name: /Excel/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /PDF/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/có mã chạy được/)).toBeInTheDocument();
    expect(within(dialog).getByText("run.py")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cài" }));
    expect(service.installSkill).toHaveBeenCalledWith("data", { catalogId: "c2" });
    emit({ id: "j2", agentId: "data", kind: "skill_install", status: "failed", output: "pip: no such skill" });
    expect(await screen.findByText("Lỗi: cài kỹ năng")).toBeInTheDocument();
    expect(screen.getByText("pip: no such skill")).toBeInTheDocument();
  });

  it("creates a routine with the schedule picker", async () => {
    const { service } = await mount("/agents/data/routines");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Lịch mới" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tên (a-z, 0-9, -)"), "bao-cao-sang");
    await user.type(within(dialog).getByLabelText("Nội dung yêu cầu"), "Tóm tắt tồn kho");
    await user.selectOptions(within(dialog).getByLabelText("Thời gian"), "weekly");
    await user.click(within(dialog).getByLabelText("Thứ Tư"));
    expect(within(dialog).getByText("Hằng tuần vào Thứ Hai, Thứ Tư lúc 08:00")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Lưu" }));
    expect(service.saveRoutine).toHaveBeenCalledWith("data", "bao-cao-sang", { prompt: "Tóm tắt tồn kho", cron: "0 8 * * 1,3", enabled: true });
    expect(await screen.findByText("Hằng tuần vào Thứ Hai, Thứ Tư lúc 08:00")).toBeInTheDocument();
  });

  it("toggles a credential set showing key names only", async () => {
    const { service } = await mount("/agents/data/data");
    const user = userEvent.setup();
    expect(await screen.findByText("WAREHOUSE_DSN")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "warehouse" }));
    expect(service.saveCredentials).toHaveBeenCalledWith("data", ["warehouse"]);
  });

  it("browses the folder, opens a file and picks a version", async () => {
    const { service } = await mount("/agents/data/folder");
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: /\.venv/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /prompts/ }));
    await user.click(await screen.findByRole("button", { name: /system\.md/ }));
    expect(await screen.findByRole("heading", { name: "Vai trò Data" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Phiên bản"), "abc1234def");
    await waitFor(() => expect(service.file).toHaveBeenLastCalledWith("data", "prompts/system.md", "abc1234def", expect.anything()));
    expect(screen.getByRole("link", { name: /Tải về \(\.zip\)/ })).toHaveAttribute("href", "/api/agents/data/archive?path=prompts");
  });
});
