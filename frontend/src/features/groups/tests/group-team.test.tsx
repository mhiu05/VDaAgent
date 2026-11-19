import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupTeam } from "../components/GroupTeam";
import type { GroupsService } from "../services/groups-service";
import type { TeamAgent } from "../../chat/services/agent-chat-service";

const agent = (id: string, slug: string, name: string, isLead = false): TeamAgent => ({
  id, slug, name, avatar: { emoji: name[0], color: "#0F766E" }, description: "", isLead,
  status: "idle", statusDetail: null,
});

function service(team: TeamAgent[], mine: TeamAgent[]) {
  return {
    onChanged: vi.fn(() => () => undefined),
    agents: vi.fn(async () => ({ data: team })),
    personalAgents: vi.fn(async () => ({ data: mine })),
    addAgent: vi.fn(async () => ({ data: undefined })),
  } as unknown as GroupsService & { addAgent: ReturnType<typeof vi.fn> };
}

describe("group team", () => {
  it("lists the group's own team and offers only my own agents it does not have yet", async () => {
    const svc = service(
      [agent("g-lead", "lead", "Điều phối", true), agent("g-data", "data", "Data")],
      [agent("p-lead", "lead", "Điều phối", true), agent("p-data", "data", "Data"),
        agent("p-demo", "demo-analyst", "Demo Analyst")],
    );
    render(<GroupTeam id="g1" service={svc} ready />);
    const team = screen.getByRole("region", { name: "Đội AI của nhóm" });
    expect(await within(team).findByText("Data")).toBeInTheDocument();
    const picker = screen.getByLabelText("Thêm agent của bạn vào nhóm");
    // my lead and my Data (the group already has a `data`) are not offered
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Chọn agent cá nhân...", "Demo Analyst (@demo-analyst)"]);
    expect(screen.getByRole("button", { name: "Thêm vào nhóm" })).toBeDisabled();
    await userEvent.selectOptions(picker, "p-demo");
    await userEvent.click(screen.getByRole("button", { name: "Thêm vào nhóm" }));
    expect(svc.addAgent).toHaveBeenCalledWith("g1", "p-demo");
    expect(await screen.findByRole("status")).toHaveTextContent("Đang tạo bản sao cho nhóm");
  });

  it("renders six built-in agents and a custom agent in matching rows", async () => {
    const names = ["Điều phối", "Chart", "Compare", "Data", "Insight", "Report", "Demo Analyst"];
    const svc = service(names.map((name, index) => agent(`g-${index}`, name.toLowerCase(), name)), []);
    render(<GroupTeam id="g1" service={svc} ready />);
    const team = screen.getByRole("region", { name: "Đội AI của nhóm" });
    await waitFor(() => expect(within(team).getAllByRole("listitem")).toHaveLength(7));
    for (const name of names) expect(within(team).getByText(name)).toBeInTheDocument();
    expect(within(team).getAllByText("Sẵn sàng")).toHaveLength(7);
    expect(screen.getByText("Không có Agent cá nhân khả dụng để thêm.")).toBeInTheDocument();
  });

  it("offers no copy while the group's team is still provisioning", async () => {
    const svc = service([], [agent("p-demo", "demo-analyst", "Demo Analyst")]);
    render(<GroupTeam id="g1" service={svc} ready={false} />);
    await waitFor(() => expect(svc.personalAgents).toHaveBeenCalled());
    expect(screen.queryByLabelText("Thêm agent của bạn vào nhóm")).not.toBeInTheDocument();
  });
});
