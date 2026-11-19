import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { RotateCcw, Search, UserRound } from "lucide-react";
import { useAuth } from "../../auth/providers/AuthProvider";
import { useWorkspaceService } from "../../../app/providers/ServicesProvider";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { formatDate } from "../../../shared/lib/format";
import { useOverlay } from "../../../app/providers/OverlayProvider";
import { PageFrame, PageState } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { FormField, Input, Select } from "../../../shared/ui/form";
import {
  InlineAlert,
  Skeleton,
  useFeedback,
} from "../../../shared/ui/feedback";
import {
  Pagination,
  StatusBadge,
  TableSurface,
  TableToolbar,
} from "../../../shared/ui/data";
import type { Principal } from "../../../shared/contracts/auth";
import type { AdminUsersService } from "../services/admin-users-service";
import type { AdminQuery, ManagedUser } from "../model/types";
import {
  defaultAdminQuery,
  parseAdminQuery,
  serializeAdminQuery,
} from "../model/query";
import { useServiceRead } from "../../reports/hooks/useServiceRead";
import { useCompactRows } from "../../reports/hooks/useCompactRows";
import { AdminUserCards } from "../components/AdminUserCards";
import { StatusConfirmation } from "../components/StatusConfirmation";
import { AdminUserDetail } from "../components/AdminUserDetail";
import "./admin-users.css";

export default function AdminUsersPage() {
  const { snapshot } = useAuth();
  return snapshot.status === "authenticated" &&
    snapshot.principal.role === "ADMIN" ? (
    <AdminContent principal={snapshot.principal} />
  ) : null;
}
function ResetConfirmation({
  service,
  principal,
  onDone,
  close,
}: {
  service: AdminUsersService;
  principal: Principal;
  onDone(): void;
  close(): void;
}) {
  const { t } = useTranslation("admin-users");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  async function reset() {
    setState("pending");
    const result = await service.reset(principal);
    if (result.error) setState("error");
    else {
      onDone();
      close();
    }
  }
  return (
    <div className="admin-status-confirmation stack">
      <p>{t("session")}</p>
      {state === "error" ? (
        <InlineAlert kind="error">{t("error")}</InlineAlert>
      ) : null}
      <div className="admin-confirm-actions">
        <Button disabled={state === "pending"} onClick={close}>
          {t("cancel")}
        </Button>
        <Button pending={state === "pending"} onClick={() => void reset()}>
          {t("reset")}
        </Button>
      </div>
    </div>
  );
}
function AdminContent({ principal }: { principal: Principal }) {
  const { preferences } = usePreferences();
  const compact = useCompactRows();
  const { t } = useTranslation("admin-users");
  const service = useWorkspaceService<AdminUsersService>("admin-users");
  const overlay = useOverlay();
  const feedback = useFeedback();
  const [params, setParams] = useSearchParams();
  const raw = params.toString();
  const parsed = useMemo(
    () => parseAdminQuery(new URLSearchParams(raw)),
    [raw],
  );
  const serialized = serializeAdminQuery({
    ...parsed,
    user: undefined,
  }).toString();
  const query = useMemo(
    () => parseAdminQuery(new URLSearchParams(serialized)),
    [serialized],
  );
  const [revision, refresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useCallback(
    (signal: AbortSignal) => service.list(principal, query, signal),
    [service, principal, query],
  );
  const { result, retry } = useServiceRead(
    `${principal.id}:${serialized}:${revision}`,
    read,
  );
  function apply(patch: Partial<AdminQuery>) {
    const next = new URLSearchParams(params);
    ["q", "status", "sort", "direction", "page", "pageSize", "user"].forEach(
      (key) => next.delete(key),
    );
    serializeAdminQuery({
      ...query,
      user: parsed.user,
      ...patch,
      page: patch.page ?? 1,
    }).forEach((value, key) => next.append(key, value));
    setParams(next);
  }
  useEffect(() => {
    if (!result?.data || result.data.page === query.page) return;
    const next = new URLSearchParams(raw);
    next.set("page", String(result.data.page));
    setParams(next, { replace: true });
  }, [result, query.page, raw, setParams]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({
      q: String(new FormData(event.currentTarget).get("q") ?? "").trim(),
    });
  }
  const onDone = (success: boolean) => {
    refresh((v) => v + 1);
    if (success) feedback({ kind: "success", title: t("resultFiltered") });
  };
  function change(user: ManagedUser) {
    const status = user.status === "active" ? "disabled" : "active";
    overlay.open({
      id: "feature-dialog",
      title: t(status === "disabled" ? "confirmDisable" : "confirmEnable"),
      triggerRef: heading,
      content: (
        <StatusConfirmation
          key={`${user.id}:${user.revision}`}
          service={service}
          principal={principal}
          user={user}
          status={status}
          onDone={onDone}
          onClose={overlay.close}
        />
      ),
    });
  }
  function reset() {
    overlay.open({
      id: "feature-dialog",
      title: t("resetConfirm"),
      triggerRef: heading,
      content: (
        <ResetConfirmation
          service={service}
          principal={principal}
          close={overlay.close}
          onDone={() => {
            refresh((v) => v + 1);
            feedback({ kind: "success", title: t("resetDone") });
          }}
        />
      ),
    });
  }
  const filtered = !!(query.q || query.statuses.length);
  return (
    <PageFrame
      title={t("title")}
      width="wide"
      actions={
        <Button onClick={reset}>
          <RotateCcw size={16} />
          {t("reset")}
        </Button>
      }
    >
      <div className="admin-users-workspace">
        <InlineAlert>{t("session")}</InlineAlert>
        <div className="admin-filter-panel">
          <TableToolbar>
            <form onSubmit={search} className="admin-search">
              <FormField id="admin-search" label={t("search")}>
                <Input
                  id="admin-search"
                  name="q"
                  type="search"
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
              onClick={() => apply(defaultAdminQuery())}
            >
              {t("clear")}
            </Button>
          </TableToolbar>
          <div className="admin-filters">
            <FormField id="admin-status" label={t("status")}>
              <Select
                id="admin-status"
                value={query.statuses[0] ?? ""}
                onChange={(e) =>
                  apply({
                    statuses: e.target.value
                      ? [e.target.value as "active" | "disabled"]
                      : [],
                  })
                }
              >
                <option value="">{t("all")}</option>
                <option value="active">{t("active")}</option>
                <option value="disabled">{t("disabled")}</option>
              </Select>
            </FormField>
            <FormField id="admin-sort" label={t("sort")}>
              <Select
                id="admin-sort"
                value={query.sort}
                onChange={(e) =>
                  apply({ sort: e.target.value as AdminQuery["sort"] })
                }
              >
                {["createdAt", "lastActiveAt", "name"].map((sort) => (
                  <option key={sort} value={sort}>
                    {t(sort)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField id="admin-direction" label={t("direction")}>
              <Select
                id="admin-direction"
                value={query.direction}
                onChange={(e) =>
                  apply({ direction: e.target.value as "asc" | "desc" })
                }
              >
                <option value="desc">{t("descending")}</option>
                <option value="asc">{t("ascending")}</option>
              </Select>
            </FormField>
            <FormField id="admin-page-size" label={t("pageSize")}>
              <Select
                id="admin-page-size"
                value={query.pageSize}
                onChange={(e) =>
                  apply({
                    pageSize: Number(e.target.value) as AdminQuery["pageSize"],
                  })
                }
              >
                {[25, 50, 100].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>
        <h2
          ref={heading}
          tabIndex={-1}
          className="admin-result-count"
          aria-live="polite"
        >
          {result?.data
            ? t("count", { count: result.data.totalRows })
            : t("loading")}
        </h2>
        {!result ? (
          <Skeleton label={t("loading")} />
        ) : result.error ? (
          <PageState
            kind="error"
            title={t("error")}
            action={<Button onClick={retry}>{t("retry")}</Button>}
          />
        ) : result.data.rows.length ? (
          <>
            {compact ? (
              <AdminUserCards
                users={result.data.rows}
                open={(id) => apply({ user: id })}
                change={change}
              />
            ) : (
              <TableSurface
                caption={t("title")}
                header={
                  <tr>
                    <th scope="col">{t("name")}</th>
                    <th scope="col">{t("role")}</th>
                    <th scope="col">{t("status")}</th>
                    <th scope="col">{t("createdAt")}</th>
                    <th scope="col">{t("lastActiveAt")}</th>
                    <th scope="col">{t("actions")}</th>
                  </tr>
                }
              >
                {result.data.rows.map((user) => (
                  <tr key={user.id}>
                    <th scope="row" className="admin-name-cell">
                      <Button
                        variant="ghost"
                        onClick={() => apply({ user: user.id })}
                      >
                        <UserRound size={17} />
                        <span>
                          {user.name}
                          <small>{user.email}</small>
                        </span>
                      </Button>
                    </th>
                    <td>
                      <span className="badge">USER</span>
                    </td>
                    <td>
                      <StatusBadge
                        label={t(user.status)}
                        tone={user.status === "active" ? "success" : "neutral"}
                      />
                    </td>
                    <td>
                      <time dateTime={user.createdAt}>
                        {formatDate(
                          user.createdAt,
                          preferences.locale,
                          preferences.timezone,
                          { dateStyle: "medium" },
                        )}
                      </time>
                    </td>
                    <td>
                      {user.lastActiveAt ? (
                        <time dateTime={user.lastActiveAt}>
                          {formatDate(
                            user.lastActiveAt,
                            preferences.locale,
                            preferences.timezone,
                            { dateStyle: "medium" },
                          )}
                        </time>
                      ) : (
                        <span className="muted admin-no-activity">
                          {t("noActivity")}
                        </span>
                      )}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => change(user)}
                        aria-label={`${t(user.status === "active" ? "disable" : "enable")} ${user.email}`}
                      >
                        {t(user.status === "active" ? "disable" : "enable")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </TableSurface>
            )}
            <Pagination
              page={result.data.page}
              pageCount={result.data.pageCount}
              onPageChange={(page) => {
                heading.current?.focus({ preventScroll: true });
                apply({ page });
              }}
              previousLabel={t("previous")}
              nextLabel={t("next")}
              label={t("pagination")}
            />
          </>
        ) : (
          <PageState
            kind="empty"
            title={t(filtered ? "noMatch" : "empty")}
            action={
              filtered ? (
                <Button onClick={() => apply(defaultAdminQuery())}>
                  {t("clear")}
                </Button>
              ) : undefined
            }
          />
        )}
        {parsed.user ? (
          <AdminUserDetail
            key={parsed.user}
            principal={principal}
            id={parsed.user}
            revision={revision}
            onClose={() => {
              apply({ user: undefined });
              heading.current?.focus();
            }}
            onChange={change}
          />
        ) : null}
      </div>
    </PageFrame>
  );
}
