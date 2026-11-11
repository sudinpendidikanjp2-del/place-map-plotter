import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { LocationFilter } from "@peta/domain";

interface FilterValue {
  filter: LocationFilter;
  setFilter: (f: LocationFilter) => void;
  patch: (p: Partial<LocationFilter>) => void;
  reset: () => void;
}

const Ctx = createContext<FilterValue | null>(null);

/** Filter dipakai bersama oleh Peta, Data, dan Laporan agar pilihan pengguna ikut saat berpindah layar. */
export function FilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<LocationFilter>({});
  const patch = useCallback((p: Partial<LocationFilter>) => {
    setFilter((f) => {
      const next: LocationFilter = { ...f, ...p };
      for (const k of Object.keys(next) as (keyof LocationFilter)[]) if (next[k] === undefined || next[k] === "") delete next[k];
      if (p.province !== undefined && p.province !== f.province) {
        delete next.city;
        delete next.district;
      }
      if (p.city !== undefined && p.city !== f.city) delete next.district;
      return next;
    });
  }, []);
  const reset = useCallback(() => setFilter({}), []);
  const value = useMemo(() => ({ filter, setFilter, patch, reset }), [filter, patch, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("FilterProvider belum dipasang.");
  return v;
}
