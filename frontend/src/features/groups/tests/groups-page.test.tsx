import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { ServicesProvider } from "../../../app/providers/ServicesProvider";
import { createMockServices } from "../../../app/services/create-mock-services";
import GroupsPage from "../pages/GroupsPage";
import { GROUPS_KEY, type Group, type GroupsService } from "../services/groups-service";

const group: Group = { id: "g1", name: "Sales Team", status: "provisioning", statusDetail: null,
  aiAvailable: false, roomThreadId: "room", createdBy: "alice", createdAt: "2026-10-20T00:00:00Z",
  members: [{ id: "alice", username: "alice", displayName: "Alice" }] };

function mount(path: string) {
  const service: GroupsService = {
    onChanged: vi.fn(() => () => undefined),
    list: vi.fn(async () => ({ data: [group] })),
    detail: vi.fn(async () => ({ data: group })),
    create: vi.fn(async () => ({ data: group })),
    progress: vi.fn(async () => ({ data: { status: "provisioning" as const, statusDetail: null,
      jobStatus: "running", done: 2, total: 6, agents: [
        { slug: "lead", name: "Điều phối", state: "ready" as const },
        { slug: "data", name: "Data", state: "installing" as const },
      ] } })),
    retry: vi.fn(async () => ({ data: undefined })),
    agents: vi.fn(async () => ({ data: [] })),
    personalAgents: vi.fn(async () => ({ data: [] })),
    addAgent: vi.fn(async () => ({ data: undefined })),
    candidates: vi.fn(async () => ({ data: [{ id: "bob", username: "bob", displayName: "Bob" }] })),
    addMember: vi.fn(async () => ({ data: [...group.members, { id: "bob", username: "bob", displayName: "Bob" }] })),
    removeMember: vi.fn(async () => ({ data: undefined })),
  };
  const services = createMockServices();
  services.workspace[GROUPS_KEY] = service;
  render(<ServicesProvider services={services}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/groups" element={<GroupsPage />} />
    <Route path="/groups/:id" element={<GroupsPage />} />
  </Routes></MemoryRouter></ServicesProvider>);
  return service;
}

describe("groups pages", () => {
  it("creates a group and opens its provisioning detail", async () => {
    const user = userEvent.setup();
    const service = mount("/groups");
    await user.type(screen.getByLabelText("Tên nhóm"), "Sales Team");
    await user.click(screen.getByRole("button", { name: "Tạo nhóm" }));
    expect(service.create).toHaveBeenCalledWith("Sales Team");
    expect(await screen.findByText("Đang khởi tạo 2/6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở phòng chat" })).toHaveAttribute("href", "/chat/room");
  });

  it("adds a member from candidates instead of accepting an arbitrary id", async () => {
    const user = userEvent.setup();
    const service = mount("/groups/g1");
    await screen.findByText("Đang khởi tạo 2/6");
    await user.type(screen.getByLabelText("Thêm thành viên"), "bo");
    await waitFor(() => expect(service.candidates).toHaveBeenCalledWith("bo"));
    await user.click(await screen.findByRole("button", { name: "Thêm" }));
    expect(service.addMember).toHaveBeenCalledWith("g1", "bob");
  });

  it("keeps member removal available from the detail card", async () => {
    const user = userEvent.setup();
    const service = mount("/groups/g1");
    await screen.findByText("Đang khởi tạo 2/6");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xóa" })).toBeDisabled();
    // A group with one member must keep the existing safety guard.
    expect(service.removeMember).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Thêm thành viên"), "bo");
    await user.click(await screen.findByRole("button", { name: "Thêm" }));
    const bob = await screen.findByText("Bob");
    const row = bob.closest("li");
    expect(row).not.toBeNull();
    await user.click(within(row!).getByRole("button", { name: "Xóa" }));
    expect(service.removeMember).toHaveBeenCalledWith("g1", "bob");
  });
});
