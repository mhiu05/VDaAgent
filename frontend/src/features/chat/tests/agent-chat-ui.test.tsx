// The target chat page in the real shell (doc 14 "Chat app layout: three panes").
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../../app/App";
import type { Session } from "../../../shared/contracts/auth";
import { createMockServices } from "../../../app/services/create-mock-services";
import { ids } from "../../../mocks/core/ids";
import {
  AGENT_CHAT_KEY, type AgentChatEvent, type AgentChatService, type ChatMessage, type ChatTask,
  type ChatThread, type TeamAgent,
} from "../services/agent-chat-service";

beforeAll(async () => {
  await Promise.all([import("../pages/ChatRoute"), import("../pages/AgentChatPage")]);
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const agent = (id: string, name: string, isLead = false): TeamAgent => ({
  id, slug: id, name, avatar: { emoji: name[0], color: "#0F766E" }, description: `${name} desc`, isLead,
  status: "idle", statusDetail: null,
});
const AGENTS = [agent("lead", "Điều phối", true), agent("data", "Data"), agent("chart", "Chart")];
const member = (a: TeamAgent) => ({ type: "agent" as const, id: a.id, slug: a.slug, name: a.name, avatar: a.avatar, isLead: a.isLead });
// The logged-in mock principal: "mine" is decided by sender id, so sent messages carry its id.
const USER = { type: "user" as const, id: ids.user, name: "alice", avatar: null };
const ask: ChatMessage = {
  id: 2, threadId: "tl", sender: { type: "agent", id: "lead", slug: "lead", name: "Điều phối", avatar: AGENTS[0].avatar },
  text: "Chọn **định dạng**", choices: [{ id: "pdf", label: "PDF" }, { id: "xlsx", label: "Excel" }],
  replyTo: null, choiceId: null, attachments: [{ id: "f1", filename: "q3.bin", mime: "application/octet-stream", size: 2048, url: "/api/attachments/f1" }],
  reportRefs: [], createdAt: "2026-10-17T02:00:00Z",
};
const RUNNING: ChatTask = { id: 42, description: "Báo cáo Q3", status: "running", createdAt: "2026-10-17T01:00:00Z", startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), endedAt: null };

function fakeService() {
  const listeners = new Set<(e: AgentChatEvent) => void>();
  let nextId = 10;
  const threads: ChatThread[] = [
    { id: "td", kind: "direct", name: null, members: [USER, member(AGENTS[1])], lastMessage: null, unread: 3, readOnly: false, lastMessageAt: "2026-10-17T05:00:00Z" },
    { id: "tl", kind: "direct", name: null, members: [USER, member(AGENTS[0])], lastMessage: ask, unread: 0, readOnly: false, lastMessageAt: "2026-10-17T02:00:00Z" },
  ];
  const service: AgentChatService = {
    agents: async () => ({ data: AGENTS }),
    threads: async () => ({ data: threads }),
    messages: async (id) => ({ data: id === "tl" ? [ask] : [] }),
    send: vi.fn(async (threadId, m) => ({ data: {
      ...ask, id: nextId++, threadId, sender: { ...USER }, text: m.text, choices: [], attachments: [],
      replyTo: m.replyTo ?? null, choiceId: m.choiceId ?? null, createdAt: "2026-10-17T03:00:00Z",
    } })),
    markRead: vi.fn(async () => undefined),
    createGroup: vi.fn(async (name, ids) => ({ data: {
      id: "tg", kind: "group" as const, name, members: [USER, ...AGENTS.filter((a) => ids.includes(a.id)).map(member)],
      lastMessage: null, unread: 0, readOnly: false, lastMessageAt: "2026-10-17T06:00:00Z",
    } })),
    updateGroup: vi.fn(async () => ({ error: { code: "other", messageKey: "", retryable: false } })),
    tasks: async () => ({ data: [RUNNING, { ...RUNNING, id: 43, status: "queued" as const, startedAt: null }] }),
    cancelTask: vi.fn(async () => ({ data: { ...RUNNING, status: "cancelled" as const } })),
    presence: vi.fn(async () => undefined),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
  return { service, emit: (e: AgentChatEvent) => listeners.forEach((l) => l(e)) };
}

async function mount(path: string, options: { workspace?: Record<string, unknown>; session?: Partial<Session> } = {}) {
  const services = createMockServices();
  const login = services.auth.login.bind(services.auth);
  const restore = services.auth.restore.bind(services.auth);
  const patch = (session: Session): Session => ({ ...session, ...options.session });
  services.auth.login = async (email, password) => {
    const r = await login(email, password);
    return r.data ? { data: patch(r.data) } : r;
  };
  services.auth.restore = async () => {
    const r = await restore();
    return r.data ? { data: patch(r.data) } : r;
  };
  await services.auth.login("user@vdaagent.test", "DemoUser!2026");
  const fake = fakeService();
  services.workspace[AGENT_CHAT_KEY] = fake.service;
  Object.assign(services.workspace, options.workspace ?? {});
  history.replaceState({}, "", path);
  render(<App services={services} />);
  await screen.findByRole("navigation", { name: "Trò chuyện" }, { timeout: 5000 });
  return fake;
}

describe("target chat", () => {
  it.each(["before", "during"])("discards pagination started %s a reconnect read", async (timing) => {
    const fake = fakeService();
    let offline = false;
    let finishOlder!: (value: { data: ChatMessage[] }) => void;
    let finishLatest!: (value: { data: ChatMessage[] }) => void;
    const message = (id: number) => ({ ...ask, id, text: `History ${id}`, choices: [], attachments: [] });
    fake.service.messages = async (_id, before) => before
      ? new Promise((resolve) => { finishOlder = resolve; })
      : offline ? new Promise((resolve) => { finishLatest = resolve; })
      : { data: Array.from({ length: 50 }, (_, i) => message(51 + i)) };
    await mount("/chat/tl", { workspace: { [AGENT_CHAT_KEY]: fake.service } });
    await screen.findByText("History 100");
    offline = true;
    if (timing === "during") fake.emit({ type: "reconnect" });
    await userEvent.click(screen.getByRole("button", { name: /Tải tin cũ hơn|older/i }));
    if (timing === "before") fake.emit({ type: "reconnect" });
    finishLatest({ data: Array.from({ length: 50 }, (_, i) => message(101 + i)) });
    await screen.findByText("History 150");
    finishOlder({ data: [message(1)] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("History 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tải tin cũ hơn|older/i })).toBeInTheDocument();
  });

  it("keeps older history reachable after more than a page of offline messages", async () => {
    const fake = fakeService();
    let offline = false;
    fake.service.messages = async (_id, before) => ({ data: !offline ? [ask]
      : before ? [{ ...ask, id: 40, text: "Tin trong khoảng mất kết nối", choices: [], attachments: [] }]
      : Array.from({ length: 50 }, (_, i) => ({ ...ask, id: 100 + i,
        text: `Tin mới ${i}`, choices: [], attachments: [] })) });
    await mount("/chat/tl", { workspace: { [AGENT_CHAT_KEY]: fake.service } });
    await screen.findByText("định dạng");
    offline = true;
    fake.emit({ type: "reconnect" });
    await screen.findByText("Tin mới 49");
    const older = screen.getByRole("button", { name: /Tải tin cũ hơn|older/i });
    await userEvent.click(older);
    expect(await screen.findByText("Tin trong khoảng mất kết nối")).toBeInTheDocument();
  });

  it("pins the lead, renders the conversation, inline thinking and status, and marks read", async () => {
    const { service, emit } = await mount("/chat/tl");
    const list = screen.getByRole("navigation", { name: "Trò chuyện" });
    const rows = within(list).getAllByRole("link");
    expect(rows[0]).toHaveTextContent("Điều phối");
    expect(rows[1]).toHaveTextContent("Data");
    expect(rows[1]).toHaveTextContent("3");
    expect(await screen.findByText("định dạng")).toBeInTheDocument();
    expect(screen.getByText("q3.bin")).toBeInTheDocument();
    expect(screen.getByText("1 việc đang chờ")).toBeInTheDocument();
    const thinking = screen.getByText("Thinking").closest("details");
    expect(thinking).not.toHaveAttribute("open");
    expect(document.querySelector('.ac-header .ac-face[data-status="busy"]')).toBeInTheDocument();
    await userEvent.click(screen.getByText("Thinking"));
    expect(thinking).toHaveAttribute("open");
    expect(screen.getByText("Báo cáo Q3", { selector: ".ac-thinking-body p" })).toBeInTheDocument();
    await waitFor(() => expect(service.markRead).toHaveBeenCalledWith("tl", 2));
    expect(service.presence).toHaveBeenCalled();
    emit({ type: "status", agentId: "lead", status: "routine", statusDetail: "Báo cáo sáng" });
    expect((await screen.findAllByText("đang chạy lịch Báo cáo sáng")).length).toBeGreaterThan(0);
  });

  it("answers a choice once, then locks the chips", async () => {
    const { service } = await mount("/chat/tl");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Excel" }));
    expect(service.send).toHaveBeenCalledWith("tl", { text: "Excel", files: [], choiceId: "xlsx", replyTo: 2 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Excel" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
  });

  it("sends with Enter, appends SSE messages once, and stops inline thinking", async () => {
    const { service, emit } = await mount("/chat/tl");
    const user = userEvent.setup();
    const box = await screen.findByRole("textbox", { name: "Tin nhắn" });
    await user.type(box, "Xin chào{Enter}");
    expect(service.send).toHaveBeenCalledWith("tl", { text: "Xin chào", files: [] });
    const pane = screen.getByRole("region", { name: "Điều phối" });
    expect(await within(pane).findByText("Xin chào")).toBeInTheDocument();
    const mine = within(pane).getByText("Xin chào").closest(".ac-message") as HTMLElement;
    expect(mine.querySelector(".ac-message-footer time")).toBeInTheDocument();
    await user.click(within(mine).getByRole("button", { name: "Sao chép tin nhắn" }));
    expect(await screen.findByText("Đã sao chép")).toBeInTheDocument();
    await user.click(within(mine).getByRole("button", { name: "Chỉnh sửa tin nhắn" }));
    const editor = within(mine).getByRole("textbox", { name: "Chỉnh sửa tin nhắn" });
    await user.clear(editor);
    await user.type(editor, "Xin chào đã sửa");
    await user.click(within(mine).getByRole("button", { name: "Lưu chỉnh sửa" }));
    expect(within(mine).getByText("Xin chào đã sửa")).toBeInTheDocument();
    const reply = { ...ask, id: 20, text: "Đã nhận", choices: [], attachments: [] };
    emit({ type: "message", message: reply });
    emit({ type: "message", message: reply });
    expect(await within(pane).findAllByText("Đã nhận")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Dừng suy nghĩ" }));
    // one click stops the running task: no confirmation step
    expect(screen.queryByRole("button", { name: "Hủy việc" })).not.toBeInTheDocument();
    expect(service.cancelTask).toHaveBeenCalledTimes(1);
    expect(service.cancelTask).toHaveBeenCalledWith(42);
    expect(await screen.findByText("Interrupted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi" })).toBeInTheDocument();
  });

  it("shows only real messages in a Report direct chat, never a made-up reference", async () => {
    const { service } = fakeService();
    const report = agent("report", "Report");
    const reply: ChatMessage = {
      ...ask, id: 30, threadId: "tr", sender: { ...member(report), type: "agent" },
      text: "Đã soạn báo cáo R1, chưa có nguồn liên kết.", choices: [], attachments: [],
    };
    const thread: ChatThread = {
      id: "tr", kind: "direct", name: null, members: [USER, member(report)], lastMessage: reply,
      unread: 0, readOnly: false, lastMessageAt: "2026-10-17T07:00:00Z",
    };
    await mount("/chat/tr", { workspace: { [AGENT_CHAT_KEY]: {
      ...service,
      agents: async () => ({ data: [...AGENTS, report] }),
      threads: async () => ({ data: [thread] }),
      messages: async (id: string) => ({ data: id === "tr" ? [reply] : [] }),
      tasks: async () => ({ data: [] }),
    } } });
    const pane = await screen.findByRole("region", { name: "Report" });
    expect(await within(pane).findByText("Đã soạn báo cáo R1, chưa có nguồn liên kết.")).toBeInTheDocument();
    expect(within(pane).queryByText(/Dữ liệu minh họa|Demo data|Nguồn tham khảo|Acta Mathematica/)).toBeNull();
    // no injected citation: the only links are the app's own (e.g. the header's agent link)
    const external = within(pane).queryAllByRole("link")
      .filter((a) => /^https?:\/\//.test(a.getAttribute("href") ?? ""));
    expect(external).toHaveLength(0);
    expect(pane.querySelectorAll(".ac-reference-demo")).toHaveLength(0);
  });

  it("opens an attachment in the document pane instead of the information pane", async () => {
    await mount("/chat/tl");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mở q3.bin trong trình xem tài liệu" }));
    const pane = screen.getByRole("complementary", { name: "Xem tài liệu" });
    expect(within(pane).getByRole("heading", { name: "q3.bin" })).toBeInTheDocument();
    expect(within(pane).getByText(/Định dạng này chưa thể hiển thị trực tiếp/)).toBeInTheDocument();
  });

  it("opens images in a full-screen zoomable viewer", async () => {
    const { emit } = await mount("/chat/tl");
    emit({ type: "message", message: {
      ...ask, id: 30, text: "", choices: [],
      attachments: [{ id: "image-1", filename: "mat-bang.png", mime: "image/png", size: 512, url: "data:image/png;base64,iVBORw0KGgo=" }],
    } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mở mat-bang.png trong trình xem tài liệu" }));
    const viewer = screen.getByRole("dialog", { name: "Trình xem ảnh toàn màn hình" });
    expect(within(viewer).getByAltText("mat-bang.png")).toBeInTheDocument();
    await user.click(within(viewer).getByRole("button", { name: "Phóng to" }));
    expect(within(viewer).getByText("125%")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Trình xem ảnh toàn màn hình" })).not.toBeInTheDocument();
  });

  it("offers a browser pop-out action for Markdown documents", async () => {
    const { emit } = await mount("/chat/tl");
    emit({ type: "message", message: {
      ...ask, id: 31, text: "", choices: [],
      attachments: [{ id: "md-1", filename: "bao-cao.md", mime: "text/markdown", size: 64, url: "data:text/markdown,%23%20Bao%20cao" }],
    } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mở bao-cao.md trong trình xem tài liệu" }));
    const pane = screen.getByRole("complementary", { name: "Xem tài liệu" });
    const popup = within(pane).getByRole("link", { name: "Mở bao-cao.md trong tab trình duyệt mới" });
    expect(popup).toHaveAttribute("target", "_blank");
    expect(popup).toHaveAttribute("rel", "noopener noreferrer");
    expect(popup.getAttribute("href")).toContain("/chat/file-preview?");
    expect(popup.getAttribute("href")).not.toBe("data:text/markdown,%23%20Bao%20cao");
  });

  it("shows the domain banner and disables the composer when the domain is unavailable", async () => {
    await mount("/chat/tl", { session: { domain: { id: "fabrikam", name: "Fabrikam", status: "unavailable" } } });
    expect(await screen.findByText("Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tin nhắn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dừng suy nghĩ" })).toBeInTheDocument();
  });

  it("creates a group from the dialog and opens it", async () => {
    const { service } = await mount("/chat/td");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Nhóm mới" }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Tạo nhóm" });
    await user.type(within(dialog).getByRole("textbox"), "Nhóm Q3");
    await user.click(within(dialog).getByRole("checkbox", { name: /Data/ }));
    expect(create).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Chart/ }));
    await user.click(create);
    expect(service.createGroup).toHaveBeenCalledWith("Nhóm Q3", ["data", "chart"]);
    expect(await screen.findByRole("heading", { name: /Nhóm Q3/ })).toBeInTheDocument();
    expect(location.pathname).toBe("/chat/tg");
  });

  it("keeps a room's group agents across re-reads and out of the personal group dialog", async () => {
    const groupLead = agent("glead", "Điều phối nhóm", true);
    const groupData = agent("gdata", "Data nhóm");
    const room: ChatThread = {
      id: "room", kind: "group", name: "Sales Team", group: { id: "g1", name: "Sales Team", status: "active" },
      members: [USER, member(groupLead)], lastMessage: null, unread: 0, readOnly: false,
      lastMessageAt: "2026-10-17T07:00:00Z",
    };
    const fake = fakeService();
    const personalThreads = fake.service.threads;
    fake.service.threads = async (signal) => {
      const r = await personalThreads(signal);
      return r.data ? { data: [...r.data, room] } : r;
    };
    const personalAgents = vi.fn(fake.service.agents);
    fake.service.agents = personalAgents;
    const groups = { agents: async () => ({ data: [groupLead, groupData] }), onChanged: () => () => undefined };
    await mount("/chat/room", { workspace: { [AGENT_CHAT_KEY]: fake.service, groups } });
    const face = () => document.querySelector('.ac-header [title^="Data nhóm"]');
    await waitFor(() => expect(face()).toBeInTheDocument());
    const reads = personalAgents.mock.calls.length;
    fake.emit({ type: "reconnect" }); // a re-read of the personal team must not drop the group's
    await waitFor(() => expect(personalAgents.mock.calls.length).toBeGreaterThan(reads));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(face()).toBeInTheDocument();
    // @ offers exactly the room's group team, never the person's own agents
    await userEvent.type(screen.getByRole("textbox", { name: "Tin nhắn" }), "@");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Điều phối nhóm@glead", "Data nhóm@gdata"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.clear(screen.getByRole("textbox", { name: "Tin nhắn" }));
    // a group room is shared: even the current user's own message offers no browser-local edit
    fake.emit({ type: "message", message: { ...ask, id: 40, threadId: "room", sender: { ...USER },
      text: "Chào Bob", choices: [], attachments: [] } });
    await waitFor(() => expect(document.querySelector('.ac-message[data-message-id="40"]')).toBeInTheDocument());
    const own = document.querySelector('.ac-message[data-message-id="40"]') as HTMLElement;
    expect(own).toHaveClass("ac-mine");
    expect(within(own).getByRole("button", { name: "Sao chép tin nhắn" })).toBeInTheDocument();
    expect(within(own).queryByRole("button", { name: "Chỉnh sửa tin nhắn" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nhóm mới" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /^Data/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /Data nhóm|Điều phối nhóm/ })).not.toBeInTheDocument();
  });

  it("opens an agent's chat from /chat?agent= and lists a newly created agent after a re-read", async () => {
    const custom = agent("demo", "Demo Analyst");
    const fake = fakeService();
    const listAgents = fake.service.agents;
    const listThreads = fake.service.threads;
    let created = false;
    fake.service.agents = async (signal) => {
      const r = await listAgents(signal);
      return r.data && created ? { data: [...r.data, custom] } : r;
    };
    fake.service.threads = async (signal) => {
      const r = await listThreads(signal);
      const direct: ChatThread = { id: "tdemo", kind: "direct", name: null, members: [USER, member(custom)],
        lastMessage: null, unread: 0, readOnly: false, lastMessageAt: "2026-10-17T08:00:00Z" };
      return r.data && created ? { data: [...r.data, direct] } : r;
    };
    await mount("/chat?agent=data", { workspace: { [AGENT_CHAT_KEY]: fake.service } });
    await waitFor(() => expect(location.pathname).toBe("/chat/td"));
    const list = screen.getByRole("navigation", { name: "Trò chuyện" });
    expect(within(list).queryByText("Demo Analyst")).not.toBeInTheDocument();
    created = true;
    fake.emit({ type: "reconnect" }); // what a finished agent_create job triggers
    expect(await within(list).findByText("Demo Analyst")).toBeInTheDocument();
  });

  it("adds a group's newly copied agent to the room's @ menu after a re-read", async () => {
    const groupLead = agent("glead", "Điều phối nhóm", true);
    const groupDemo = agent("gdemo", "Demo Analyst");
    const room: ChatThread = {
      id: "room", kind: "group", name: "Sales Team", group: { id: "g1", name: "Sales Team", status: "active" },
      members: [USER, member(groupLead)], lastMessage: null, unread: 0, readOnly: false,
      lastMessageAt: "2026-10-17T07:00:00Z",
    };
    const fake = fakeService();
    const listThreads = fake.service.threads;
    fake.service.threads = async (signal) => {
      const r = await listThreads(signal);
      return r.data ? { data: [...r.data, room] } : r;
    };
    let team = [groupLead];
    const groups = { agents: vi.fn(async () => ({ data: team })), onChanged: () => () => undefined };
    await mount("/chat/room", { workspace: { [AGENT_CHAT_KEY]: fake.service, groups } });
    await waitFor(() => expect(groups.agents).toHaveBeenCalled());
    team = [groupLead, groupDemo];
    fake.emit({ type: "reconnect" }); // groups.changed restarts the stream
    await waitFor(() => expect(groups.agents).toHaveBeenCalledTimes(2));
    await userEvent.type(screen.getByRole("textbox", { name: "Tin nhắn" }), "@");
    expect(within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Điều phối nhóm@glead", "Demo Analyst@gdemo"]);
  });
});
