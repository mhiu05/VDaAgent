import * as D from "@radix-ui/react-dialog";
import * as T from "@radix-ui/react-tooltip";
import * as M from "@radix-ui/react-dropdown-menu";
import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { IconButton } from "../button";
export interface OverlayProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  triggerRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  className?: string;
  headerActions?: ReactNode;
  onEscapeKeyDown?(event: KeyboardEvent): void;
}
export function OverlayPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  triggerRef,
  closeLabel = "Close",
  className = "",
  headerActions,
  onEscapeKeyDown,
  side,
}: OverlayProps & { side?: "left" | "right" }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="overlay-scrim" />
        <D.Content
          onEscapeKeyDown={onEscapeKeyDown}
          className={`overlay-panel ${side ? `drawer drawer-${side}` : ""} ${className}`}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Radix restores focus after unmount. Do not steal focus if the
            // user has already moved to another control during that interval.
            const active = document.activeElement;
            if (
              active instanceof HTMLElement &&
              active !== document.body &&
              !active.closest('[role="dialog"]')
            )
              return;
            if (
              triggerRef?.current?.isConnected &&
              triggerRef.current.getClientRects().length
            ) {
              triggerRef.current.focus();
            } else {
              const fallback = document.querySelector<HTMLElement>(
                "main h1, #main-content",
              );
              if (fallback) {
                fallback.focus();
              }
            }
          }}
        >
          <div className="overlay-heading">
            <D.Title>{title}</D.Title>
            {headerActions}
            <D.Close asChild>
              <IconButton label={closeLabel}>
                <X size={18} />
              </IconButton>
            </D.Close>
          </div>
          <D.Description className={description ? "muted" : "sr-only"}>
            {description ?? title}
          </D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
export const Dialog = OverlayPanel;
export function Drawer(props: OverlayProps & { side?: "left" | "right" }) {
  return <OverlayPanel {...props} side={props.side ?? "right"} />;
}
export function Tooltip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content className="tooltip" sideOffset={6}>
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
export function Menu({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: { label: string; onSelect(): void; disabled?: boolean }[];
}) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content className="menu-content" align="end">
          {items.map((i) => (
            <M.Item
              className="menu-item"
              key={i.label}
              onSelect={i.onSelect}
              disabled={i.disabled}
            >
              {i.label}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
