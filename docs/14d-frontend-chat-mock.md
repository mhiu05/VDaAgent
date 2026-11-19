# 14d · Chat mock and the Riverside scenario

**Depends on:** [14](14-frontend.md), [14c](14c-frontend-adapters.md), [14e](14e-report-viewer.md)

**Status:** Implemented (mock)

> This page describes the current mock chat screen ("Agent Fleet") at `/chat`. The target chat UX is defined in [14](14-frontend.md) and diverges from it: 6 fixed agents including `orchestrator` vs lead + starters + user-created agents; an inspector vs the info pane; content blocks vs Markdown, attachments, choice chips and `report_refs`; the `/report` command and @mention are dropped; `?conversation=` vs `/chat/:threadId`. See [current implementation vs target](14-frontend.md#current-implementation-vs-target).

The default runtime uses mocks: the capability catalog, answers and Riverside results are simulated data. The `tools`/`mcp` fields in the inspector describe public configuration; they do not confirm a real connection or tool execution.

## Six agents

| ID | Presentation role |
| --- | --- |
| `orchestrator` | Coordinates and synthesises. |
| `data` | Checks data and data quality. |
| `compare` | Compares snapshots. |
| `chart` | Visualisation. |
| `insight` | Insights and prioritisation. |
| `report` | Executive report. |

The model is in [`chat/model/types.ts`](../frontend/src/features/chat/model/types.ts); the mock catalog is in [`mocks/chat/fixtures.ts`](../frontend/src/mocks/chat/fixtures.ts). Capability has four values: `available`, `demo`, `unsupported`, `unknown`. `canUse` enables behaviour only for the first two.

## Layout and navigation

The sidebar searches agents/conversations and selects direct threads, the demo group and history. The timeline is the central content area. The inspector shows overview, skills, tools, MCP, public principles and capability; secondary panes become drawers on narrow screens via the chat CSS.

The `conversation` query keeps the selected thread, for example:

```text
/chat?conversation=riverside-r010-group
```

Selecting a member in the Riverside group opens that member's direct thread in the same scenario. The back-to-group action opens the matching group conversation. Selecting an agent does not start a backend worker.

## Riverside data sources

| Source | Role |
| --- | --- |
| [`report.json`](../frontend/src/mocks/reports/data/riverside-r010-v2/report.json) | Canonical snapshot, KPIs, charts, findings, actions and report metadata. |
| [`riverside-adapter.ts`](../frontend/src/mocks/reports/riverside-adapter.ts) | Maps the fixture to the schema used by the reports library. |
| [`riverside-scenario.json`](../frontend/src/mocks/chat/data/riverside-scenario.json) | Declarative conversation script: the group and six direct threads. |
| [`riverside-selectors.ts`](../frontend/src/mocks/chat/riverside-selectors.ts) | Read-only projection of the report fixture/schema; supplies numbers and text bindings to chat. |
| [`riverside-scenario.ts`](../frontend/src/mocks/chat/riverside-scenario.ts) | Turns the narrative into app conversations/messages/blocks. |

The internal scenario ID is `riverside-inventory-r010-agent-demo-v2`, the group is `riverside-r010-group`, and the app report reference is `{ reportId: 'R010', versionId: 'R010-v2' }`. The original ID in the report JSON is `riverside-inventory-r010`; the mock adapter maps it to the existing `R010` registry entry.

In the default `success` mock scenario, `withRiversideConversations` adds missing Riverside threads to the stored bundle. It keeps existing threads with the same ID unchanged. Data edited/stored in an earlier session can therefore differ from a fresh start; reset the demo to return to the fixture.

A conversation's `scenarioId` is not the `scenario` query value accepted by bootstrap. Do not use `?scenario=riverside` to select this script; use the `conversation` URL above in the default runtime.

## Number invariants

The Riverside snapshot is cut at `2026-10-15T23:59:00+07:00`. This is the sample data time, not the time a task just ran.

| Metric | Previous point | Current point |
| --- | --- | --- |
| Available units | 66 | 60 |
| Units with known stock age | 64 | 56 |
| Units with unknown age | 2 | 4 |
| Units in stock ≥ 180 days | 18 | 20 |
| Long-stock share of units with known age | 28.1% | 35.7% |

The current long-stock share is `20/56`, up about 7.6 percentage points from `18/64`. Stock-age completeness is `56/60 = 93.3%`. The four units with unknown age stay in total stock; never assign them age 0. The share `20/60` over all stock is a different metric.

The previous point has no cut-off date; the two snapshots must not be treated as the same fixed set of units. The fixture lacks price, CRM and transaction data needed to conclude causes. Actions P0–P2 are proposals, not approved or assigned.

## Message content

A `Message` holds ID, author, timestamp, state, sequence and may have `blocks`, `surface`, `source`, `dataThrough`, evidence, artifacts or contributions. For Riverside, messages are projected as public results with `source: 'mock_fixture'` and a completed state.

`AgentContentBlock` reuses the reports `SchemaBlock` and adds:

| Kind | Behaviour |
| --- | --- |
| `details` | Disclosure containing child blocks. |
| `report-ref` | Reference card for an exact report/version. |
| `action` | Navigates to a report or the group. |

KPIs and charts use components shared with reports; the same data source serves chat and the viewer. `ReportReferenceCard` still reads `ReportsService.detail` for status, metadata and card content; it never infers report status from narrative wording.

Markdown and links go through the app renderer/policy. The decoder/validator accepts public presentation content only; private traces or raw agent-to-agent payloads never enter the timeline.

## Sending and `/report`

In the Riverside conversation, sending a new question shows a notice that no model answers, keeps the draft and does not take the fixed-reply path of normal conversations.

[`resolveMockCommand`](../frontend/src/features/chat/model/commands.ts) accepts `/report` only when the conversation has the exact Riverside scenario/reference. `/report` with no content, or with a request matching Riverside/R010, is handled as follows:

1. Clear the processed command draft.
2. If the thread has a message containing `report-ref`, scroll to and focus it.
3. If there is no reference message but there is a `reportRef`, open the viewer on the stored version.

The command does not create a new report, emit a generation event or rerun analysis. Requests that do not match a supported report, or the command used in another thread, show a not-supported notice.

Report cards and buttons point to `/reports?report=R010&version=R010-v2&view=dashboard` (the report overview), keeping the `scenario` query if present. Navigation state stores the chat origin and message focus so closing the viewer returns to the right context. When the URL opens in a new tab or a reload loses navigation state, report/version still come from the URL; closing falls back to the reports library.

## Ordinary demo conversations

New threads without a `scenarioId` use `ChatService.send` and a fixed reply. The mock has replay, duplicate, out-of-order, interrupted, unknown-acknowledgement and offline scenarios to exercise the lifecycle. They are not evidence of an integrated real stream/backend.

Attachments keep only metadata and in-memory files for the session; after a draft is restored from storage, files must be re-attached. Files are not uploaded or analysed. Retry/cancel depend on capability; aborting a subscription and requesting cancel are two different actions. The transport contract is in [14c](14c-frontend-adapters.md).

## Related tests

[`riverside-fleet.test.ts`](../frontend/src/features/chat/tests/riverside-fleet.test.ts) and [`riverside-ui.test.tsx`](../frontend/src/features/chat/tests/riverside-ui.test.tsx) cover projection and UI. [`agent-fleet.spec.ts`](../frontend/tests/agent-fleet.spec.ts) and [`riverside.spec.ts`](../frontend/tests/riverside.spec.ts) cover browser journeys, including links to the report viewer. See [14g](14g-frontend-development.md) for how to run them.
