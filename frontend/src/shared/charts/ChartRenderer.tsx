import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "../ui/button";
import { useChartExpansion } from "./ChartExpansion";
import {
  analyticalMotion,
  analyticalMotionAllowed,
  gsap,
  useGSAP,
} from "../motion/useAnalyticalMotion";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../app/providers/PreferencesProvider";
import { formatNumber } from "../lib/format";
import { ChartFrame } from "../ui/data";
import { PagedDataTable } from "./PagedDataTable";
import type { ChartSpec, ChartType } from "./chart-contract";
import { chartRegistry, orderChart, resolveChart } from "./chart-registry";
import "./charts.css";

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];
const color = (i: number) => palette[i % palette.length];
type PlotProps = {
  spec: ChartSpec;
  type: ChartType;
  number(v: number | null): string;
  width: number;
  height: number;
};
function PointTitle({ label }: { label: string }) {
  return <title>{label}</title>;
}

function CartesianPlot({ spec, type, number, width, height }: PlotProps) {
  const clipId = useId();
  const horizontal = type === "bar";
  const stacked = type === "stacked-bar";
  const count = spec.labels.length;
  const seriesCount = spec.series.length;
  const all = spec.series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null);
  const positive = spec.labels.map((_, i) =>
    spec.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0),
  );
  const negative = spec.labels.map((_, i) =>
    spec.series.reduce((sum, s) => sum + Math.min(0, s.values[i] ?? 0), 0),
  );
  const min = Math.min(0, ...(stacked ? negative : all));
  const max = Math.max(0, ...(stacked ? positive : all));
  const span = max - min || 1;
  const left = horizontal ? 104 : 62;
  const showBarValues = horizontal && seriesCount === 1 && count <= 12;
  const right = width - (showBarValues ? 52 : 24);
  const top = 16;
  const bottom = height - 56;
  const temporal =
    spec.dimension.kind === "temporal" && (type === "line" || type === "area");
  const numericX = type === "scatter" || type === "histogram" || temporal;
  const position = (v: string | number) =>
    temporal ? Date.parse(String(v)) : Number(v);
  const xMin = Math.min(...spec.labels.map(position));
  const xMax = Math.max(
    ...(type === "histogram" ? spec.binEnds! : spec.labels.map(position)),
  );
  const nx = (v: number) =>
    left + ((v - xMin) / (xMax - xMin || 1)) * (right - left);
  const x = (i: number) =>
    numericX
      ? nx(position(spec.labels[i]))
      : left + ((i + 0.5) / count) * (right - left);
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top);
  const hx = (v: number) => left + ((v - min) / span) * (right - left);
  const tooltip = (i: number, s: ChartSpec["series"][number]) =>
    `${spec.labels[i]}${type === "histogram" ? ` – ${spec.binEnds![i]}` : ""} · ${s.label}: ${number(s.values[i])} ${s.unit}`;
  const ticks = [min, min + span / 2, min + span];
  return (
    <>
      {ticks.map((v, i) =>
        horizontal ? (
          <g key={i} className="chart-axis">
            <line x1={hx(v)} x2={hx(v)} y1={top} y2={bottom} />
            <text x={hx(v)} y={bottom + 22} textAnchor="middle">
              {number(v)}
            </text>
          </g>
        ) : (
          <g key={i} className="chart-axis">
            <line x1={left} x2={right} y1={y(v)} y2={y(v)} />
            <text x={left - 8} y={y(v) + 4} textAnchor="end">
              {number(v)}
            </text>
          </g>
        ),
      )}
      <line
        className="chart-zero"
        x1={horizontal ? hx(0) : left}
        x2={horizontal ? hx(0) : right}
        y1={horizontal ? top : y(0)}
        y2={horizontal ? bottom : y(0)}
      />
      <defs>
        <clipPath id={clipId}>
          <rect
            data-chart-clip
            data-axis={horizontal ? "x" : "y"}
            data-baseline={horizontal ? `${hx(0)} ${top}` : `${left} ${y(0)}`}
            x={left}
            y={top}
            width={right - left}
            height={bottom - top}
          />
        </clipPath>
      </defs>
      <g
        clipPath={
          type === "line" || type === "area" || type === "scatter"
            ? undefined
            : `url(#${clipId})`
        }
      >
        {spec.series.map((s, si) => {
          if (type === "line" || type === "area") {
            const segments: { x: number; y: number }[][] = [];
            let current: { x: number; y: number }[] = [];
            s.values.forEach((v, i) => {
              if (v === null) {
                if (current.length) segments.push(current);
                current = [];
              } else current.push({ x: x(i), y: y(v) });
            });
            if (current.length) segments.push(current);
            return (
              <g key={s.id} style={{ color: color(si) }}>
                {segments.map((points, i) => (
                  <g key={i}>
                    {type === "area" && points.length > 1 ? (
                      <polygon
                        data-chart-area
                        fill="currentColor"
                        opacity=".13"
                        points={`${points[0].x},${y(0)} ${points.map((p) => `${p.x},${p.y}`).join(" ")} ${points.at(-1)!.x},${y(0)}`}
                      />
                    ) : null}
                    <polyline
                      data-chart-line
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray={si % 2 ? "6 4" : undefined}
                      points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                    />
                  </g>
                ))}
                {s.values.map((v, i) =>
                  v === null ? null : (
                    <circle
                      data-chart-mark
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r="4"
                      fill="currentColor"
                    >
                      <PointTitle label={tooltip(i, s)} />
                    </circle>
                  ),
                )}
              </g>
            );
          }
          return (
            <g key={s.id} fill={color(si)}>
              {s.values.map((v, i) => {
                if (v === null) return null;
                if (type === "scatter")
                  return (
                    <circle data-chart-mark key={i} cx={x(i)} cy={y(v)} r="5">
                      <PointTitle label={tooltip(i, s)} />
                    </circle>
                  );
                if (horizontal)
                  return (
                    <rect
                      data-chart-mark
                      key={i}
                      x={hx(Math.min(0, v))}
                      y={top + (i / count) * (bottom - top) + 4}
                      width={(Math.abs(v) / span) * (right - left)}
                      height={Math.max(1, (bottom - top) / count - 8)}
                      rx="2"
                    >
                      <PointTitle label={tooltip(i, s)} />
                    </rect>
                  );
                const binWidth = (right - left) / count;
                const width =
                  type === "histogram"
                    ? nx(spec.binEnds![i]) - x(i)
                    : (binWidth * 0.78) / (stacked ? 1 : seriesCount);
                const offset = stacked
                  ? spec.series.slice(0, si).reduce((sum, previous) => {
                      const n = previous.values[i] ?? 0;
                      return sum + (Math.sign(n) === Math.sign(v) ? n : 0);
                    }, 0)
                  : 0;
                // A missing component makes a stack incomplete: do not draw a misleading total.
                if (stacked && spec.series.some((s) => s.values[i] === null))
                  return null;
                return (
                  <rect
                    data-chart-mark
                    key={i}
                    x={
                      type === "histogram"
                        ? x(i)
                        : x(i) - binWidth * 0.39 + (stacked ? 0 : si * width)
                    }
                    y={y(Math.max(offset, offset + v))}
                    width={Math.max(0, width - (type === "histogram" ? 1 : 2))}
                    height={(Math.abs(v) / span) * (bottom - top)}
                    rx="1"
                  >
                    <PointTitle label={tooltip(i, s)} />
                  </rect>
                );
              })}
            </g>
          );
        })}
      </g>
      {showBarValues
        ? spec.series[0].values.map((value, i) =>
            value === null ? null : (
              <text
                key={i}
                className="chart-label"
                data-chart-value
                x={width - 8}
                y={top + ((i + 0.5) / count) * (bottom - top) + 4}
                textAnchor="end"
              >
                {number(value)}
              </text>
            ),
          )
        : null}
      {spec.labels.map((label, i) =>
        i % Math.max(1, Math.ceil(count / (horizontal ? 8 : 6))) === 0 ||
        i === count - 1 ? (
          <text
            key={i}
            className="chart-label"
            x={horizontal ? left - 8 : x(i)}
            y={
              horizontal
                ? top + ((i + 0.5) / count) * (bottom - top) + 4
                : bottom + 22
            }
            textAnchor={
              horizontal || (numericX && i === count - 1)
                ? "end"
                : numericX && i === 0
                  ? "start"
                  : "middle"
            }
          >
            {String(label).slice(
              0,
              horizontal ? Math.floor((left - 16) / 7) : 14,
            )}
            <title>{String(label)}</title>
          </text>
        ) : null,
      )}
      {type === "histogram" ? (
        <text
          className="chart-label"
          x={right}
          y={bottom + 22}
          textAnchor="end"
        >
          {number(spec.binEnds!.at(-1)!)}
        </text>
      ) : null}
      <text
        className="chart-label"
        x={width / 2}
        y={height - 9}
        textAnchor="middle"
      >
        {spec.dimension.label.length > Math.floor(width / 8)
          ? `${spec.dimension.label.slice(0, Math.floor(width / 8) - 1)}…`
          : spec.dimension.label}
        {spec.dimension.unit ? ` (${spec.dimension.unit})` : ""}
      </text>
    </>
  );
}
function RadialPlot({ spec, type, number }: PlotProps) {
  const values = spec.series[0].values as readonly number[];
  const total = values.reduce((a, b) => a + b, 0);
  let angle = -Math.PI / 2;
  const radius = 104;
  const cx = 320;
  const cy = 140;
  return (
    <>
      {values.map((v, i) => {
        const start = angle;
        angle += (v / total) * Math.PI * 2;
        const path = `M ${cx} ${cy} L ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${v / total > 0.5 ? 1 : 0} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z`;
        const title = `${spec.labels[i]}: ${number(v)} ${spec.series[0].unit} (${number((v / total) * 100)}%)`;
        return v === total ? (
          <circle
            data-chart-mark
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill={color(i)}
          >
            <PointTitle label={title} />
          </circle>
        ) : v > 0 ? (
          <path
            data-chart-mark
            key={i}
            d={path}
            fill={color(i)}
            stroke="var(--surface)"
            strokeWidth="2"
          >
            <PointTitle label={title} />
          </path>
        ) : null;
      })}
      {type === "donut" ? (
        <>
          <circle cx={cx} cy={cy} r="64" fill="var(--surface)" />
          <text x={cx} y={cy + 4} textAnchor="middle" className="chart-total">
            {number(total)}
          </text>
        </>
      ) : null}
    </>
  );
}
function MatrixPlot({ spec, number, width, height }: PlotProps) {
  const values = spec.series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = (width - 124) / spec.labels.length;
  const h = (height - 90) / spec.series.length;
  return (
    <>
      {spec.series.map((s, row) => (
        <g key={s.id}>
          <text
            className="chart-label"
            x="96"
            y={30 + (row + 0.5) * h}
            textAnchor="end"
          >
            {s.label.slice(0, 12)}
          </text>
          {s.values.map((v, col) => (
            <g key={col}>
              <rect
                data-chart-mark
                x={100 + col * w}
                y={20 + row * h}
                width={Math.max(0, w - 2)}
                height={Math.max(0, h - 2)}
                fill={v === null ? "var(--surface)" : color(0)}
                opacity={
                  v === null ? 1 : 0.2 + (0.8 * (v - min)) / (max - min || 1)
                }
                stroke={v === null ? "var(--text-muted)" : undefined}
              >
                <PointTitle
                  label={`${spec.labels[col]} · ${s.label}: ${number(v)} ${s.unit}`}
                />
              </rect>
              {w >= 38 && h >= 22 ? (
                <text
                  x={100 + (col + 0.5) * w}
                  y={24 + (row + 0.5) * h}
                  textAnchor="middle"
                  className="chart-cell-value"
                >
                  {number(v)}
                </text>
              ) : null}
            </g>
          ))}
        </g>
      ))}
      {spec.labels.map((v, i) => (
        <text
          key={i}
          x={100 + (i + 0.5) * w}
          y={height - 46}
          textAnchor="middle"
          className="chart-label"
        >
          {String(v).slice(0, 10)}
        </text>
      ))}
      <text
        x={width / 2}
        y={height - 12}
        textAnchor="middle"
        className="chart-label"
      >
        {spec.dimension.label} · {number(min)} – {number(max)}{" "}
        {spec.series[0].unit}
      </text>
    </>
  );
}
const renderers = {
  cartesian: CartesianPlot,
  radial: RadialPlot,
  matrix: MatrixPlot,
};

export type ChartPresentation = "compact" | "reading" | "expanded";

/** One SVG engine, including the same mounted chart when portalled into expanded mode. */
export function ChartRenderer({
  spec: raw,
  scope,
  presentation = "reading",
  sourceDetails,
}: {
  spec: ChartSpec;
  scope: string;
  presentation?: ChartPresentation;
  sourceDetails?: ReactNode;
}) {
  const { t } = useTranslation("reports");
  const { preferences, reducedMotion } = usePreferences();
  const [selection, setSelection] = useState<string>();
  const [tableOpen, setTableOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState("");
  const activeIndex = useRef(-1);
  const panel = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const feedback = useRef<ReturnType<typeof gsap.quickTo> | null>(null);
  const activeMark = useRef<SVGElement | null>(null);
  const panelId = useId();
  const workspace = useChartExpansion();
  const expanded = workspace?.expandedId === panelId;
  const variant = expanded ? "expanded" : presentation;
  const [measuredWidth, setMeasuredWidth] = useState(640);
  const spec = useMemo(() => orderChart(raw), [raw]);
  const resolved = useMemo(() => resolveChart(spec), [spec]);
  const type =
    selection && resolved.compatible.includes(selection as ChartType)
      ? (selection as ChartType)
      : resolved.type;
  const radial = type === "pie" || type === "donut";
  const width = Math.max(
    420,
    Math.min(variant === "reading" ? 900 : Infinity, measuredWidth),
  );
  const height =
    variant === "expanded"
      ? 420
      : variant === "compact"
        ? type === "bar"
          ? Math.max(180, Math.min(520, spec.labels.length * 22 + 56))
          : 180
        : 300;
  const number = (v: number | null) =>
    v === null
      ? "—"
      : formatNumber(v, preferences.locale, { maximumFractionDigits: 2 });
  const Plot = type ? renderers[chartRegistry[type].family] : undefined;
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const value = Math.floor(entries[0]?.contentRect.width ?? 640);
      if (value > 0) setMeasuredWidth(value);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, type]);
  useEffect(() => {
    if (expanded || wasExpanded.current)
      expandButton.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);

  const { contextSafe } = useGSAP(
    () => {
      const element = plot.current;
      if (!element || !analyticalMotionAllowed(reducedMotion) || !type) return;
      const feedbackElement = panel.current?.querySelector(
        ".chart-value-feedback",
      );
      if (feedbackElement)
        feedback.current = gsap.quickTo(feedbackElement, "opacity", {
          duration: analyticalMotion.feedback,
          ease: analyticalMotion.ease,
        });
      const box = element.getBoundingClientRect();
      // Large/offscreen data gets a single bounded wrapper fade, never thousands of tweens.
      if (!box.width || box.top > innerHeight || box.bottom < 0) return;
      const timeline = gsap.timeline({
        defaults: {
          duration: analyticalMotion.chart,
          ease: analyticalMotion.ease,
        },
      });
      if (type === "line" || type === "area") {
        const lines = [
          ...element.querySelectorAll<SVGGeometryElement>("[data-chart-line]"),
        ];
        for (const line of lines) {
          const length = line.getTotalLength?.() ?? 0;
          if (length)
            timeline.fromTo(
              line,
              { strokeDasharray: length, strokeDashoffset: length },
              {
                strokeDashoffset: 0,
                clearProps: "strokeDasharray,strokeDashoffset",
              },
              0,
            );
        }
        const areas = element.querySelectorAll("[data-chart-area]");
        if (areas.length)
          timeline.fromTo(
            areas,
            { opacity: 0.03 },
            { opacity: 0.13, clearProps: "opacity" },
            0,
          );
      } else if (
        ["bar", "column", "grouped-bar", "stacked-bar", "histogram"].includes(
          type,
        )
      ) {
        const clip = element.querySelector<SVGRectElement>("[data-chart-clip]");
        if (clip) {
          const axis = clip.dataset.axis === "x" ? "scaleX" : "scaleY";
          timeline.fromTo(
            clip,
            { [axis]: 0, svgOrigin: clip.dataset.baseline },
            { [axis]: 1, clearProps: "transform" },
            0,
          );
        }
      } else {
        timeline.fromTo(
          element,
          { opacity: 0.4 },
          { opacity: 1, clearProps: "opacity" },
          0,
        );
      }
      // This nonpersistent marker also lets browser tests observe real, enabled motion.
      const owner = panel.current;
      if (owner) {
        owner.dataset.animating = "true";
        timeline.eventCallback("onComplete", () => {
          delete owner.dataset.animating;
        });
      }
      return () => {
        feedback.current = null;
        if (panel.current) delete panel.current.dataset.animating;
      };
    },
    {
      scope: panel,
      dependencies: [spec, type, expanded, reducedMotion, width, height],
      revertOnUpdate: true,
    },
  );

  const highlight = contextSafe((mark: SVGElement | null) => {
    if (!mark) return;
    const label = mark.querySelector("title")?.textContent ?? "";
    if (activeMark.current) delete activeMark.current.dataset.active;
    mark.dataset.active = "true";
    activeMark.current = mark;
    setActiveLabel(label);
    if (!reducedMotion) feedback.current?.(1, 0.65);
  });
  function clearHighlight() {
    if (activeMark.current) delete activeMark.current.dataset.active;
    activeMark.current = null;
    setActiveLabel("");
  }
  function pointer(event: PointerEvent<HTMLDivElement>) {
    const target =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-chart-mark]")
        : null;
    if (target && target.querySelector("title")?.textContent !== activeLabel)
      highlight(target);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes(
        event.key,
      )
    )
      return;
    if (event.key === "Escape") {
      clearHighlight();
      return;
    }
    const marks =
      plot.current?.querySelectorAll<SVGElement>("[data-chart-mark]");
    if (!marks?.length) return;
    // Preserve native horizontal scrolling on constrained screens.
    if (plot.current && plot.current.scrollWidth > plot.current.clientWidth + 1)
      return;
    event.preventDefault();
    activeIndex.current =
      (activeIndex.current +
        (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
        marks.length) %
      marks.length;
    highlight(marks[activeIndex.current]);
  }
  const matrixValues =
    type === "heatmap"
      ? spec.series
          .flatMap((s) => s.values)
          .filter((v): v is number => v !== null)
      : [];
  const legend = radial
    ? spec.labels.map((label, i) => ({
        id: String(i),
        label: `${label}: ${number(spec.series[0].values[i])}`,
        unit: spec.series[0].unit,
      }))
    : type === "heatmap"
      ? [
          {
            id: "intensity",
            label: t("chartIntensity"),
            unit: `${number(Math.min(...matrixValues))} – ${number(Math.max(...matrixValues))} ${spec.series[0].unit}`,
          },
        ]
      : spec.series;
  const content = (
    <div
      ref={panel}
      className={`analytical-chart chart-${variant}`}
      data-chart-id={spec.id}
      data-expanded={expanded || undefined}
    >
      <ChartFrame
        title={spec.title}
        unit={[...new Set(spec.series.map((s) => s.unit))].join(", ")}
        scope={scope}
        summary={spec.description ?? ""}
        actions={
          <div className="chart-toolbar">
            {resolved.compatible.length > 1 ? (
              <label className="chart-switcher">
                <span>{t("chartPresentation")}</span>
                <select
                  aria-label={`${t("chartPresentation")}: ${spec.title}`}
                  value={type}
                  onChange={(e) => {
                    setSelection(e.target.value);
                    setActiveLabel("");
                    activeIndex.current = -1;
                  }}
                >
                  {resolved.compatible.map((value) => (
                    <option key={value} value={value}>
                      {t(`chartType-${value}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span />
            )}
            {workspace ? (
              <Button
                ref={expandButton}
                variant="ghost"
                onClick={() => workspace.expand(expanded ? null : panelId)}
                aria-expanded={expanded}
                aria-label={`${t(expanded ? "collapseChart" : "expandChart")}: ${spec.title}`}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                <span>{t(expanded ? "collapseChart" : "expandChart")}</span>
              </Button>
            ) : null}
          </div>
        }
      >
        {Plot && type ? (
          <div
            ref={plot}
            className="schema-chart-scroll"
            role="region"
            aria-label={spec.title}
            aria-describedby={`${panelId}-hint`}
            tabIndex={0}
            onPointerMove={pointer}
            onPointerLeave={clearHighlight}
            onKeyDown={keyboard}
            onBlur={clearHighlight}
          >
            <svg
              key={type}
              className={`schema-chart${radial ? " schema-chart-radial" : ""}`}
              viewBox={radial ? "180 0 280 280" : `0 0 ${width} ${height}`}
              style={{
                height: radial ? (variant === "expanded" ? 360 : 180) : height,
              }}
              role="img"
              aria-label={`${spec.title} · ${t(`chartType-${type}`)}`}
            >
              <Plot
                spec={spec}
                type={type}
                number={number}
                width={width}
                height={height}
              />
            </svg>
            <div
              className="chart-value-feedback"
              role="status"
              aria-live="polite"
            >
              {activeLabel}
            </div>
          </div>
        ) : (
          <p role="status">
            {t(resolved.issue === "empty" ? "noChartData" : "chartFallback")}
          </p>
        )}
        <p id={`${panelId}-hint`} className="sr-only">
          {t("chartKeyboard")}
        </p>
        {legend.length === 1 && legend[0].label === spec.title ? null : (
          <ul className="chart-legend" aria-label={t("legend")}>
            {legend.map((s, i) => (
              <li key={s.id}>
                <i style={{ background: color(i) }} aria-hidden="true" />
                {s.label} · {s.unit}
              </li>
            ))}
          </ul>
        )}
        <details
          className="report-chart-table"
          open={!type || tableOpen}
          onToggle={(e) => setTableOpen(e.currentTarget.open)}
        >
          <summary>{t("chartTable")}</summary>
          {!type || tableOpen ? (
            <PagedDataTable
              key={`${raw.id}:${variant}`}
              pageSize={variant === "compact" ? 25 : 100}
              caption={`${spec.title} · ${[...new Set(spec.series.map((s) => s.unit))].join(", ")}`}
              columns={[
                spec.dimension.label,
                ...(spec.binEnds ? [t("binEnd")] : []),
                ...spec.series.map((s) => `${s.label} (${s.unit})`),
              ]}
              rows={spec.labels.map((label, i) => [
                label,
                ...(spec.binEnds ? [spec.binEnds[i]] : []),
                ...spec.series.map((s) => s.values[i] ?? null),
              ])}
            />
          ) : null}
        </details>
        <details className="report-chart-source">
          <summary>{t(sourceDetails ? "chartSources" : "source")}</summary>
          <p>
            {spec.sourceId} · {t("missingChartValues")}
          </p>
          {spec.description ? <p>{spec.description}</p> : null}
          {sourceDetails}
        </details>
      </ChartFrame>
    </div>
  );
  return expanded && workspace?.target
    ? createPortal(content, workspace.target)
    : content;
}
