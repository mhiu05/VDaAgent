import type {
  Agent,
  AgentId,
  ChatBundle,
  Conversation,
  Message,
} from "../../features/chat/model/types";
import { ids } from "../core/ids";
import { fixtureEpoch } from "../core/clock";
import type { Scenario } from "../core/scenarios";
import { withRiversideConversations } from "./riverside-scenario";
const capability = {
  group: "demo",
  mention: "demo",
  attachments: "demo",
  retry: "unsupported",
  cancel: "unsupported",
} as const;
export const agents: Agent[] = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    glyph: "◈",
    description: {
      vi: "Kết nối câu hỏi với góc nhìn phù hợp.",
      en: "Connect your question with the right perspective.",
    },
    skills: ["Research synthesis", "Evidence review"],
    tools: ["Demo catalog lookup"],
    mcp: [],
    summary: {
      vi: "Tổng hợp kết quả, phân biệt bằng chứng và giả định; nêu rõ phần chưa biết.",
      en: "Synthesize findings, separate evidence from assumptions, and state what remains unknown.",
    },
    capabilities: capability,
  },
  {
    id: "data",
    name: "Data",
    glyph: "▤",
    description: {
      vi: "Khám phá và kiểm tra chất lượng dữ liệu.",
      en: "Explore datasets and check their quality.",
    },
    skills: ["Data profiling", "Unit validation"],
    tools: ["Illustrative dataset"],
    mcp: [],
    summary: {
      vi: "Kiểm tra đơn vị, phạm vi và dữ liệu thiếu trước khi tổng hợp.",
      en: "Check units, scope and missing values before summarizing.",
    },
    capabilities: capability,
  },
  {
    id: "compare",
    name: "Compare",
    glyph: "⇄",
    description: {
      vi: "Đặt các lựa chọn vào cùng hệ quy chiếu.",
      en: "Compare alternatives on a consistent basis.",
    },
    skills: ["Baseline comparison", "Scope alignment"],
    tools: [],
    mcp: [],
    summary: {
      vi: "Chỉ so sánh khi có cùng đơn vị và mốc thời gian.",
      en: "Compare only when units and time periods align.",
    },
    capabilities: capability,
  },
  {
    id: "insight",
    name: "Insight",
    glyph: "✳",
    description: {
      vi: "Tìm ý nghĩa, giữ lại sự bất định.",
      en: "Find meaning while preserving uncertainty.",
    },
    skills: ["Pattern review", "Uncertainty assessment"],
    tools: [],
    mcp: [],
    summary: {
      vi: "Nêu giả thuyết có thể kiểm chứng, không khẳng định quan hệ nhân quả từ tương quan.",
      en: "Offer testable hypotheses; do not infer causation from correlation.",
    },
    capabilities: { ...capability, mention: "unsupported" },
  },
  {
    id: "chart",
    name: "Chart",
    glyph: "⌁",
    description: {
      vi: "Biến dữ liệu thành góc nhìn dễ đọc.",
      en: "Make data easier to understand.",
    },
    skills: ["Visual encoding", "Accessible tables"],
    tools: ["Demo table renderer"],
    mcp: [],
    summary: {
      vi: "Ưu tiên nhãn, đơn vị và bảng dữ liệu tương đương.",
      en: "Prioritize labels, units and equivalent data tables.",
    },
    capabilities: capability,
  },
  {
    id: "report",
    name: "Report",
    glyph: "▧",
    description: {
      vi: "Tổ chức kết quả thành báo cáo có nguồn.",
      en: "Turn findings into sourced reports.",
    },
    skills: ["Research outline", "Source organization"],
    tools: [],
    mcp: [],
    summary: {
      vi: "Giữ nguồn dẫn và phạm vi; liên kết báo cáo chỉ khi đã tích hợp.",
      en: "Preserve sources and scope; link reports only when integrated.",
    },
    capabilities: capability,
  },
];
export const researchAnswer = `## Ba thị trường, ba bối cảnh\n\nDữ liệu minh họa cho thấy **Hà Nội có mức giá cao hơn** trong mẫu này. Tuy nhiên, chưa thể kết luận về toàn thị trường khi chưa chuẩn hóa loại hình, diện tích và thời điểm ghi nhận.\n\n| Thị trường | Giá minh họa (triệu VND/m²) | Số mẫu |\n| :--- | ---: | ---: |\n| Hà Nội | 68 | 120 |\n| Đà Nẵng | 42 | 84 |\n| TP. Hồ Chí Minh | 73 | 150 |\n\n### Điều cần kiểm tra tiếp\n\n1. **Phạm vi:** đây là giá chào bán hay giao dịch thực tế?\n2. **Chất lượng:** loại bỏ bản ghi trùng và kiểm tra đơn vị.\n3. **Bất định:** thiếu baseline cùng kỳ, vì vậy chưa tính phần trăm tăng trưởng.\n\n> Các con số chỉ phục vụ trải nghiệm giao diện. Không dùng cho quyết định đầu tư.\n\nTôi đề xuất bắt đầu từ kiểm tra độ phủ dữ liệu, sau đó so sánh các nhóm cùng loại hình.`;
export const codeAnswer =
  "## Check the data before comparing\n\nUse a consistent unit and keep missing baselines explicit.\n\n```python\ndef absolute_delta(current, baseline):\n    if baseline is None:\n        return None\n    return current - baseline\n\n# A zero baseline still has a valid absolute delta.\nprint(absolute_delta(42, 0))  # 42\n```\n\n- Never divide by a zero baseline.\n- Keep the original source and observation date.\n- This is a **mock example**, not an executed analysis.";
export function answerFor(agent: AgentId) {
  return agent === "data" || agent === "chart" ? codeAnswer : researchAnswer;
}
const message = (
  id: string,
  author: Message["author"],
  body: string,
): Message => ({
  id,
  author,
  body,
  createdAt: fixtureEpoch,
  state: "complete",
  sequence: 1,
});
export function makeBundle(scenario: Scenario): ChatBundle {
  const conversations: Conversation[] = agents.map((a) => ({
    id: ids.conversations[a.id],
    title:
      a.name === "Orchestrator"
        ? "Góc nhìn thị trường nhà ở"
        : `${a.name} · Research notebook`,
    kind: "direct",
    participants: [a.id],
    updatedAt: fixtureEpoch,
    draft: "",
    attachments: [],
    messages:
      scenario === "empty"
        ? []
        : [
            message(
              `${a.id}-q`,
              "user",
              a.id === "data"
                ? "How should we handle missing and zero baselines?"
                : "So sánh thị trường nhà ở Hà Nội, Đà Nẵng và TP. Hồ Chí Minh. Tôi nên bắt đầu từ đâu?",
            ),
            {
              ...message(`${a.id}-a`, a.id, answerFor(a.id)),
              evidence: [
                {
                  id: "source-1",
                  title: "Bảng dữ liệu thị trường · Mẫu minh họa",
                  excerpt:
                    "Mẫu cố định để kiểm tra giao diện, không đại diện thị trường thực tế.",
                  access: "available",
                },
                {
                  id: "source-2",
                  title: "Baseline cùng kỳ",
                  excerpt: "Nguồn chưa được cung cấp.",
                  access: "missing",
                },
                {
                  id: "source-3",
                  title: "Ghi chú nội bộ",
                  excerpt: "Không có quyền truy cập nguồn này.",
                  access: "restricted",
                },
              ],
              ...(a.id === "chart"
                ? {
                    artifact: {
                      kind: "table" as const,
                      caption: "Illustrative data · triệu VND/m²",
                      columns: ["City", "Value"],
                      rows: [
                        ["Hà Nội", "68"],
                        ["Đà Nẵng", "42"],
                        ["TP.HCM", "73"],
                      ],
                    },
                  }
                : a.id === "report" && scenario === "report-showcase"
                  ? {
                      artifact: {
                        kind: "report" as const,
                        caption: "Saved custom report · DEMO",
                        reportId: "R019",
                        versionId: "R019-v2",
                        access: "available" as const,
                        sourceMode: "mock" as const,
                      },
                    }
                  : {}),
            },
          ],
  }));
  for (const [i, id] of ids.groups.entries())
    conversations.push({
      id,
      title: i ? "Kiểm tra bằng chứng" : "Góc nhìn đa chiều",
      kind: "group",
      participants: i
        ? ["orchestrator", "insight"]
        : ["orchestrator", "data", "compare"],
      updatedAt: fixtureEpoch,
      draft: "",
      attachments: [],
      messages:
        scenario === "empty"
          ? []
          : [
              message(
                `${id}-q`,
                "user",
                "Hãy cùng xem xét chất lượng mẫu và các điểm cần xác minh.",
              ),
              {
                ...message(`${id}-a`, "orchestrator", researchAnswer),
                contributions: [
                  {
                    agentId: "data",
                    body: "Mẫu minh họa chưa có thông tin về giao dịch thực.",
                  },
                  {
                    agentId: "compare",
                    body: "Cần chuẩn hóa cùng đơn vị trước khi so sánh.",
                  },
                ],
              },
            ],
    });
  if (scenario === "long-conversation" || scenario === "performance") {
    const c = conversations[0];
    c.messages = Array.from(
      { length: scenario === "performance" ? 2000 : 80 },
      (_, i) =>
        message(
          `long-${i}`,
          i % 2 ? "orchestrator" : "user",
          i % 2
            ? i % 5 === 0
              ? codeAnswer
              : researchAnswer
            : `Research note ${i + 1}: kiểm tra dữ liệu và phạm vi.`,
        ),
    );
  }
  const bundle: ChatBundle = { version: 2, conversations };
  return scenario === "success" ? withRiversideConversations(bundle) : bundle;
}
