import { useEffect, useRef, useState } from "react";
import type { Location } from "@peta/domain";
import { api } from "../../data/api.ts";
import { useRouter } from "../../app/router.tsx";
import { useDebounced } from "../../shared/lib/hooks.ts";
import { Dialog, Input, Spinner } from "../../shared/ui/primitives.tsx";
import { KindBadge } from "../locations/kind.tsx";

export function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const [results, setResults] = useState<Location[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (dq.length < 2) {
      setResults(null);
      setState("idle");
      return;
    }
    const ctl = new AbortController();
    setState("loading");
    api.list({ q: dq }, { sort: "nama", limit: 8 }, ctl.signal).then(
      (r) => {
        setResults(r.items);
        setState("idle");
      },
      () => !ctl.signal.aborted && setState("error"),
    );
    return () => ctl.abort();
  }, [dq]);

  function go(l: Location) {
    onClose();
    navigate(`/?lokasi=${l.id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[Math.min(i + 1, buttons.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) (document.getElementById("cari-input") as HTMLInputElement | null)?.focus();
      else buttons[i - 1]?.focus();
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Cari lokasi">
      <div onKeyDown={onKey} className="flex flex-col gap-3">
        <div className="relative">
          <Input
            id="cari-input"
            autoFocus
            placeholder="Ketik nama atau alamat, minimal 2 huruf"
            aria-label="Kata kunci"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results?.[0]) go(results[0]);
            }}
          />
          {state === "loading" && <Spinner className="absolute right-3 top-3" />}
        </div>
        {state === "error" && (
          <p role="alert" className="text-danger">
            Pencarian gagal. Coba lagi.
          </p>
        )}
        {results && results.length === 0 && state !== "loading" && <p className="py-4 text-center text-ink-2">Tidak ada hasil untuk &ldquo;{dq}&rdquo;.</p>}
        {results && results.length > 0 && (
          <ul ref={list} className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
            {results.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => go(l)} className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2">
                  <KindBadge kind={l.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="block truncate text-[13px] text-ink-2">{l.address ?? l.category}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!results && state === "idle" && <p className="text-ink-2">Hasil mengarah ke peta dan membuka detail lokasi.</p>}
      </div>
    </Dialog>
  );
}
