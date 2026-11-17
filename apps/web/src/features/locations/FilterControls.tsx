import { KIND_LABEL, LOCATION_KINDS, hasActiveFilter, type Level, type LocationFilter } from "@peta/domain";
import { api } from "../../data/api.ts";
import { useFilter } from "../../app/filter.tsx";
import { useDebounced, useResource } from "../../shared/lib/hooks.ts";
import { Button, Chip, Dialog, Input, Select } from "../../shared/ui/primitives.tsx";
import { MultiSelect } from "../../shared/ui/MultiSelect.tsx";
import { useMediaQuery } from "../../shared/lib/hooks.ts";
import { useEffect, useState } from "react";

export function useFacets() {
  const { filter } = useFilter();
  return useResource((signal) => api.facets({ province: filter.province, city: filter.city }, signal), [filter.province, filter.city]);
}

/** Kolom cari yang menunda pengiriman ke filter agar tiap ketukan tidak memicu permintaan. */
export function SearchBox({ className }: { className?: string }) {
  const { filter, patch } = useFilter();
  const [text, setText] = useState(filter.q ?? "");
  const dText = useDebounced(text, 350);
  useEffect(() => {
    if ((filter.q ?? "") !== dText.trim()) patch({ q: dText.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dText]);
  useEffect(() => {
    if (!filter.q) setText("");
  }, [filter.q]);
  return <Input type="search" enterKeyHint="search" aria-label="Cari nama atau alamat" placeholder="Cari nama atau alamat" value={text} onChange={(e) => setText(e.target.value)} className={className} />;
}

/** Jumlah filter aktif selain kata kunci, untuk lencana pada tombol Filter di ponsel. */
export function activeFilterCount(f: LocationFilter): number {
  return [f.kind, f.coords, f.level, f.category, f.province, f.city, f.districts?.length ? "x" : ""].filter(Boolean).length;
}

/**
 * Di layar lebar: semua kontrol terbuka dalam satu baris. Di ponsel: kolom cari dan tombol Filter yang membuka lembar
 * berisi sisanya, supaya daftar atau peta tidak terdorong keluar layar oleh sepuluh kontrol.
 */
export function FilterToolbar() {
  const wide = useMediaQuery("(min-width: 768px)");
  const { filter, reset } = useFilter();
  const [open, setOpen] = useState(false);
  if (wide) return <FilterControls />;
  const n = activeFilterCount(filter);
  return (
    <>
      <div className="flex items-center gap-2">
        <SearchBox className="min-w-0 flex-1" />
        <Button icon="filter" aria-haspopup="dialog" onClick={() => setOpen(true)} className="shrink-0">
          Filter{n ? ` (${n})` : ""}
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Filter" sheet>
        <div className="flex flex-col gap-4">
          <FilterControls layout="stack" hideSearch />
          <div className="flex gap-2">
            {hasActiveFilter(filter) && (
              <Button icon="close" onClick={reset}>
                Atur ulang
              </Button>
            )}
            <Button variant="primary" className="flex-1" onClick={() => setOpen(false)}>
              Tampilkan hasil
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Kontrol filter yang dipakai di tiga layar. `layout` hanya mengatur tata letak, perilaku sama. */
export function FilterControls({ layout = "row", hideSearch = false }: { layout?: "row" | "stack"; hideSearch?: boolean }) {
  const { filter, patch, reset } = useFilter();
  const facets = useFacets();

  const f = facets.data;
  const wrap = layout === "row" ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-3";
  return (
    <div className={wrap}>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Jenis lokasi">
        <Chip active={!filter.kind} onClick={() => patch({ kind: undefined })}>
          Semua
        </Chip>
        {LOCATION_KINDS.map((k) => (
          <Chip key={k} active={filter.kind === k} onClick={() => patch({ kind: filter.kind === k ? undefined : k })}>
            {KIND_LABEL[k]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Koordinat">
        <Chip active={filter.coords === "none"} onClick={() => patch({ coords: filter.coords === "none" ? undefined : "none" })}>
          Tanpa koordinat
        </Chip>
        <Chip active={filter.coords === "geocoded"} onClick={() => patch({ coords: filter.coords === "geocoded" ? undefined : "geocoded" })}>
          Koordinat perkiraan
        </Chip>
      </div>
      {!hideSearch && <SearchBox className={layout === "row" ? "w-full sm:w-56" : ""} />}
      <Select aria-label="Jenjang" value={filter.level ?? ""} onChange={(e) => patch({ level: (e.target.value || undefined) as Level | undefined })} className={layout === "row" ? "w-full sm:w-44" : ""}>
        <option value="">Semua jenjang</option>
        {f?.levels.map((l) => (
          <option key={l.value} value={l.value}>
            {l.value} ({l.count})
          </option>
        ))}
      </Select>
      <Select aria-label="Kategori" value={filter.category ?? ""} onChange={(e) => patch({ category: e.target.value })} className={layout === "row" ? "w-full sm:w-52" : ""}>
        <option value="">Semua kategori</option>
        {f?.categories.map((c) => (
          <option key={c.category} value={c.category}>
            {c.category} ({c.count})
          </option>
        ))}
      </Select>
      <Select aria-label="Provinsi" value={filter.province ?? ""} onChange={(e) => patch({ province: e.target.value })} className={layout === "row" ? "w-full sm:w-44" : ""}>
        <option value="">Semua provinsi</option>
        {f?.provinces.map((p) => (
          <option key={p.value} value={p.value}>
            {p.value}
          </option>
        ))}
      </Select>
      <Select aria-label="Kota atau kabupaten" value={filter.city ?? ""} disabled={!filter.province} onChange={(e) => patch({ city: e.target.value })} className={layout === "row" ? "w-full sm:w-56" : ""}>
        <option value="">{filter.province ? "Semua kota/kabupaten" : "Pilih provinsi dulu"}</option>
        {f?.cities.map((c) => (
          <option key={c.value} value={c.value}>
            {c.value}
          </option>
        ))}
      </Select>
      <MultiSelect
        label="Kecamatan"
        placeholder={filter.province ? "Semua kecamatan" : "Pilih provinsi dulu"}
        disabled={!filter.province}
        options={f?.districts ?? []}
        value={filter.districts ?? []}
        onChange={(v) => patch({ districts: v.length ? v : undefined })}
        className={layout === "row" ? "w-full sm:w-52" : ""}
      />
      {layout === "row" && hasActiveFilter(filter) && (
        <Button variant="ghost" icon="close" onClick={reset}>
          Atur ulang
        </Button>
      )}
    </div>
  );
}
