// The admin users page keeps provisioning status fresh (doc 12 "User management"): the
// provisioning job's `builder.job` events go to the new user's channel, not the admin's
// stream, so the page polls while any row is still provisioning.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../../app/App";
import { createMockServices } from "../../../app/services/create-mock-services";
import { ADMIN_CONSOLE_KEY, type AdminConsoleService, type AdminUser } from "../services/admin-service";
import { USERS_POLL_MS } from "../pages/UsersPage";

const user = (status: AdminUser["status"], over: Partial<AdminUser> = {}): AdminUser => ({
  id: "u1",
  username: "alice",
  displayName: "Alice",
  domain: { id: "fabrikam", name: "Fabrikam", status: "available", statusReason: null },
  status,
  statusDetail: null,
  createdAt: "2026-10-18T05:00:00Z",
  ...over,
});

async function mount(service: Partial<AdminConsoleService>) {
  const services = createMockServices();
  await services.auth.loginAdminDemo();
  services.workspace[ADMIN_CONSOLE_KEY] = service as AdminConsoleService;
  history.replaceState({}, "", "/admin/users");
  render(<App services={services} />);
}

const row = (username: string) => screen.getByText(username).closest("tr") as HTMLElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("admin users page", () => {
  it("polls while a user is provisioning and stops once none is", { timeout: 25_000 }, async () => {
    let status: AdminUser["status"] = "provisioning";
    const users = vi.fn(async () => ({ data: [user(status)] }));
    await mount({ users });
    await screen.findByText("Đang khởi tạo");
    const before = users.mock.calls.length;
    status = "active";
    await waitFor(() => expect(screen.getByText("Sẵn sàng")).toBeInTheDocument(), { timeout: 15_000 });
    expect(users.mock.calls.length).toBeGreaterThan(before);
    const settled = users.mock.calls.length;
    await sleep(USERS_POLL_MS + 500);
    expect(users.mock.calls.length).toBe(settled);
  });

  it("labels every status and shows where provisioning is", async () => {
    const users = vi.fn(async () => ({ data: [
      user("active", { id: "a", username: "an" }),
      user("provisioning", { id: "b", username: "binh",
        provisioning: { jobStatus: "running", step: "starter chart", agent: "Chart", done: 1, total: 6 } }),
      user("provisioning", { id: "c", username: "chi",
        provisioning: { jobStatus: "queued", step: "lead", agent: "Điều phối", done: 0, total: 3 } }),
      user("failed", { id: "d", username: "dung", statusDetail: "starter chart: uv add exited 1" }),
      user("disabled", { id: "e", username: "em" }),
    ] }));
    await mount({ users });
    await screen.findByText("an");
    expect(within(row("an")).getByText("Sẵn sàng")).toBeInTheDocument();
    expect(within(row("binh")).getByText("Đang khởi tạo")).toBeInTheDocument();
    expect(within(row("binh")).getByText("Đang chuẩn bị Chart (2/6)")).toBeInTheDocument();
    expect(within(row("chi")).getByText("Đang chờ đến lượt khởi tạo")).toBeInTheDocument();
    expect(within(row("dung")).getByText("Khởi tạo lỗi")).toBeInTheDocument();
    expect(within(row("em")).getByText("Đã vô hiệu hóa")).toBeInTheDocument();
    // only the failed user gets the retry button
    expect(within(row("dung")).getByRole("button", { name: "Thử lại khởi tạo" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Thử lại khởi tạo" })).toHaveLength(1);
  });

  it("retries a failed provisioning through the existing endpoint and refreshes the row", async () => {
    let status: AdminUser["status"] = "failed";
    const users = vi.fn(async () => ({ data: [user(status)] }));
    let answer: (v: { data: string }) => void = () => undefined;
    const retryProvisioning = vi.fn(() => new Promise<{ data: string }>((r) => { answer = r; }));
    await mount({ users, retryProvisioning } as Partial<AdminConsoleService>);
    await userEvent.click(await screen.findByRole("button", { name: "Thử lại khởi tạo" }));
    expect(retryProvisioning).toHaveBeenCalledWith("u1");
    expect(screen.getByRole("button", { name: "Đang gửi yêu cầu…" })).toBeDisabled();
    status = "provisioning";
    answer({ data: "job-1" });
    expect(await screen.findByText("Đang khởi tạo")).toBeInTheDocument();
    expect(screen.getByText("Đã xếp lại việc khởi tạo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại khởi tạo" })).not.toBeInTheDocument();
  });

  it("explains a refused retry in plain words", async () => {
    const users = vi.fn(async () => ({ data: [user("failed")] }));
    const retryProvisioning = vi.fn(async () => ({ error: { code: "jobRunning", messageKey: "", retryable: false } }));
    await mount({ users, retryProvisioning } as unknown as Partial<AdminConsoleService>);
    await userEvent.click(await screen.findByRole("button", { name: "Thử lại khởi tạo" }));
    expect(await screen.findByText("Đang có việc chạy cho mục này; thử lại sau.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại khởi tạo" })).toBeEnabled();
  });

  it("sends the display name it shows, never autofills it, and refuses one equal to the password", async () => {
    const createUser = vi.fn(async () => ({ data: user("provisioning", { username: "sang", displayName: "Sang" }) }));
    const overview = vi.fn(async () => ({ data: { domains: [
      { id: "fabrikam", name: "Fabrikam", status: "available", statusReason: null }] } }));
    await mount({ users: vi.fn(async () => ({ data: [] })), overview, createUser } as unknown as Partial<AdminConsoleService>);
    await userEvent.click(await screen.findByRole("button", { name: "Tạo người dùng" }));
    const dialog = await screen.findByRole("dialog");
    const display = within(dialog).getByLabelText("Tên hiển thị");
    expect(display).toHaveAttribute("autocomplete", "off");
    expect(display).toHaveAttribute("name", "display_name");
    await userEvent.type(within(dialog).getByLabelText("Tên đăng nhập"), "sang");
    await userEvent.type(within(dialog).getByLabelText("Mật khẩu"), "123456");
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(1));
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "fabrikam");
    await userEvent.type(display, "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Tạo người dùng" }));
    expect(await within(dialog).findByText("Tên hiển thị không được trùng với mật khẩu.")).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
    await userEvent.clear(display);
    await userEvent.type(display, "Sang");
    await userEvent.click(within(dialog).getByRole("button", { name: "Tạo người dùng" }));
    await waitFor(() => expect(createUser).toHaveBeenCalledWith(
      { username: "sang", password: "123456", domainId: "fabrikam", displayName: "Sang" }));
  });
});
