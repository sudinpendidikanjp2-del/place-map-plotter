import { useCallback, useEffect, useRef, useState } from "react";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type Resource<T> =
  | { status: "loading"; data: T | null; error: null; reload: () => void }
  | { status: "ready"; data: T; error: null; reload: () => void }
  | { status: "error"; data: T | null; error: Error; reload: () => void };

/** Memuat data dengan pembatalan otomatis saat kunci berubah. Data lama tetap tampil selama memuat ulang. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: T | null; error: Error | null }>({
    status: "loading",
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: null }));
    loadRef.current(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ status: "ready", data, error: null }),
      (error: unknown) => {
        if (ctl.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setState((s) => ({ status: "error", data: s.data, error: error instanceof Error ? error : new Error(String(error)) }));
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload } as Resource<T>;
}

export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, onEscape]);
}
