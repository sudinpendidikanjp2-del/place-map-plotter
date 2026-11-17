import { useMemo, useState } from "react";
import { cn } from "../lib/cn.ts";
import { formatNumber } from "../lib/format.ts";
import { Icon } from "./icons.tsx";
import { Button, Dialog, Input } from "./primitives.tsx";

export interface MultiOption {
  value: string;
  count?: number;
}

const SHOWN = 300;

/**
 * Pilihan ganda dengan daftar bercentang di dalam dialog. Cocok di ponsel karena tidak memakai menu bawaan yang kecil,
 * dan daftar panjang (ratusan kecamatan) bisa dicari.
 */
export function MultiSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  placeholder: string;
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = useMemo(() => new Set(value), [value]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => o.value.toLowerCase().includes(t)) : options;
    return list.slice(0, SHOWN);
  }, [options, q]);

  const summary = value.length === 0 ? placeholder : value.length === 1 ? value[0]! : `${value[0]} +${value.length - 1}`;

  function toggle(v: string) {
    onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  function close() {
    setOpen(false);
    setQ("");
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${value.length ? value.join(", ") : "semua"}`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 text-left text-sm disabled:opacity-60",
          value.length === 0 && "text-ink-2",
          value.length > 0 && "border-primary text-ink",
          className,
        )}
      >
        <span className="truncate">{summary}</span>
        <Icon name="chevron" size={16} />
      </button>

      <Dialog open={open} onClose={close} title={label} sheet>
        <div className="flex flex-col gap-3">
          <Input aria-label={`Cari ${label.toLowerCase()}`} placeholder={`Cari ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
            <span>{value.length ? `${value.length} dipilih` : "Belum ada yang dipilih (semua)"}</span>
            {value.length > 0 && (
              <button type="button" className="font-medium text-ink underline" onClick={() => onChange([])}>
                Kosongkan
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="py-4 text-center text-ink-2">Tidak ada yang cocok.</p>
          ) : (
            <ul className="-mx-2 max-h-[45dvh] overflow-y-auto" role="group" aria-label={label}>
              {shown.map((o) => (
                <li key={o.value}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-surface-2">
                    <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} className="size-5 shrink-0 accent-[var(--navy)]" />
                    <span className="min-w-0 flex-1 break-words">{o.value}</span>
                    {o.count !== undefined && <span className="num text-[13px] text-ink-2">{formatNumber(o.count)}</span>}
                  </label>
                </li>
              ))}
              {options.length > shown.length && !q && <li className="px-2 py-2 text-[13px] text-ink-2">Menampilkan {SHOWN} pertama. Ketik untuk mencari.</li>}
            </ul>
          )}
          <Button variant="primary" onClick={close}>
            Selesai
          </Button>
        </div>
      </Dialog>
    </>
  );
}
