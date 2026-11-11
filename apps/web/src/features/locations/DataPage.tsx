import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasActiveFilter, type Location } from "@peta/domain";
import { api, type ListResult } from "../../data/api.ts";
import { useAuth } from "../../app/auth.tsx";
import { useFilter } from "../../app/filter.tsx";
import { useRouter } from "../../app/router.tsx";
import { formatNumber } from "../../shared/lib/format.ts";
import { Button, Dialog, DownloadLink, EmptyState, ErrorState, Field, Input, Select, SkeletonRows } from "../../shared/ui/primitives.tsx";
import { VirtualList } from "../../shared/ui/VirtualList.tsx";
import { useToast } from "../../shared/ui/toast.tsx";
import { FilterControls, useFacets } from "./FilterControls.tsx";
import { LocationForm } from "./LocationForm.tsx";
import { KindBadge } from "./kind.tsx";
import { IconButton } from "../../shared/ui/primitives.tsx";

const ROW = 60;

export function DataPage() {
  const { can } = useAuth();
  const { filter } = useFilter();
  const { navigate } = useRouter();
  const toast = useToast();
  const facets = useFacets();
  const [sort, setSort] = useState<"baru" | "nama">("baru");
  const [items, setItems] = useState<Location[]>([]);
  const [total, setTotal] = useState<{ n: number; capped: boolean } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">("loading");
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [editing, setEditing] = useState<Location | null | "new">(null);
  const [deleting, setDeleting] = useState<"selection" | Location | null>(null);
  const [recategorize, setRecategorize] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  const filterKey = JSON.stringify(filter);
  const canEdit = can("editor");

  const load = useCallback(
    async (after: string | null) => {
      const my = ++gen.current;
      setStatus(after ? "more" : "loading");
      try {
        const r: ListResult = await api.list(filter, { sort, limit: 100, cursor: after });
        if (my !== gen.current) return;
        setItems((prev) => (after ? [...prev, ...r.items] : r.items));
        setCursor(r.nextCursor);
        if (!after) setTotal({ n: r.total, capped: r.totalCapped });
        setStatus("ready");
      } catch (e) {
        if (my !== gen.current) return;
        setError(e instanceof Error ? e : new Error("Gagal memuat data."));
        setStatus("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey, sort],
  );

  useEffect(() => {
    setSelected(new Set());
    setAllMatching(false);
    void load(null);
  }, [load]);

  const refresh = () => void load(null);
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const selectionCount = allMatching ? (total?.n ?? 0) : selected.size;
  const categories = useMemo(() => facets.data?.categories.map((c) => c.category) ?? [], [facets.data]);

  function toggle(id: string) {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function runBulk(kind: "delete" | "category") {
    setBusy(true);
    try {
      const sel = allMatching ? { filter } : { ids: [...selected] };
      if (kind === "delete") {
        const r = await api.bulkDelete(sel);
        toast.ok(`${formatNumber(r.deleted)} lokasi dihapus.`);
      } else {
        const r = await api.bulkUpdate(sel, { category: newCategory.trim() });
        toast.ok(`Kategori ${formatNumber(r.updated)} lokasi diubah.`);
      }
      setDeleting(null);
      setRecategorize(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tindakan gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(l: Location) {
    setBusy(true);
    try {
      await api.remove(l.id);
      toast.ok("Lokasi dihapus.");
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data lokasi</h1>
          <p className="text-ink-2">
            {total ? (
              <>
                <span className="num font-medium text-ink">{formatNumber(total.n)}{total.capped ? "+" : ""}</span> lokasi{hasActiveFilter(filter) ? " sesuai filter" : ""}
              </>
            ) : (
              "Memuat jumlah"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as "baru" | "nama")} className="w-40">
            <option value="baru">Terbaru dulu</option>
            <option value="nama">Nama A ke Z</option>
          </Select>
          <DownloadLink href={api.exportCsvUrl(filter)} icon="download">Ekspor CSV</DownloadLink>
          {canEdit && (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Tambah
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-3">
        <FilterControls />
      </div>

      <section aria-label="Tabel lokasi" className="overflow-hidden rounded-card border border-line bg-surface">
        {canEdit && selectionCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-navy px-4 py-2 text-white">
            <p className="num mr-auto font-medium">{formatNumber(selectionCount)} dipilih</p>
            {!allMatching && hasActiveFilter(filter) && total && total.n > selected.size && !total.capped && (
              <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setAllMatching(true)}>
                Pilih semua {formatNumber(total.n)} hasil filter
              </Button>
            )}
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setRecategorize(true)}>
              Ubah kategori
            </Button>
            <Button variant="danger" icon="trash" onClick={() => setDeleting("selection")}>
              Hapus
            </Button>
          </div>
        )}

        <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink-2 md:grid-cols-[2.5rem_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_5rem_5rem_5.5rem]">
          <span>
            {canEdit && (
              <input
                type="checkbox"
                aria-label="Pilih semua baris yang dimuat"
                checked={allSelected}
                onChange={() => {
                  setAllMatching(false);
                  setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
                }}
                className="size-4 accent-[var(--navy)]"
              />
            )}
          </span>
          <span>Lokasi</span>
          <span className="hidden md:block">Kategori</span>
          <span className="hidden md:block">Wilayah</span>
          <span className="hidden text-right md:block">Murid</span>
          <span className="hidden text-right md:block">Guru</span>
          <span className="sr-only md:not-sr-only md:text-right">Aksi</span>
        </div>

        {status === "loading" && <SkeletonRows rows={8} />}
        {status === "error" && <ErrorState error={error ?? new Error("Gagal memuat data.")} onRetry={refresh} />}
        {status !== "loading" && status !== "error" && items.length === 0 && (
          <EmptyState
            title={hasActiveFilter(filter) ? "Tidak ada lokasi yang sesuai filter" : "Belum ada data lokasi"}
            action={
              !hasActiveFilter(filter) && canEdit ? (
                <Button variant="primary" icon="upload" onClick={() => navigate("/impor")}>
                  Impor dari CSV
                </Button>
              ) : undefined
            }
          >
            {hasActiveFilter(filter) ? "Longgarkan filter atau atur ulang untuk melihat semuanya." : "Impor berkas CSV atau tambahkan lokasi satu per satu."}
          </EmptyState>
        )}
        {items.length > 0 && status !== "error" && (
          <VirtualList
            label="Daftar lokasi"
            items={items}
            rowHeight={ROW}
            className="h-[calc(100dvh-24rem)] min-h-80"
            onEndReached={() => cursor && status === "ready" && void load(cursor)}
            render={(l) => (
              <div className="grid h-full grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-line px-4 hover:bg-surface-2 md:grid-cols-[2.5rem_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_5rem_5rem_5.5rem]">
                <span>
                  {canEdit ? (
                    <input type="checkbox" aria-label={`Pilih ${l.name}`} checked={allMatching || selected.has(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-[var(--navy)]" />
                  ) : (
                    <KindBadge kind={l.kind} size={24} />
                  )}
                </span>
                <button type="button" onClick={() => navigate(`/?lokasi=${l.id}`)} className="flex min-w-0 items-center gap-3 rounded-control text-left">
                  {canEdit && <KindBadge kind={l.kind} size={28} />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {l.name}
                      {l.latitude === null && <span className="ml-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] font-normal text-ink-2">Tanpa titik</span>}
                      {l.coordSource === "geocoded" && <span className="ml-2 rounded-md bg-accent/25 px-1.5 py-0.5 text-[12px] font-normal">Titik perkiraan</span>}
                    </span>
                    <span className="block truncate text-[13px] text-ink-2 md:hidden">{[l.level ?? l.category, l.city].filter(Boolean).join(" · ")}</span>
                    <span className="hidden truncate text-[13px] text-ink-2 md:block">{l.address ?? "Alamat belum diisi"}</span>
                  </span>
                </button>
                <span className="hidden truncate md:block">{[l.level, l.category !== l.level ? l.category : null].filter(Boolean).join(" · ")}</span>
                <span className="hidden truncate text-ink-2 md:block">{[l.district, l.city, l.province].filter(Boolean).join(", ") || "Belum diketahui"}</span>
                <span className="num hidden text-right md:block">{formatNumber(l.students)}</span>
                <span className="num hidden text-right md:block">{formatNumber(l.teachers)}</span>
                <span className="flex justify-end">
                  {canEdit && (
                    <>
                      <IconButton icon="edit" label={`Ubah ${l.name}`} onClick={() => setEditing(l)} />
                      <IconButton icon="trash" label={`Hapus ${l.name}`} onClick={() => setDeleting(l)} />
                    </>
                  )}
                </span>
              </div>
            )}
          />
        )}
        {status === "more" && <p className="border-t border-line px-4 py-2 text-[13px] text-ink-2">Memuat lebih banyak</p>}
      </section>

      <LocationForm
        open={editing !== null}
        location={editing === "new" ? null : editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title="Hapus lokasi">
        <p>
          {deleting === "selection" ? (
            <>
              <span className="num font-semibold">{formatNumber(selectionCount)}</span> lokasi akan dihapus permanen.
            </>
          ) : deleting ? (
            <>
              <span className="font-semibold">{deleting.name}</span> akan dihapus permanen.
            </>
          ) : null}{" "}
          Tindakan ini tidak bisa dibatalkan.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Batal</Button>
          <Button variant="danger" busy={busy} onClick={() => (deleting === "selection" ? void runBulk("delete") : deleting && void deleteOne(deleting))}>
            Hapus
          </Button>
        </div>
      </Dialog>

      <Dialog open={recategorize} onClose={() => setRecategorize(false)} title="Ubah kategori">
        <div className="flex flex-col gap-4">
          <p>
            Kategori <span className="num font-semibold">{formatNumber(selectionCount)}</span> lokasi akan diganti.
          </p>
          <Field label="Kategori baru">
            {(p) => <Input {...p} list="kategori-massal" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />}
          </Field>
          <datalist id="kategori-massal">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRecategorize(false)}>Batal</Button>
            <Button variant="primary" busy={busy} disabled={!newCategory.trim()} onClick={() => void runBulk("category")}>
              Terapkan
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
