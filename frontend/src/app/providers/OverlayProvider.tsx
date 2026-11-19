import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Drawer } from "../../shared/ui/overlay";
import { useTranslation } from "react-i18next";
type Panel = {
  id: "system" | "agents" | "inspector" | "feature-dialog";
  title: string;
  content: ReactNode;
  side?: "left" | "right";
  triggerRef?: RefObject<HTMLElement | null>;
};
const Context = createContext<{ open(panel: Panel): void; close(): void }>({
  open() {},
  close() {},
});
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const lastTrigger = useRef<RefObject<HTMLElement | null> | undefined>(
    undefined,
  );
  const { t } = useTranslation();
  useEffect(() => {
    const resize = () => setPanel(null);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <Context.Provider
      value={{
        open: (next) => {
          lastTrigger.current = next.triggerRef ?? {
            current: document.activeElement as HTMLElement,
          };
          setPanel(next);
        },
        close: () => setPanel(null),
      }}
    >
      {children}
      <Drawer
        open={!!panel}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        title={panel?.title ?? ""}
        side={panel?.side}
        triggerRef={lastTrigger.current}
        closeLabel={t("close")}
      >
        {panel?.content}
      </Drawer>
    </Context.Provider>
  );
}
export const useOverlay = () => useContext(Context);
