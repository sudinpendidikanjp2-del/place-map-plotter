import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons.tsx";
import { cn } from "../lib/cn.ts";

interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;
}

const Ctx = createContext<{ ok: (t: string) => void; error: (t: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  const api = useMemo(() => ({ ok: (t: string) => push("ok", t), error: (t: string) => push("error", t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 md:bottom-4 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "rise pointer-events-auto flex max-w-md items-center gap-2.5 rounded-control px-4 py-2.5 text-sm font-medium shadow-float",
              t.kind === "error" ? "bg-danger text-on-danger" : "bg-navy text-white",
            )}
          >
            <Icon name={t.kind === "error" ? "alert" : "check"} />
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ToastProvider belum dipasang.");
  return v;
}
