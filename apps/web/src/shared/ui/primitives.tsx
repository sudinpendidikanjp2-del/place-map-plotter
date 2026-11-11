import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";
import { Icon, type IconName } from "./icons.tsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-on-danger hover:brightness-95",
};

export function Button({
  variant = "secondary",
  icon,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; busy?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-sm font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** Tombol hanya berisi ikon. `label` wajib agar punya nama yang bisa dibaca pembaca layar. */
export function IconButton({
  icon,
  label,
  pressed,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: IconName; label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink transition-colors duration-150 hover:bg-surface-2",
        pressed && "bg-primary text-on-primary hover:bg-primary",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Memuat"
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children({ id, ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true } : {}) })}
      {error ? (
        <p id={`${id}-err`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "min-h-10 min-w-0 rounded-control border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-2 aria-[invalid=true]:border-danger disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, "min-h-24 py-2", className)} {...rest} />;
}

/** Dialog memakai elemen <dialog> bawaan: fokus terkunci, Escape menutup, latar belakang tidak aktif. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-hidden rounded-float border border-line bg-surface p-0 shadow-float",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <IconButton icon="close" label="Tutup" onClick={onClose} />
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <p className="max-w-sm text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon name="alert" />
      </span>
      <div>
        <p className="font-semibold">Data belum bisa dimuat</p>
        <p className="mt-1 max-w-sm text-ink-2">{error.message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} icon="undo">
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label="Memuat data">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children, count }: { active?: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
        active ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:bg-surface-2",
      )}
    >
      {children}
      {count !== undefined && <span className="num opacity-70">{count}</span>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{children}</kbd>;
}

/** Tautan yang tampil seperti tombol sekunder, untuk unduhan. */
export function DownloadLink({ href, children, icon }: { href: string; children: ReactNode; icon?: IconName }) {
  return (
    <a href={href} download className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line bg-surface px-4 text-sm font-medium transition-colors duration-150 hover:bg-surface-2">
      {icon && <Icon name={icon} />}
      {children}
    </a>
  );
}
