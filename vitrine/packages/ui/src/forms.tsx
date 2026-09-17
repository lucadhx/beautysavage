// RX3 — Primitives de formulaire partagées (dette RC1 « extraire FormField/Input/Checkbox »).
// Tokens --bs-* uniquement, focus visible (polish.css), cibles ≥44px, a11y (label lié, aria-invalid/describedby).
import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export interface FormFieldProps {
  label: string;
  /** id du contrôle enfant (sinon généré et à câbler via render-prop `children`). */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/** Enveloppe label + contrôle + aide/erreur. */
export function FormField({ label, htmlFor, hint, error, required, children }: FormFieldProps) {
  return (
    <div className={['bs-field', error ? 'bs-field--error' : ''].filter(Boolean).join(' ')}>
      <label className="bs-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="bs-field__req" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="bs-field__hint">{hint}</p> : null}
      {error ? (
        <p className="bs-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className = '', invalid, ...rest },
  ref,
) {
  return (
    <input ref={ref} className={['bs-input', className].filter(Boolean).join(' ')} aria-invalid={invalid || undefined} {...rest} />
  );
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className = '', invalid, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={['bs-input', 'bs-input--area', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={['bs-input', 'bs-input--select', className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** Case à cocher avec libellé cliquable (cible ≥44px). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className = '', id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label className={['bs-check', className].filter(Boolean).join(' ')} htmlFor={inputId}>
      <input ref={ref} id={inputId} type="checkbox" className="bs-check__input" {...rest} />
      <span className="bs-check__label">{label}</span>
    </label>
  );
});

export default { FormField, TextInput, TextArea, Select, Checkbox };
