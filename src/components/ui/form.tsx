"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  JALALI_MONTH_NAMES,
} from "@/lib/jalali";

const CONTROL =
  "w-full rounded-md border bg-surface px-3.5 text-fg transition-colors duration-200 placeholder:text-fg-muted/70 focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20 disabled:opacity-60";

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
}

function useFieldIds(id?: string) {
  const generated = useId();
  const base = id ?? generated;
  return { inputId: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

function FieldMessage({ hintId, errorId, hint, error }: { hintId: string; errorId: string; hint?: string; error?: string }) {
  if (error) return <p id={errorId} className="text-sm text-danger">{error}</p>;
  if (hint) return <p id={hintId} className="text-xs text-fg-muted">{hint}</p>;
  return null;
}

export function Input({ label, hint, error, id, className, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const ids = useFieldIds(id);
  return (
    <div className="grid gap-1.5">
      {label ? <label htmlFor={ids.inputId} className="text-sm font-medium text-fg">{label}</label> : null}
      <input
        id={ids.inputId}
        aria-invalid={!!error}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        className={cn(CONTROL, "h-11", error ? "border-danger" : "border-border-strong", className)}
        {...props}
      />
      <FieldMessage hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
    </div>
  );
}

export function Textarea({ label, hint, error, id, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const ids = useFieldIds(id);
  return (
    <div className="grid gap-1.5">
      {label ? <label htmlFor={ids.inputId} className="text-sm font-medium text-fg">{label}</label> : null}
      <textarea
        id={ids.inputId}
        aria-invalid={!!error}
        className={cn(CONTROL, "min-h-24 py-2.5", error ? "border-danger" : "border-border-strong", className)}
        {...props}
      />
      <FieldMessage hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { children: ReactNode }) {
  const ids = useFieldIds(id);
  return (
    <div className="grid gap-1.5">
      {label ? <label htmlFor={ids.inputId} className="text-sm font-medium text-fg">{label}</label> : null}
      <select
        id={ids.inputId}
        aria-invalid={!!error}
        className={cn(CONTROL, "h-11", error ? "border-danger" : "border-border-strong", className)}
        {...props}
      >
        {children}
      </select>
      <FieldMessage hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
    </div>
  );
}

export function Checkbox({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-fg", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" className="size-[1.15rem] cursor-pointer accent-primary" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-60",
        checked ? "bg-success" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all duration-300",
          checked ? "start-[calc(100%-1.75rem)]" : "start-0.5",
        )}
      />
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,36rem)] max-h-[90vh] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-lift backdrop:bg-navy-900/50 open:animate-pop"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="بستن"
          className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-6 py-5">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
    </dialog>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 start-1/2 z-[var(--z-dropdown)] -translate-x-1/2 whitespace-nowrap rounded-md bg-surface-inverse px-2.5 py-1 text-xs text-fg-inverse opacity-0 shadow-soft transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Three-select Jalali picker. Emits and accepts ISO Gregorian dates (yyyy-mm-dd). */
export function JalaliDatePicker({
  label,
  value,
  onChange,
  hint,
  error,
  name,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  hint?: string;
  error?: string;
  name?: string;
}) {
  const today = gregorianToJalali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
  const current = (() => {
    const [gy, gm, gd] = value.split("-").map(Number);
    if (!gy || !gm || !gd) return { jy: today.jy, jm: today.jm, jd: today.jd };
    return gregorianToJalali(gy, gm, gd);
  })();
  const [jy, setJy] = useState(current.jy);
  const [jm, setJm] = useState(current.jm);
  const [jd, setJd] = useState(current.jd);
  const monthLength = jalaliMonthLength(jy, jm);
  const safeJd = Math.min(jd, monthLength);

  const commit = (y: number, m: number, d: number) => {
    const len = jalaliMonthLength(y, m);
    const day = Math.min(d, len);
    setJy(y);
    setJm(m);
    setJd(day);
    const g = jalaliToGregorian(y, m, day);
    onChange(`${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`);
  };

  const years = Array.from({ length: 11 }, (_, i) => today.jy - 5 + i);
  const ids = useFieldIds(name);
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-medium text-fg">{label}</legend>
      <div className="grid grid-cols-3 gap-2" aria-describedby={error ? ids.errorId : undefined}>
        <select aria-label="روز" className={cn(CONTROL, "h-11 border-border-strong")} value={safeJd} onChange={(e) => commit(jy, jm, Number(e.target.value))}>
          {Array.from({ length: monthLength }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d.toLocaleString("fa-IR")}</option>
          ))}
        </select>
        <select aria-label="ماه" className={cn(CONTROL, "h-11 border-border-strong")} value={jm} onChange={(e) => commit(jy, Number(e.target.value), safeJd)}>
          {JALALI_MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>{name}</option>
          ))}
        </select>
        <select aria-label="سال" className={cn(CONTROL, "h-11 border-border-strong")} value={jy} onChange={(e) => commit(Number(e.target.value), jm, safeJd)}>
          {years.map((y) => (
            <option key={y} value={y}>{y.toLocaleString("fa-IR")}</option>
          ))}
        </select>
      </div>
      {error ? <p id={ids.errorId} className="text-sm text-danger">{error}</p> : hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </fieldset>
  );
}

export function FileUpload({ label, hint, buttonLabel }: { label: string; hint: string; buttonLabel: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <div className="grid gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-2/60 p-6 text-center transition-colors hover:border-primary">
      <p className="font-medium text-fg">{label}</p>
      <p className="text-sm text-fg-muted">{hint}</p>
      <label className="mx-auto mt-1 cursor-pointer rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2">
        {buttonLabel}
        <input type="file" className="sr-only" accept="application/pdf,image/*" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
      </label>
      {fileName ? <p className="text-xs text-fg-muted">{fileName}</p> : null}
    </div>
  );
}
