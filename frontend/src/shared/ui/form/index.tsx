import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}
export function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {description && (
        <p id={`${id}-description`} className="field-description">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function Switch({
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className="switch">
      <span>{label}</span>
      <input {...props} type="checkbox" role="switch" />
    </label>
  );
}
