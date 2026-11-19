import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

const Context = createContext<{
  expandedId: string | null;
  expand(id: string | null): void;
  target: HTMLDivElement | null;
} | null>(null);

/** Moves the existing panel into this viewer's own content slot, never another dialog. */
export function ChartExpansion({
  children,
  scrollSelector = ".report-viewer-scroll",
}: {
  children: ReactNode;
  scrollSelector?: string;
}) {
  const [expandedId, expand] = useState<string | null>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const originScroll = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  function change(id: string | null) {
    const scroll = root.current?.closest(scrollSelector);
    if (id && scroll) {
      originScroll.current = scroll.scrollTop;
      scroll.scrollTop =
        scrollSelector === ".report-viewer-scroll"
          ? 0
          : scroll.scrollTop +
            root.current!.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top;
    }
    expand(id);
    if (!id && scroll)
      requestAnimationFrame(() => {
        if (scroll.isConnected) scroll.scrollTop = originScroll.current;
      });
  }
  return (
    <Context.Provider value={{ expandedId, expand: change, target }}>
      <div
        ref={root}
        className="chart-workspace"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && expandedId) {
            event.preventDefault();
            event.stopPropagation();
            change(null);
          }
        }}
      >
        <div hidden={!!expandedId} inert={!!expandedId}>
          {children}
        </div>
        <div
          ref={setTarget}
          className="report-expanded-slot"
          hidden={!expandedId}
        />
      </div>
    </Context.Provider>
  );
}

export const useChartExpansion = () => useContext(Context);
