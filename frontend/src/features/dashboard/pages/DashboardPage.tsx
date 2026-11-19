import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Layers3,
  ScanLine,
} from "lucide-react";
import { useAuth } from "../../auth/providers/AuthProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate, formatNumber } from "../../../shared/lib/format";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { PageFrame, PageState, SectionHeading } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { FormField, Input, Select } from "../../../shared/ui/form";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { StatusBadge, TableSurface } from "../../../shared/ui/data";
import { useServiceRead } from "../../reports/hooks/useServiceRead";
import type { Principal } from "../../../shared/contracts/auth";
import type { WorkspaceCatalog } from "../../reports/services/reports-service";
import type { DashboardService } from "../services/dashboard-service";
import type { BreakdownKind, BreakdownQuery, Metric } from "../model/types";
import { parseDashboardQuery, serializeDashboardQuery } from "../model/query";
import { formatMetric } from "../model/format";
import { daysBetween } from "../model/metrics";
import {
  InventoryAgeChart,
  TransactionTrendChart,
} from "../components/AnalyticsCharts";
import { DashboardInspect } from "../components/DashboardInspect";
import "./dashboard.css";
import { useAnalyticalMotion } from "../../../shared/motion/useAnalyticalMotion";

export default function DashboardPage() {
  const { snapshot } = useAuth();
  const { t } = useTranslation("dashboard");
  return snapshot.status === "authenticated" &&
    snapshot.principal.role === "USER" ? (
    <DashboardLoader principal={snapshot.principal} />
  ) : (
    <PageState kind="unauthorized" title={t("missing")} />
  );
}
function DashboardLoader({ principal }: { principal: Principal }) {
  const service = useWorkspaceService<DashboardService>("dashboard");
  const { t } = useTranslation("dashboard");
  const read = useCallback(
    (signal: AbortSignal) => service.catalog(principal, signal),
    [service, principal],
  );
  const { result, retry } = useServiceRead(principal.id, read);
  if (!result)
    return (
      <PageFrame title={t("title")} width="wide">
        <Skeleton label={t("loading")} />
      </PageFrame>
    );
  if (result.error)
    return (
      <PageFrame title={t("title")} width="wide">
        <PageState
          kind="error"
          title={t("error")}
          action={<Button onClick={retry}>{t("retry")}</Button>}
        />
      </PageFrame>
    );
  return <DashboardContent principal={principal} catalog={result.data} />;
}
function MetricCard({
  metric,
  inspect,
}: {
  metric: Metric;
  inspect(trigger: HTMLElement): void;
}) {
  const { t } = useTranslation("dashboard");
  const { preferences } = usePreferences();
  const formatted = formatMetric(
    metric,
    preferences.locale === "vi" ? "vi-VN" : "en-US",
  );
  return (
    <article className="business-metric" data-motion="kpi">
      <div className="row spread">
        <h2>{t(metric.id)}</h2>
        <ScanLine size={17} aria-hidden="true" />
      </div>
      <p className="metric-value number" data-metric={metric.id}>
        {formatted.value}
        {metric.value !== null ? (
          <span>
            {metric.unit === "%"
              ? "%"
              : t(metric.id === "transactions" ? "transactionsUnit" : "units")}
          </span>
        ) : null}
      </p>
      <p className="metric-change">
        {metric.delta === null ? (
          <span className="muted">
            {t("baseline")}:{" "}
            {metric.baseline === null
              ? "—"
              : formatNumber(metric.baseline, preferences.locale, {
                  maximumFractionDigits: metric.unit === "%" ? 1 : 0,
                })}
          </span>
        ) : (
          <>
            <span aria-hidden="true">
              {metric.delta >= 0 ? (
                <ArrowUpRight size={18} />
              ) : (
                <ArrowDownRight size={18} />
              )}
            </span>
            <strong>{formatted.delta}</strong>
            <span className="muted">
              {t("baseline")}:{" "}
              {metric.baseline === null
                ? "—"
                : formatNumber(metric.baseline, preferences.locale, {
                    maximumFractionDigits: metric.id === "slowShare" ? 1 : 0,
                  })}
            </span>
          </>
        )}
      </p>
      <details className="metric-definition">
        <summary>{t("definition")}</summary>
        {metric.id === "slowShare" ? (
          <p className="metric-note">
            {t("slowSample", {
              slow: metric.numerator ?? "—",
              eligible: metric.denominator ?? "—",
            })}
          </p>
        ) : (
          <p className="metric-note">
            {t(metric.id === "inventory" ? "stockNote" : "flowNote")}
          </p>
        )}
        <dl>
          <dt>{t("source")}</dt>
          <dd>{metric.source?.label ?? t("missing")}</dd>
          <dt>{t("dataThrough")}</dt>
          <dd>
            {metric.source
              ? formatDate(
                  metric.source.dataThrough,
                  preferences.locale,
                  preferences.timezone,
                )
              : "—"}
          </dd>
          <dt>{t("updated")}</dt>
          <dd>
            {metric.source
              ? formatDate(
                  metric.source.updatedAt,
                  preferences.locale,
                  preferences.timezone,
                )
              : "—"}
          </dd>
          <dt>{t("policy")}</dt>
          <dd>{metric.policyVersion}</dd>
          <dt>{t("coverage")}</dt>
          <dd>{metric.quality}</dd>
        </dl>
      </details>
      <Button variant="ghost" onClick={(e) => inspect(e.currentTarget)}>
        {t("inspect")} <ArrowRight size={15} aria-hidden="true" />
      </Button>
    </article>
  );
}
function DashboardContent({
  principal,
  catalog,
}: {
  principal: Principal;
  catalog: WorkspaceCatalog;
}) {
  const { preferences } = usePreferences();
  const { t } = useTranslation("dashboard");
  const service = useWorkspaceService<DashboardService>("dashboard");
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const parsed = useMemo(
    () =>
      parseDashboardQuery(
        new URLSearchParams(search),
        catalog.defaultScope,
        catalog.projects,
      ),
    [search, catalog],
  );
  const canonical = serializeDashboardQuery(parsed.query).toString();
  useEffect(() => {
    // A lazy destination may suspend while this old page is still mounted.
    // Never let a late catalog result navigate back over the user's new route.
    if (window.location.pathname !== "/") return;
    const next = new URLSearchParams(search);
    const keys = [
      "from",
      "to",
      "timezone",
      "market",
      "project",
      "inspect",
      "target",
      "taskState",
    ];
    const current = new URLSearchParams();
    keys.forEach((key) => {
      if (next.has(key)) current.set(key, next.get(key)!);
      next.delete(key);
    });
    if (current.toString() === canonical) return;
    new URLSearchParams(canonical).forEach((value, key) =>
      next.set(key, value),
    );
    setParams(next, { replace: true });
  }, [search, canonical, setParams]);
  const { from, to, timezone, market, project } = parsed.query.scope;
  const scope = useMemo(
    () => ({ from, to, timezone, market, project }),
    [from, to, timezone, market, project],
  );
  const scopeKey = JSON.stringify(scope);
  const read = useCallback(
    (signal: AbortSignal) => service.overview(principal, scope, signal),
    [service, principal, scope],
  );
  const { result, retry } = useServiceRead(`${principal.id}:${scopeKey}`, read);
  const dashboardRoot = useRef<HTMLDivElement>(null);
  useAnalyticalMotion(
    dashboardRoot,
    `${principal.id}:${scopeKey}:${result ? "ready" : "loading"}`,
    "dashboard",
  );
  const [dateError, setDateError] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const inspectHeading = useRef<HTMLHeadingElement>(null);
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  const inspect = (kind: string, element: HTMLElement, target?: string) => {
    trigger.current = element;
    update({ inspect: kind, target, inspectPage: undefined });
  };
  useEffect(() => {
    if (parsed.query.inspect) inspectHeading.current?.focus();
    else trigger.current?.focus();
  }, [parsed.query.inspect]);
  function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const from = String(fields.get("from"));
    const to = String(fields.get("to"));
    if (!from || !to || from >= to || (daysBetween(from, to) ?? 0) > 366) {
      setDateError(true);
      return;
    }
    setDateError(false);
    update({ from, to, inspectPage: undefined });
  }
  const data = result?.data;
  const inventory =
    data?.inventory.state === "ready" ? data.inventory.data : null;
  const transactions =
    data?.transactions.state === "ready" ? data.transactions.data : null;
  const tasks = data?.tasks.state === "ready" ? data.tasks.data : null;
  const reports = data?.reports.state === "ready" ? data.reports.data : null;
  const reportsParams = new URLSearchParams({
    status: "completed",
    dateField: "completedAt",
    from: scope.from,
    to: scope.to,
    timezone: scope.timezone,
  });
  if (scope.project) reportsParams.set("project", scope.project);
  if (scope.market) reportsParams.set("market", scope.market);
  const libraryPath = `/reports?${reportsParams}`;
  const inspectScope = useMemo(
    () =>
      parsed.query.inspect === "project"
        ? { ...scope, project: parsed.query.target }
        : scope,
    [scope, parsed.query.inspect, parsed.query.target],
  );
  const inspectQuery = useMemo<BreakdownQuery>(
    () => ({
      page: Math.max(1, Number(params.get("inspectPage")) || 1),
      pageSize: 25,
      taskState: parsed.query.taskState,
      ageBand: ["young", "middle", "slow", "old", "unknown"].includes(
        parsed.query.target ?? "",
      )
        ? (parsed.query.target as BreakdownQuery["ageBand"])
        : undefined,
    }),
    [parsed.query.taskState, parsed.query.target, params],
  );
  const unavailable = (
    <PageState
      kind="error"
      title={t("error")}
      action={<Button onClick={retry}>{t("retry")}</Button>}
    />
  );
  return (
    <PageFrame title={t("title")} width="wide">
      <div ref={dashboardRoot} className="workspace-dashboard">
        <div className="dashboard-filters">
          <FormField id="dashboard-market" label={t("market")}>
            <Select
              id="dashboard-market"
              value={scope.market ?? ""}
              onChange={(e) =>
                update({
                  market: e.target.value,
                  project: undefined,
                  inspect: undefined,
                })
              }
            >
              <option value="">{t("all")}</option>
              {catalog.projects.map((p) => (
                <option key={p.marketId} value={p.marketId}>
                  {p.marketLabel}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="dashboard-project" label={t("project")}>
            <Select
              id="dashboard-project"
              value={scope.project ?? ""}
              onChange={(e) =>
                update({ project: e.target.value, inspect: undefined })
              }
            >
              <option value="">{t("all")}</option>
              {catalog.projects
                .filter((p) => !scope.market || p.marketId === scope.market)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <form
            onSubmit={applyPeriod}
            key={`${scope.from}:${scope.to}`}
            className="dashboard-period"
            aria-label={t("period")}
          >
            <FormField id="dashboard-from" label={t("from")}>
              <Input
                id="dashboard-from"
                name="from"
                type="date"
                required
                defaultValue={scope.from}
              />
            </FormField>
            <FormField id="dashboard-to" label={t("to")}>
              <Input
                id="dashboard-to"
                name="to"
                type="date"
                required
                defaultValue={scope.to}
              />
            </FormField>
            <Button type="submit">{t("apply")}</Button>
          </form>
        </div>
        <p className="muted dashboard-calendar">
          {t("timezone", { timezone: scope.timezone })} ·{" "}
          {t("periodRange", { from: scope.from, to: scope.to })}
        </p>
        {dateError ? (
          <InlineAlert kind="error">{t("invalid")}</InlineAlert>
        ) : null}
        {parsed.warnings.length ? (
          <InlineAlert>{t("normalized")}</InlineAlert>
        ) : null}
        {!result ? (
          <Skeleton label={t("loading")} />
        ) : result.error ? (
          unavailable
        ) : (
          <>
            <div
              className="activity-overview"
              role="group"
              aria-label={t("period")}
            >
              <Link to={libraryPath}>
                <Layers3 size={20} />
                <span>
                  <strong className="number">
                    {reports?.aggregate.distinctReports ?? "—"}
                  </strong>
                  {t("completed")}
                </span>
                <ArrowRight size={16} />
              </Link>
              <Button
                variant="ghost"
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  update({
                    inspect: "tasks",
                    taskState: "active",
                    target: undefined,
                  });
                }}
              >
                <span>
                  <strong className="number">{tasks?.active ?? "—"}</strong>
                  {t("active")}
                </span>
              </Button>
              <Button
                variant="ghost"
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  update({
                    inspect: "tasks",
                    taskState: "failed",
                    target: undefined,
                  });
                }}
              >
                <span>
                  <strong className="number">{tasks?.failed ?? "—"}</strong>
                  {t("failed")}
                </span>
              </Button>
            </div>
            <section className="business-metrics" aria-label={t("title")}>
              {inventory
                ? inventory.metrics.map((metric) => (
                    <MetricCard
                      key={metric.id}
                      metric={metric}
                      inspect={(element) => inspect(metric.inspect, element)}
                    />
                  ))
                : unavailable}
              {transactions ? (
                <MetricCard
                  metric={transactions.metric}
                  inspect={(element) => inspect("transactions", element)}
                />
              ) : (
                unavailable
              )}
            </section>
            {inventory?.summary ? (
              <p className="inventory-coverage">
                {t("eligible", {
                  eligible: inventory.summary.eligible,
                  total: inventory.summary.total,
                  unknown: inventory.summary.unknown,
                })}{" "}
                · {t("coverage")}: {inventory.summary.coverage ?? "—"}%
              </p>
            ) : null}
            <div className="dashboard-charts">
              {inventory?.summary ? (
                <InventoryAgeChart
                  summary={inventory.summary}
                  scope={`${scope.from} → ${scope.to}`}
                  onInspect={(band, element) =>
                    inspect("inventory", element, band)
                  }
                />
              ) : (
                <PageState
                  kind="empty"
                  title={t("ageTitle")}
                  description={t("missing")}
                />
              )}
              {transactions ? (
                <TransactionTrendChart
                  points={transactions.trend}
                  current={transactions.metric.value}
                  previous={transactions.metric.baseline}
                  scope={`${scope.from} → ${scope.to}`}
                />
              ) : (
                unavailable
              )}
            </div>
            {data?.attention.length ? (
              <section className="attention-section" data-motion="insight">
                <SectionHeading title={t("attention")} />
                <div className="attention-list">
                  {data.attention.map((item) => (
                    <details key={item.id}>
                      <summary>
                        {t(`attention${item.rule}`, {
                          unknown: inventory?.summary?.unknown,
                          total: inventory?.summary?.total,
                          count: tasks?.failed,
                          project: catalog.projects.find(
                            (p) => p.id === item.projectId,
                          )?.name,
                        })}
                      </summary>
                      <p className="muted">
                        {t("dataThrough")}:{" "}
                        <time dateTime={item.observedAt}>
                          {formatDate(
                            item.observedAt,
                            preferences.locale,
                            preferences.timezone,
                          )}
                        </time>{" "}
                        · {t("policy")}: {item.policyVersion}
                      </p>
                      <p className="evidence-ids">
                        {t("evidence")}: {item.evidenceIds.join(", ")}
                      </p>
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          update({
                            inspect:
                              item.rule === "AT02"
                                ? "tasks"
                                : item.rule === "AT03"
                                  ? "project"
                                  : "inventory",
                            target:
                              item.rule === "AT01"
                                ? "unknown"
                                : (item.projectId ?? undefined),
                            taskState:
                              item.rule === "AT02" ? "failed" : undefined,
                            inspectPage: undefined,
                          });
                        }}
                      >
                        {t("inspect")} <ArrowRight size={15} />
                      </Button>
                    </details>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="dashboard-bottom">
              <section className="project-priority">
                <SectionHeading
                  title={t("projects")}
                  description={t("projectsNote")}
                />
                {inventory ? (
                  <TableSurface
                    caption={t("projects")}
                    header={
                      <tr>
                        <th scope="col">{t("project")}</th>
                        <th scope="col">{t("slowColumn")}</th>
                        <th scope="col">%</th>
                        <th scope="col">{t("coverage")}</th>
                        <th scope="col">{t("inspect")}</th>
                      </tr>
                    }
                  >
                    {inventory.projects.map((row) => (
                      <tr key={row.project.id}>
                        <th scope="row">
                          <span>{row.project.name}</span>
                          <small className="muted">
                            {row.project.marketLabel}
                          </small>
                        </th>
                        <td className="number">
                          {row.summary.slow}/{row.summary.eligible}
                        </td>
                        <td className="number">
                          {row.summary.share === null
                            ? "—"
                            : formatNumber(
                                row.summary.share,
                                preferences.locale,
                                { maximumFractionDigits: 1 },
                              )}
                          %
                        </td>
                        <td>
                          {row.summary.eligible < 20 ? (
                            <StatusBadge
                              label={t("smallSample")}
                              tone="warning"
                            />
                          ) : (
                            `${row.summary.coverage === null ? "—" : formatNumber(row.summary.coverage, preferences.locale, { maximumFractionDigits: 0 })}%`
                          )}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={(e) =>
                              inspect(
                                "project",
                                e.currentTarget,
                                row.project.id,
                              )
                            }
                            aria-label={`${t("inspect")} ${row.project.name}`}
                          >
                            <ArrowRight size={18} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </TableSurface>
                ) : (
                  unavailable
                )}
              </section>
              <section className="recent-reports">
                <div className="row spread">
                  <SectionHeading title={t("recent")} />
                  <Link to={libraryPath}>{t("library")} →</Link>
                </div>
                {reports ? (
                  reports.recent.length ? (
                    <ol>
                      {reports.recent.map((row) => (
                        <li key={row.record.id}>
                          <Link
                            to={`/reports/${encodeURIComponent(row.record.id)}?version=${encodeURIComponent(row.matchedVersion!.id)}`}
                          >
                            <span>
                              <small className="muted">
                                {row.record.code} · v
                                {row.matchedVersion!.sequence}
                              </small>
                              <strong>{row.record.title}</strong>
                            </span>
                            <ArrowRight size={17} />
                          </Link>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>{t("noReports")}</p>
                  )
                ) : (
                  unavailable
                )}
                <Link className="button button-ghost" to="/chat">
                  {t("openChat")} <ArrowRight size={15} />
                </Link>
              </section>
            </div>
          </>
        )}
        {parsed.query.inspect ? (
          <section className="dashboard-inspect">
            <div className="row spread">
              <h2 ref={inspectHeading} tabIndex={-1}>
                {t("inspect")}
              </h2>
              <Button
                onClick={() =>
                  update({
                    inspect: undefined,
                    target: undefined,
                    taskState: undefined,
                    inspectPage: undefined,
                  })
                }
              >
                {t("close")}
              </Button>
            </div>
            <DashboardInspect
              principal={principal}
              scope={inspectScope}
              kind={
                (parsed.query.inspect === "project"
                  ? "inventory"
                  : parsed.query.inspect) as BreakdownKind
              }
              query={inspectQuery}
              onPage={(page) => {
                inspectHeading.current?.focus({ preventScroll: true });
                update({ inspectPage: String(page) });
              }}
            />
          </section>
        ) : null}
      </div>
    </PageFrame>
  );
}
