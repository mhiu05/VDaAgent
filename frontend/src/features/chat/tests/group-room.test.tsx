import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChatComposer, MessageItem } from "../components/AgentChatMessages";
import type { ChatMessage } from "../services/agent-chat-service";

vi.mock("../../../app/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ preferences: { locale: "vi", timezone: "Asia/Ho_Chi_Minh" } }),
}));

const message = (id: string, target: "lead" | null = null): ChatMessage => ({
  id: 1, threadId: "room", sender: { type: "user", id, name: id, avatar: null },
  text: "Hello", target, choices: [], replyTo: null, choiceId: null, attachments: [],
  reportRefs: [], createdAt: "2026-10-20T03:00:00Z",
});

describe("group room controls", () => {
  it("places another human's message on the receiving side and marks AI requests", () => {
    const { container } = render(<MessageItem message={message("bob", "lead")} messages={[]}
      group currentUserId="alice" onChoose={() => undefined} onOpenAttachment={() => undefined} disabled={false} />);
    expect(container.querySelector(".ac-message")?.classList.contains("ac-mine")).toBe(false);
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("Hỏi AI")).toBeInTheDocument();
  });

  it("offers the browser-local edit only on the current user's own message, never in a room", () => {
    const edit = /acEditMessage|Chỉnh sửa tin nhắn|Edit message/; // raw key when the chat namespace is not loaded
    const item = (sender: string, onEdit?: () => void) => <MessageItem message={message(sender)} messages={[]}
      group currentUserId="alice" onChoose={() => undefined} onOpenAttachment={() => undefined}
      onEdit={onEdit} disabled={false} />;
    const { rerender } = render(item("alice", () => undefined));
    expect(screen.getByRole("button", { name: edit })).toBeInTheDocument(); // personal: own message
    rerender(item("bob", () => undefined));
    expect(screen.queryByRole("button", { name: edit })).not.toBeInTheDocument(); // someone else's
    rerender(item("alice"));
    expect(screen.queryByRole("button", { name: edit })).not.toBeInTheDocument(); // room: no onEdit
  });

  it("sends a normal room message without waking AI and gates AI while provisioning", async () => {
    const send = vi.fn(async () => null);
    const { rerender } = render(<ChatComposer disabled={false} groupStatus="provisioning" onSend={send} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    expect(screen.getByRole("button", { name: "Hỏi AI" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Gửi|Send/i }));
    expect(send).toHaveBeenCalledWith("Hello", [], "group");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    rerender(<ChatComposer disabled={false} groupStatus="active" onSend={send} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Analyze" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi AI" }));
    expect(send).toHaveBeenCalledWith("Analyze", [], "lead");
  });

  const TEAM = ["lead", "data", "insight", "compare", "chart", "report"].map((slug) => ({
    slug, name: slug === "lead" ? "Điều phối" : slug[0].toUpperCase() + slug.slice(1), avatar: null,
  }));
  const typeText = (value: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value } });

  it("offers the group's own team after @ and routes a picked agent through the lead", async () => {
    const send = vi.fn(async () => null);
    render(<ChatComposer disabled={false} groupStatus="active" mentionAgents={TEAM} onSend={send} />);
    typeText("@");
    const menu = screen.getByRole("listbox");
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(
      ["Điều phối@lead", "Data@data", "Insight@insight", "Compare@compare", "Chart@chart", "Report@report"]);
    typeText("@da");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" }); // picks, does not send
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("@Data ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    typeText("@Data lấy số liệu");
    fireEvent.click(screen.getByRole("button", { name: /Gửi|Send/i })); // a mention is an AI request
    expect(send).toHaveBeenCalledWith("@Data lấy số liệu", [], "lead", "data");
  });

  it("keeps plain room messages and Hỏi AI unchanged, and drops a mention whose tag was erased", async () => {
    const send = vi.fn(async () => null);
    render(<ChatComposer disabled={false} groupStatus="active" mentionAgents={TEAM} onSend={send} />);
    typeText("@ch");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    typeText("Chào Bob");
    fireEvent.click(screen.getByRole("button", { name: /Gửi|Send/i }));
    expect(send).toHaveBeenLastCalledWith("Chào Bob", [], "group");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    typeText("@ch");
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("button", { name: /Chart/ }));
    typeText("vẽ biểu đồ"); // the @Chart tag is gone: no routing intent left
    fireEvent.click(screen.getByRole("button", { name: "Hỏi AI" }));
    expect(send).toHaveBeenLastCalledWith("vẽ biểu đồ", [], "lead");
  });

  it("offers no mentions while the team provisions or in a personal chat", () => {
    const send = vi.fn(async () => null);
    const { rerender } = render(<ChatComposer disabled={false} groupStatus="provisioning" mentionAgents={TEAM} onSend={send} />);
    typeText("@");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<ChatComposer disabled={false} onSend={send} />);
    typeText("@d");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gửi|Send/i }));
    expect(send).toHaveBeenCalledWith("@d", [], undefined);
  });

  it("labels an @mentioned AI request with the agent's name", () => {
    render(<MessageItem message={{ ...message("bob", "lead"), mention: { slug: "data", name: "Data" } }} messages={[]}
      group currentUserId="alice" onChoose={() => undefined} onOpenAttachment={() => undefined} disabled={false} />);
    expect(screen.getByText("Hỏi AI · Data")).toBeInTheDocument();
  });
});
