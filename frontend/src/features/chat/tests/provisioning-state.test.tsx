// A provisioning or failed account sees a status screen instead of the empty chat, and the chat
// appears on its own once provisioning finishes (doc 12 "Provisioning a user").
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../../../app/App";
import type { AccountStatus, Session } from "../../../shared/contracts/auth";
import { createMockServices } from "../../../app/services/create-mock-services";
import { AGENT_CHAT_KEY, type AgentChatService } from "../services/agent-chat-service";

beforeAll(async () => {
  await Promise.all([import("../pages/ChatRoute"), import("../pages/AgentChatPage")]);
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const EMPTY_CHAT = "Chưa có cuộc trò chuyện.";
const PROVISIONING = "Đang khởi tạo không gian AI của bạn";
const FAILED = "Khởi tạo không thành công.";

function emptyChat(): AgentChatService {
  return {
    agents: async () => ({ data: [] }),
    threads: async () => ({ data: [] }),
    messages: async () => ({ data: [] }),
    tasks: async () => ({ data: [] }),
    presence: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    subscribe: () => () => undefined,
  } as unknown as AgentChatService;
}

async function mount(initial: AccountStatus, next: () => AccountStatus = () => initial) {
  const services = createMockServices();
  const login = services.auth.login.bind(services.auth);
  const restore = services.auth.restore.bind(services.auth);
  const patch = (session: Session): Session => ({ ...session, accountStatus: initial });
  services.auth.login = async (email, password) => {
    const r = await login(email, password);
    return r.data ? { data: patch(r.data) } : r;
  };
  services.auth.restore = async () => {
    const r = await restore();
    return r.data ? { data: patch(r.data) } : r;
  };
  const accountStatus = vi.fn(async () => ({ data: next() }));
  services.auth.accountStatus = accountStatus;
  await services.auth.login("user@vdaagent.test", "DemoUser!2026");
  services.workspace[AGENT_CHAT_KEY] = emptyChat();
  history.replaceState({}, "", "/chat");
  render(<App services={services} />);
  return { accountStatus };
}

describe("account provisioning state", () => {
  it("shows the provisioning screen, not the empty chat, then the chat once active", { timeout: 20_000 }, async () => {
    let status: AccountStatus = "provisioning";
    const { accountStatus } = await mount("provisioning", () => status);
    expect(await screen.findByText(PROVISIONING, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/có thể mất vài phút ở lần đầu tiên/)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_CHAT)).not.toBeInTheDocument();
    status = "active";
    // the next status poll flips the route to the chat without a reload or logout
    expect(await screen.findByRole("navigation", { name: "Trò chuyện" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText(PROVISIONING)).not.toBeInTheDocument();
    expect(accountStatus).toHaveBeenCalled();
  });

  it("shows the normal chat to an active user", async () => {
    await mount("active");
    expect(await screen.findByRole("navigation", { name: "Trò chuyện" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText(EMPTY_CHAT)).toBeInTheDocument();
    expect(screen.queryByText(PROVISIONING)).not.toBeInTheDocument();
  });

  it("shows a friendly failure without backend detail", async () => {
    await mount("failed");
    expect(await screen.findByText(FAILED, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Vui lòng liên hệ quản trị viên để thử lại.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_CHAT)).not.toBeInTheDocument();
    expect(screen.queryByText(/uv add|exited/)).not.toBeInTheDocument();
  });
});
