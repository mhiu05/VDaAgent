import type { ComponentProps } from "react";
export interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  pending?: boolean;
}
export function Button({
  variant = "secondary",
  pending,
  disabled,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`button button-${variant} ${className}`}
    />
  );
}
export function IconButton({
  label,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      {...props}
      aria-label={label}
      title={label}
      className={`icon-button ${props.className ?? ""}`}
      variant={props.variant ?? "ghost"}
    />
  );
}
