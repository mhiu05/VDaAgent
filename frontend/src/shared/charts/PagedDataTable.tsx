import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../app/providers/PreferencesProvider";
import { formatNumber } from "../lib/format";
import { TableSurface } from "../ui/data";
import { Button } from "../ui/button";

/** Bound mounted rows while retaining access to every original cell. */
export function PagedDataTable({
  caption,
  columns,
  rows,
  pageSize = 100,
}: {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  pageSize?: 25 | 100;
}) {
  const [requested, setPage] = useState(0);
  const { t } = useTranslation("reports");
  const { preferences } = usePreferences();
  const size = pageSize;
  const page = Math.min(
    requested,
    Math.max(0, Math.ceil(rows.length / size) - 1),
  );
  const start = page * size;
  const cell = (v: string | number | null) =>
    typeof v === "number"
      ? formatNumber(v, preferences.locale, { maximumFractionDigits: 2 })
      : (v ?? "—");
  return (
    <>
      <TableSurface
        caption={caption}
        header={
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        }
      >
        {rows.slice(start, start + size).map((row, i) => (
          <tr key={start + i}>
            {row.map((v, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {cell(v)}
                </th>
              ) : (
                <td
                  key={j}
                  className={typeof v === "number" ? "number" : undefined}
                >
                  {cell(v)}
                </td>
              ),
            )}
          </tr>
        ))}
      </TableSurface>
      {rows.length > size ? (
        <nav
          className="row spread"
          aria-label={`${caption} · ${t("pagination")}`}
        >
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </Button>
          <span role="status">
            {start + 1}–{Math.min(rows.length, start + size)} / {rows.length}
          </span>
          <Button
            variant="secondary"
            disabled={start + size >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </Button>
        </nav>
      ) : null}
    </>
  );
}
