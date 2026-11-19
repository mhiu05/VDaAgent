import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../../app/App";
import { createMockServices } from "../../../app/services/create-mock-services";
import { ids } from "../../../mocks/core/ids";

beforeAll(async () => {
  await Promise.all([
    import("../pages/ChatPage"),
    import("../../reports/pages/ReportDetailPage"),
  ]);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
async function mount(
  configure?: (services: ReturnType<typeof createMockServices>) => void,
) {
  history.replaceState({}, "", "/login");
  const services = createMockServices();
  vi.spyOn(services.context.clock, "sleep").mockResolvedValue(undefined);
  await services.auth.login("user@vdaagent.test", "DemoUser!2026");
  await services.chat.reset(ids.user);
  configure?.(services);
  history.replaceState({}, "", "/chat?conversation=riverside-r010-group");
  const view = render(<App services={services} />);
  await screen.findByRole(
    "heading",
    { name: "Phân tích tồn kho Riverside · Đợt 10" },
    { timeout: 5000 },
  );
  return { ...view, services };
}

describe("Riverside in the existing application", () => {
  it("leaves command handling to a configured real conversation adapter", async () => {
    const send = vi.fn();
    await mount((services) => {
      send.mockImplementation(async (principal: string) =>
        services.chat.load(principal),
      );
      Object.assign(services.chat, { sourceMode: "api", send });
    });
    const input = screen.getByRole("textbox", { name: "Tin nhắn" });
    fireEvent.change(input, {
      target: { value: "/report custom production request" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][2]).toBe("/report custom production request");
    expect(screen.queryByText(/Yêu cầu này chưa có báo cáo/)).toBeNull();
  });
  it("renders outcome first, specialist blocks, source details and six isolated DM histories", async () => {
    const { container } = await mount();
    const group = container.querySelectorAll(".timeline .message");
    expect(group).toHaveLength(10);
    const data = group[2];
    expect(
      data.querySelector(".message-content > .message-body")
        ?.nextElementSibling,
    ).toHaveClass("chart-workspace");
    expect(
      [...data.querySelectorAll(".report-kpis strong")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["60", "20", "35,7", "93,3"]);
    const sidebar = within(
      container.querySelector(".docked-agent-list") as HTMLElement,
    );
    await userEvent.click(
      sidebar.getByRole("button", { name: /Data Khám phá/ }),
    );
    expect(container.querySelectorAll(".timeline .message")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Data · Riverside" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByText("Xem 5 nhóm tuổi tồn", { exact: true }),
    );
    expect(
      screen
        .getByRole("table", { name: "Phân bố tuổi tồn" })
        .querySelectorAll("tbody tr"),
    ).toHaveLength(5);
    expect(container.querySelector(".timeline")).toHaveTextContent(
      "20/56 = 35,7%",
    );
    await userEvent.click(sidebar.getByRole("button", { name: /Compare Đặt/ }));
    expect(container.querySelector(".timeline")).toHaveTextContent(
      "+7,6 điểm phần trăm",
    );
    expect(
      screen.getByRole("table", { name: "So sánh với mốc trước" }),
    ).toBeInTheDocument();
    await userEvent.click(
      sidebar.getByRole("button", { name: /Riverside · Đợt 10/ }),
    );
    expect(container.querySelectorAll(".timeline .message")).toHaveLength(10);
    await userEvent.click(
      within(
        container.querySelector(
          '[data-message-id="r010-g-003"]',
        ) as HTMLElement,
      ).getByRole("button", { name: /Riverside · R010-v2/ }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Mốc trước không rõ ngày",
    );
  });

  it("keeps unsupported questions as drafts and reuses the seeded card for repeated commands", async () => {
    const { container } = await mount();
    const textbox = screen.getByRole("textbox", { name: "Tin nhắn" });
    fireEvent.change(textbox, { target: { value: "Câu hỏi ngoài kịch bản" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(
      await screen.findByText(/Đây là kịch bản đã ghi sẵn/),
    ).toBeInTheDocument();
    expect(textbox).toHaveValue("Câu hỏi ngoài kịch bản");
    for (let i = 0; i < 2; i++) {
      const input = screen.getByRole("textbox", { name: "Tin nhắn" });
      fireEvent.change(input, { target: { value: "/report" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "Tin nhắn" })).toHaveValue(
          "",
        ),
      );
      await screen.findByRole("heading", {
        name: "Báo cáo phân tích tồn kho — Riverside, đợt 10",
      });
      expect(container.querySelectorAll(".timeline .message")).toHaveLength(10);
      expect(container.querySelectorAll(".fleet-report-card")).toHaveLength(1);
    }
  });
});
