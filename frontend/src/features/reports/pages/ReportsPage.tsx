import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { useAuth } from "../../auth/providers/AuthProvider";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import type { Principal } from "../../../shared/contracts/auth";
import { PageFrame, PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { FormField, Input, Select } from "../../../shared/ui/form";
import { InlineAlert, Skeleton } from "../../../shared/ui/feedback";
import { Pagination, TableToolbar } from "../../../shared/ui/data";
import { Dialog } from "../../../shared/ui/overlay";
import type { ReportsService } from "../services/reports-service";
import type { ReportQuery, ReportSummary } from "../model/types";
import {
  defaultReportQuery,
  parseReportQuery,
  serializeReportQuery,
} from "../model/query";
import { useServiceRead } from "../hooks/useServiceRead";
import { useReportRefresh } from "../hooks/useReportRefresh";
import { ReportCards } from "../components/ReportCards";
import "./reports.css";
import { chatReturnPath } from "../../chat/model/report-navigation";
const ReportViewer = lazy(() => import("./ReportDetailPage"));
const queryKeys = [
  "q",
  "type",
  "status",
  "market",
  "project",
  "author",
  "agent",
  "dateField",
  "from",
  "to",
  "timezone",
  "sort",
  "direction",
  "page",
  "pageSize",
];

export default function ReportsPage() {
  const { id } = useParams();
  const { snapshot } = useAuth();
  const { t } = useTranslation("reports");
  if (snapshot.status !== "authenticated" || snapshot.principal.role !== "USER")
    return null;
  return (
    <div className="reports-route">
      <Suspense
        fallback={
          <PageFrame title={t("detail")} width="wide">
            <Skeleton label={t("loading")} />
          </PageFrame>
        }
      >
        <ReportLibrary principal={snapshot.principal} directId={id} />
      </Suspense>
    </div>
  );
}
function ReportLibrary({
  principal,
  directId,
}: {
  principal: Principal;
  directId?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation("reports");
  const service = useWorkspaceService<ReportsService>("reports");
  const [params, setParams] = useSearchParams();
  const raw = params.toString();
  const resultHeading = useRef<HTMLParagraphElement>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const viewerDepth = useRef<number | undefined>(
    location.state?.reportViewerDepth,
  );
  useLayoutEffect(() => {
    viewerDepth.current = location.state?.reportViewerDepth;
  }, [location.key, location.state]);
  const previewId = directId ?? params.get("report");
  const previewVersion = params.get("version") ?? undefined;
  const mode =
    params.get("view") === "detail" || (directId && !params.has("view"))
      ? "detail"
      : "dashboard";
  const listParams = new URLSearchParams(params);
  ["report", "version", "view"].forEach((key) => listParams.delete(key));
  const returnTo = `/reports${listParams.size ? `?${listParams}` : ""}`;
  const chatOrigin = chatReturnPath(location.state?.chatOrigin);
  const previousPreview = useRef(previewId);
  useEffect(() => {
    if (previousPreview.current && !previewId) {
      requestAnimationFrame(() =>
        (previewTrigger.current?.isConnected
          ? previewTrigger.current
          : resultHeading.current
        )?.focus({ preventScroll: true }),
      );
    }
    previousPreview.current = previewId;
  }, [previewId]);
  const parsed = useMemo(
    () => parseReportQuery(new URLSearchParams(raw)),
    [raw],
  );
  const serialized = serializeReportQuery(parsed.query).toString();
  const query = useMemo(
    () => parseReportQuery(new URLSearchParams(serialized)).query,
    [serialized],
  );
  const read = useCallback(
    (signal: AbortSignal) => service.list(principal, query, signal),
    [service, principal, query],
  );
  const readCatalog = useCallback(
    (signal: AbortSignal) => service.catalog(principal, signal),
    [service, principal],
  );
  const { result, retry } = useServiceRead(
    `${principal.id}:${serialized}`,
    read,
  );
  const { result: catalog } = useServiceRead(principal.id, readCatalog);
  useReportRefresh(service, null, retry);
  const [deleteTarget, setDeleteTarget] = useState<ReportSummary | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    setDeleteError(false);
    const outcome = await service.delete(principal, deleteTarget.record.id);
    setDeletePending(false);
    if (outcome.error) {
      setDeleteError(true);
      return;
    }
    setDeleteTarget(null);
    retry();
  }
  function apply(patch: Partial<ReportQuery>, replace = false) {
    const next = new URLSearchParams(params);
    queryKeys.forEach((key) => next.delete(key));
    const normalized = serializeReportQuery({
      ...query,
      ...patch,
      page: patch.page ?? 1,
    });
    normalized.forEach((value, key) => next.append(key, value));
    next.delete("report");
    next.delete("version");
    next.delete("view");
    setParams(next, { replace });
  }
  useEffect(() => {
    if (!result?.data || result.data.page === query.page) return;
    const next = new URLSearchParams(raw);
    next.set("page", String(result.data.page));
    setParams(next, { replace: true });
  }, [result, query.page, raw, setParams]);
  useEffect(() => {
    if (!parsed.warnings.length) return;
    const next = new URLSearchParams(raw);
    queryKeys.forEach((key) => next.delete(key));
    new URLSearchParams(serialized).forEach((value, key) =>
      next.append(key, value),
    );
    setParams(next, { replace: true });
  }, [raw, serialized, parsed.warnings.length, setParams]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({
      q: String(new FormData(event.currentTarget).get("q") ?? "").trim(),
    });
  }
  function dates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") ?? "") || undefined;
    const to = String(data.get("to") ?? "") || undefined;
    if (from && to && from >= to) {
      event.currentTarget
        .querySelector<HTMLInputElement>('[name="to"]')
        ?.setCustomValidity(t("invalidDate"));
      event.currentTarget.reportValidity();
      return;
    }
    apply({
      from,
      to,
      dateField:
        data.get("dateField") === "completedAt" ? "completedAt" : "createdAt",
    });
  }
  const filtered = !!(
    query.q ||
    query.types.length ||
    query.statuses.length ||
    query.projects.length ||
    query.markets.length ||
    query.authors.length ||
    query.agents.length ||
    query.from ||
    query.to
  );
  function preview(row: ReportSummary, trigger: HTMLElement) {
    previewTrigger.current = trigger;
    viewerDepth.current = 1;
    const next = new URLSearchParams(params);
    next.set("report", row.record.id);
    next.set("view", "dashboard");
    const version = row.matchedVersion ?? row.latestVersion;
    if (version) next.set("version", version.id);
    else next.delete("version");
    setParams(next, { state: { reportViewerDepth: 1 } });
  }
  function closePreview() {
    if (chatOrigin) {
      navigate(chatOrigin, {
        replace: true,
        state: { chatFocusMessage: location.state?.chatFocusMessage },
      });
      return;
    }
    const depth = viewerDepth.current;
    if (
      !directId &&
      typeof depth === "number" &&
      Number.isSafeInteger(depth) &&
      depth > 0 &&
      depth < 100
    ) {
      navigate(-depth);
    } else {
      navigate(returnTo, { replace: true });
    }
  }
  function updateViewer(
    patch: { view?: "dashboard" | "detail"; version?: string },
    replace = false,
  ) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => next.set(key, value));
    const depth = viewerDepth.current;
    // Search-param navigation updates browser history before React commits route
    // props. Keep Close correct even when it follows a mode/version change at once.
    const nextDepth =
      typeof depth === "number" && Number.isSafeInteger(depth) && depth > 0
        ? depth + (replace ? 0 : 1)
        : undefined;
    viewerDepth.current = nextDepth;
    setParams(next, {
      replace,
      state: nextDepth
        ? { ...location.state, reportViewerDepth: nextDepth }
        : location.state,
    });
  }
  const projects = catalog?.data?.projects ?? [];
  const activeFilters = [
    ...(query.q
      ? [{ label: `${t("search")}: ${query.q}`, patch: { q: "" } }]
      : []),
    ...(
      ["types", "statuses", "markets", "projects", "authors", "agents"] as const
    ).flatMap((key) =>
      query[key].map((value) => ({
        label: `${t(({ types: "type", statuses: "status", markets: "market", projects: "project", authors: "author", agents: "agent" } as const)[key])}: ${key === "projects" ? (projects.find((p) => p.id === value)?.name ?? value) : key === "authors" ? (catalog?.data?.authors.find((a) => a.id === value)?.name ?? value) : key === "types" || key === "statuses" ? t(value) : value}`,
        patch: { [key]: query[key].filter((item) => item !== value) },
      })),
    ),
    ...(query.from || query.to
      ? [
          {
            label: `${t(query.dateField)}: ${query.from ?? "…"} → ${query.to ?? "…"}`,
            patch: { from: undefined, to: undefined },
          },
        ]
      : []),
  ];
  return (
    <PageFrame title={t("title")} width="wide">
      <div className="reports-workspace">
        <div className="report-filter-panel">
          <TableToolbar>
            <form className="report-search" onSubmit={search}>
              <FormField id="report-search" label={t("search")}>
                <Input
                  id="report-search"
                  type="search"
                  name="q"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("searchPlaceholder")}
                  defaultValue={query.q}
                  key={query.q}
                />
              </FormField>
              <Button type="submit" aria-label={t("search")}>
                <Search size={18} />
              </Button>
            </form>
            <Button
              variant="ghost"
              disabled={!filtered}
              onClick={() => apply(defaultReportQuery())}
            >
              {t("clear")}
            </Button>
          </TableToolbar>
          <div className="report-filters">
            <FormField id="report-type" label={t("type")}>
              <Select
                id="report-type"
                value={query.types[0] ?? ""}
                onChange={(e) =>
                  apply({
                    types: e.target.value
                      ? [e.target.value as ReportQuery["types"][number]]
                      : [],
                  })
                }
              >
                <option value="">{t("all")}</option>
                {(
                  catalog?.data?.reportTypes ??
                  [
                    ...new Set(
                      result?.data?.rows.map((row) => row.record.type) ?? [],
                    ),
                  ].map((id) => ({ id, name: id }))
                ).map((type) => (
                  <option key={type.id} value={type.id}>
                    {t(type.id, { defaultValue: type.name })}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="report-status" label={t("status")}>
              <Select
                id="report-status"
                value={query.statuses[0] ?? ""}
                onChange={(e) =>
                  apply({
                    statuses: e.target.value
                      ? [e.target.value as ReportQuery["statuses"][number]]
                      : [],
                  })
                }
              >
                <option value="">{t("all")}</option>
                {[
                  "completed",
                  "generating",
                  "failed",
                  "draft",
                  "unsupported",
                ].map((status) => (
                  <option key={status} value={status}>
                    {t(status)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="report-market" label={t("market")}>
              <Select
                id="report-market"
                value={query.markets[0] ?? ""}
                onChange={(e) =>
                  apply({
                    markets: e.target.value ? [e.target.value] : [],
                    projects: [],
                  })
                }
              >
                <option value="">{t("all")}</option>
                {projects.map((project) => (
                  <option key={project.marketId} value={project.marketId}>
                    {project.marketLabel}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="report-project" label={t("project")}>
              <Select
                id="report-project"
                value={query.projects[0] ?? ""}
                onChange={(e) =>
                  apply({ projects: e.target.value ? [e.target.value] : [] })
                }
              >
                <option value="">{t("all")}</option>
                {projects
                  .filter(
                    (project) =>
                      !query.markets.length ||
                      query.markets.includes(project.marketId),
                  )
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <>
              <FormField id="report-sort" label={t("sort")}>
                <Select
                  id="report-sort"
                  value={query.sort}
                  onChange={(e) =>
                    apply({ sort: e.target.value as ReportQuery["sort"] })
                  }
                >
                  {["createdAt", "completedAt", "title", "status"].map(
                    (sort) => (
                      <option key={sort} value={sort}>
                        {t(sort === "title" ? "name" : sort)}
                      </option>
                    ),
                  )}
                </Select>
              </FormField>
              <FormField id="report-direction" label={t("direction")}>
                <Select
                  id="report-direction"
                  value={query.direction}
                  onChange={(e) =>
                    apply({
                      direction: e.target.value as ReportQuery["direction"],
                    })
                  }
                >
                  <option value="desc">{t("descending")}</option>
                  <option value="asc">{t("ascending")}</option>
                </Select>
              </FormField>
            </>
          </div>
          <details className="report-date-filter">
            <summary>{t("more")}</summary>
            <form
              className="report-filters"
              onSubmit={dates}
              key={`${query.from}:${query.to}:${query.dateField}`}
            >
              <FormField id="report-date-field" label={t("dateField")}>
                <Select
                  name="dateField"
                  id="report-date-field"
                  defaultValue={query.dateField}
                >
                  <option value="createdAt">{t("createdAt")}</option>
                  <option value="completedAt">{t("completedAt")}</option>
                </Select>
              </FormField>
              <FormField id="report-from" label={t("from")}>
                <Input
                  id="report-from"
                  name="from"
                  type="date"
                  defaultValue={query.from}
                />
              </FormField>
              <FormField id="report-to" label={t("to")}>
                <Input
                  id="report-to"
                  name="to"
                  type="date"
                  defaultValue={query.to}
                  onInput={(e) => e.currentTarget.setCustomValidity("")}
                />
              </FormField>
              <Button type="submit">{t("apply")}</Button>
            </form>
            <FormField id="report-author" label={t("author")}>
              <Select
                id="report-author"
                value={query.authors[0] ?? ""}
                onChange={(e) =>
                  apply({ authors: e.target.value ? [e.target.value] : [] })
                }
              >
                <option value="">{t("all")}</option>
                {catalog?.data?.authors.map((author) => (
                  <option key={author.id} value={author.id}>
                    {author.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="report-agent" label={t("agent")}>
              <Select
                id="report-agent"
                value={query.agents[0] ?? ""}
                onChange={(e) =>
                  apply({ agents: e.target.value ? [e.target.value] : [] })
                }
              >
                <option value="">{t("all")}</option>
                {catalog?.data?.agents.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </Select>
            </FormField>
          </details>
        </div>
        {activeFilters.length ? (
          <ul className="report-filter-chips" aria-label={t("activeFilters")}>
            {activeFilters.map((filter) => (
              <li key={filter.label}>
                <Button
                  variant="ghost"
                  onClick={() => apply(filter.patch)}
                  aria-label={t("removeFilter", { filter: filter.label })}
                >
                  {filter.label} ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {parsed.warnings.length ? (
          <InlineAlert>{t("normalized")}</InlineAlert>
        ) : null}
        <div className="report-result-heading">
          <p ref={resultHeading} tabIndex={-1} role="status">
            {result?.data
              ? t("results", { count: result.data.totalRows })
              : t("loading")}
          </p>
          <FormField id="report-page-size" label={t("pageSize")}>
            <Select
              id="report-page-size"
              value={query.pageSize}
              onChange={(e) =>
                apply({
                  pageSize: Number(e.target.value) as ReportQuery["pageSize"],
                })
              }
            >
              {[25, 50, 100].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </Select>
          </FormField>
        </div>
        {!result ? (
          <Skeleton label={t("loading")} />
        ) : result.error ? (
          <PageState
            kind="error"
            title={t("error")}
            action={<Button onClick={retry}>{t("retry")}</Button>}
          />
        ) : (
          <>
            {result.data.rows.length ? (
              <ReportCards
                rows={result.data.rows}
                reportTypes={catalog?.data?.reportTypes}
                projects={projects}
                dateField={query.dateField}
                returnTo={returnTo}
                onOpen={preview}
                onDelete={(row) => {
                  setDeleteError(false);
                  setDeleteTarget(row);
                }}
              />
            ) : (
              <PageState
                kind="empty"
                title={t(filtered ? "noMatch" : "empty")}
                description={t(filtered ? "noMatchNote" : "emptyNote")}
                action={
                  filtered ? (
                    <Button onClick={() => apply(defaultReportQuery())}>
                      {t("clear")}
                    </Button>
                  ) : undefined
                }
              />
            )}
            <Pagination
              page={result.data.page}
              pageCount={result.data.pageCount}
              onPageChange={(page) => {
                resultHeading.current?.focus({ preventScroll: true });
                apply({ page });
              }}
              label={t("pagination")}
              previousLabel={t("previous")}
              nextLabel={t("next")}
            />
          </>
        )}
      </div>
      {previewId ? (
        <Suspense fallback={<Skeleton label={t("loading")} />}>
          <ReportViewer
            principal={principal}
            id={previewId}
            versionId={previewVersion}
            mode={mode}
            onClose={closePreview}
            onViewChange={(view) => updateViewer({ view })}
            onVersionChange={(version, replace) =>
              updateViewer({ version }, replace)
            }
            triggerRef={previewTrigger}
            projects={projects}
            reportTypes={catalog?.data?.reportTypes}
            returnToChat={!!chatOrigin}
          />
        </Suspense>
      ) : null}
      {deleteTarget ? (
        <Dialog
          open
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={t("deleteConfirmTitle", { code: deleteTarget.record.code })}
          description={t("deleteConfirmBody")}
        >
          {deleteError ? <InlineAlert>{t("deleteError")}</InlineAlert> : null}
          <div className="row spread">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t("deleteCancel")}
            </Button>
            <Button
              variant="danger"
              pending={deletePending}
              onClick={confirmDelete}
            >
              {t("deleteConfirmAction")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </PageFrame>
  );
}
