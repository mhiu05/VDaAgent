'use client';

import {
  type ButtonHTMLAttributes,
  type DialogHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';
import { workflowStatusLabel } from '../../lib/format/status-label';

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

const buttonClasses: Record<ButtonVariant, string> = {
  primary: 'primary',
  secondary: 'secondary',
  text: 'text-button',
  danger: 'secondary danger',
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={[buttonClasses[variant], className].filter(Boolean).join(' ')}
      type={type}
    />
  );
}

export function IconButton({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button {...props} className={['icon-button', className].filter(Boolean).join(' ')} type={type} />
  );
}

export function Badge({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={['badge', className].filter(Boolean).join(' ')}>{children}</span>;
}

export function Status({
  state,
  children,
  className = '',
}: {
  state: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={['status', `status-${state}`, className].filter(Boolean).join(' ')} data-status={state}>
      {children ?? workflowStatusLabel(state)}
    </span>
  );
}

export function Alert({
  children,
  variant = 'info',
  className = '',
}: {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'error';
  className?: string;
}) {
  const classForVariant = {
    info: 'notice',
    success: 'notice success',
    warning: 'notice',
    error: 'error-box',
  }[variant];
  return (
    <div
      className={['ui-alert', classForVariant, className].filter(Boolean).join(' ')}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={['card', className].filter(Boolean).join(' ')}>
      {children}
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined })}
      {hint && <span className="ui-field-hint" id={hintId}>{hint}</span>}
      {error && <span className="ui-field-error" id={errorId}>{error}</span>}
    </div>
  );
}

type FieldPresentation = {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({
  label,
  hint,
  error,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby' | 'aria-invalid'> &
  FieldPresentation) {
  return (
    <Field label={label} hint={hint} error={error} required={props.required}>
      {(control) => <input {...props} {...control} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'aria-describedby' | 'aria-invalid'> &
  FieldPresentation) {
  return (
    <Field label={label} hint={hint} error={error} required={props.required}>
      {(control) => <select {...props} {...control}>{children}</select>}
    </Field>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'aria-describedby' | 'aria-invalid'> &
  FieldPresentation) {
  return (
    <Field label={label} hint={hint} error={error} required={props.required}>
      {(control) => <textarea {...props} {...control} />}
    </Field>
  );
}

export function Skeleton({
  className = '',
  width,
}: {
  className?: string;
  width?: string;
}) {
  return <span className={['ui-skeleton', className].filter(Boolean).join(' ')} style={{ width }} aria-hidden="true" />;
}

export function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  return (
    <span className="ui-tooltip" aria-describedby={id}>
      {children}
      <span className="ui-tooltip-content" id={id} role="tooltip">{label}</span>
    </span>
  );
}

type ManagedDialogProps = Omit<
  DialogHTMLAttributes<HTMLDialogElement>,
  'open' | 'onClose' | 'onCancel'
> & {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ open, onClose, children, className = '', ...props }: ManagedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      {...props}
      ref={dialogRef}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      {children}
    </dialog>
  );
}

export function Drawer({ className = '', ...props }: ManagedDialogProps) {
  return <Dialog {...props} className={['ui-drawer', className].filter(Boolean).join(' ')} />;
}
