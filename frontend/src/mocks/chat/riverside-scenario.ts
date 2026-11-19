import narrative from "./data/riverside-scenario.json";
import { bindRiversideText, selectRiverside } from "./riverside-selectors";
import type {
  AgentContentBlock,
  AgentId,
  ChatBundle,
  Conversation,
  Message,
} from "../../features/chat/model/types";

export const riversideScenarioId = narrative.id;
export const riversideGroupId = narrative.group_thread.id;
type NarrativeBlock = {
  type: string;
  body?: string;
  bindings?: Record<string, string>;
  title?: string;
  children?: NarrativeBlock[];
  chart_id?: string;
  label?: string;
  action?: string;
};
type NarrativeEvent = {
  id: string;
  sender_id: string;
  surface: string;
  text?: string;
  headline?: string;
  blocks?: NarrativeBlock[];
};

function projectBlocks(
  input: NarrativeBlock[],
  prefix: string,
): AgentContentBlock[] {
  const data = selectRiverside();
  return input.flatMap((b, i): AgentContentBlock[] => {
    const id = `${prefix}-${i}`;
    const text = (markdown: string): AgentContentBlock => ({
      id,
      kind: "text",
      title: "",
      evidenceIds: [],
      markdown,
    });
    switch (b.type) {
      case "markdown":
        return [text(bindRiversideText(b.body ?? "", b.bindings))];
      case "metric_group":
        return [data.metrics];
      case "data_table":
        return [data.age, text(data.methodology)];
      case "comparison":
        return [text(data.changes), data.comparison];
      case "findings":
        return data.findings;
      case "action_proposals":
        return [
          {
            id,
            kind: "details",
            title: "Kế hoạch hành động · 4 đề xuất P0–P2",
            blocks: data.actions,
          },
        ];
      case "details":
        return [
          {
            id,
            kind: "details",
            title: b.title ?? "Chi tiết",
            blocks: projectBlocks(b.children ?? [], id),
          },
        ];
      case "chart_ref": {
        const chart = data.charts.find(
          (c) => c.block.kind === "chart" && c.block.chart.id === b.chart_id,
        );
        if (!chart) throw new Error(`Unknown canonical chart: ${b.chart_id}`);
        return [
          chart.block,
          text(`**Đọc nhanh:** ${chart.quickRead}`),
          {
            id: `${id}-detail`,
            kind: "details",
            title: "Phạm vi và cách đọc biểu đồ",
            blocks: [text(`${chart.subtitle}. ${data.methodology}`)],
          },
        ];
      }
      case "report_ref":
        return [{ id, kind: "report-ref", reference: data.reference }];
      case "action":
        return [
          {
            id,
            kind: "action",
            label: b.label ?? "Xem thêm",
            action: b.action === "navigate_to_group" ? "group" : "report",
          },
        ];
      default:
        throw new Error(`Unsupported Riverside narrative block: ${b.type}`);
    }
  });
}

function projectMessage(event: NarrativeEvent): Message {
  const blocks = event.blocks
    ? projectBlocks(event.blocks, event.id)
    : undefined;
  if (event.id === "riverside-dm-chart-002" && blocks?.[0]?.kind === "text")
    blocks[0].markdown =
      "Xem **cơ cấu tuổi tồn** và **biến động giữa hai mốc** để nhận diện nhóm cần rà soát. Mỗi biểu đồ có bảng dữ liệu tương đương để kiểm tra từng giá trị.";
  if (event.id === "riverside-dm-data-002" && blocks?.[0]?.kind === "text")
    blocks[0].markdown = `${selectRiverside().qualitySummary}\n\n${blocks[0].markdown}`;
  if (
    ["riverside-dm-report-002", "r010-g-009"].includes(event.id) &&
    blocks?.[0]?.kind === "text"
  )
    blocks[0].markdown = `Báo cáo **${selectRiverside().reference.versionId}** đã được lưu từ các kết quả phân tích trên cùng nguồn. Bạn có thể mở bản đầy đủ để xem bằng chứng, các đề xuất và giới hạn dữ liệu.`;
  return {
    id: event.id,
    author: event.sender_id as Message["author"],
    body: event.text ?? (event.headline ? `## ${event.headline}` : ""),
    // This is the fixture snapshot timestamp, not a claimed execution timestamp.
    createdAt: selectRiverside().asOf,
    sequence: 1,
    state: "complete",
    surface: event.surface as Message["surface"],
    source: "mock_fixture",
    dataThrough: selectRiverside().asOf,
    ...(event.sender_id !== "user"
      ? {
          evidence: [
            {
              id: "riverside-r010-v2-source",
              title: "Riverside · R010-v2",
              excerpt: `Nguồn: bộ dữ liệu báo cáo đã lưu R010-v2. Snapshot ${selectRiverside().asOf}. Mốc trước không rõ ngày. Các hành động còn ở trạng thái đề xuất.`,
              access: "available" as const,
            },
          ],
        }
      : {}),
    ...(blocks ? { blocks } : {}),
  };
}

export function riversideConversations(): Conversation[] {
  const shared = {
    scenarioId: riversideScenarioId,
    reportRef: selectRiverside().reference,
    context: {
      project: selectRiverside().project,
      dataThrough: selectRiverside().asOf,
    },
    updatedAt: selectRiverside().asOf,
    draft: "",
    attachments: [],
  };
  const group = narrative.group_thread;
  return [
    {
      ...shared,
      id: group.id,
      title: group.title,
      kind: "group",
      participants: group.participants as AgentId[],
      messages: group.events.map((e) => projectMessage(e as NarrativeEvent)),
    },
    ...narrative.direct_threads.map((thread) => ({
      ...shared,
      id: thread.id,
      title: `${thread.agent_id[0].toUpperCase()}${thread.agent_id.slice(1)} · Riverside`,
      kind: "direct" as const,
      participants: [thread.agent_id as AgentId],
      messages: thread.messages.map((e) => projectMessage(e as NarrativeEvent)),
    })),
  ];
}

/** Additive hydration, including old persisted bundles. Never modify an existing thread. */
export function withRiversideConversations(bundle: ChatBundle): ChatBundle {
  const ids = new Set(bundle.conversations.map((c) => c.id));
  const missing = riversideConversations().filter((c) => !ids.has(c.id));
  return missing.length
    ? { ...bundle, conversations: [...bundle.conversations, ...missing] }
    : bundle;
}
