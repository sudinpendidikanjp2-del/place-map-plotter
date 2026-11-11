import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { hasActiveFilter, type Location, type LocationFilter } from "@peta/domain";
import { api, type MapsConfig } from "../../data/api.ts";
import { useAuth } from "../../app/auth.tsx";
import { useFilter } from "../../app/filter.tsx";
import { useRouter } from "../../app/router.tsx";
import { useDebounced, useResource } from "../../shared/lib/hooks.ts";
import { useTheme } from "../../shared/lib/theme.ts";
import { formatNumber } from "../../shared/lib/format.ts";
import { Button, Dialog, IconButton, Spinner } from "../../shared/ui/primitives.tsx";
import { useToast } from "../../shared/ui/toast.tsx";
import { cn } from "../../shared/lib/cn.ts";
import { FilterControls, useFacets } from "../locations/FilterControls.tsx";
import { LocationForm } from "../locations/LocationForm.tsx";
import { ClusterLayer, type LayerStatus, type Viewport } from "./ClusterLayer.tsx";
import { DetailCard } from "./DetailCard.tsx";
import { DrawingLayer, ShapeOverlay, type DrawHandle, type DrawMode } from "./DrawingLayer.tsx";
import { RoutePanel, type Stop } from "./RoutePanel.tsx";

const INDONESIA = { lat: -2.5, lng: 118 };

export function MapPage() {
  const [failure, setFailure] = useState<string | null>(null);
  const config = useResource((s) => api.config(s), []);
  useEffect(() => {
    // Google memanggil fungsi global ini bila kunci ditolak (referrer salah, API belum aktif, atau tagihan belum diatur).
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () =>
      setFailure("Google Maps menolak kunci API. Periksa pembatasan referrer, API yang aktif, dan penagihan di Google Cloud Console.");
    return () => void delete (window as unknown as { gm_authFailure?: () => void }).gm_authFailure;
  }, []);
  if (config.status === "error" && !config.data) return <MapUnavailable reason="Konfigurasi peta tidak bisa dimuat dari server. Muat ulang halaman." />;
  if (!config.data) {
    return (
      <div className="grid min-h-dvh place-items-center text-ink-2">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!config.data.mapsKey) return <MapUnavailable />;
  if (failure) return <MapUnavailable reason={failure} />;
  return (
    <APIProvider apiKey={config.data.mapsKey} language="id" region="ID" onError={() => setFailure("Google Maps gagal dimuat. Periksa koneksi internet dan kunci API.")}>
      <MapScreen config={config.data} />
    </APIProvider>
  );
}

function MapScreen({ config }: { config: MapsConfig }) {
  const { can } = useAuth();
  const { filter, patch, setFilter } = useFilter();
  const { search, navigate } = useRouter();
  const toast = useToast();
  const [theme] = useTheme();
  const facets = useFacets();

  const selectedId = search.get("lokasi");
  const [selected, setSelected] = useState<Location | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [layer, setLayer] = useState<{ status: LayerStatus; truncated: boolean; message?: string }>({ status: "loading", truncated: false });
  const [mode, setMode] = useState<DrawMode>("none");
  const [mapType, setMapType] = useState<"roadmap" | "hybrid">("roadmap");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState<{ location: Location | null; at?: { lat: number; lng: number } } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [route, setRoute] = useState<{ open: boolean; stops: Stop[] }>({ open: false, stops: [] });
  const draw = useRef<DrawHandle>(null);
  const canEdit = can("editor");
  const categories = useMemo(() => facets.data?.categories.map((c) => c.category) ?? [], [facets.data]);
  // Data kosong sama sekali: peta tetap tampil, tetapi pengguna diberi jalan untuk mulai.
  const anyData = useResource((s) => api.extent({}, s), [refreshKey]);
  const isEmpty = anyData.status === "ready" && anyData.data.count === 0;

  // Memuat lokasi terpilih dari tautan (?lokasi=ID), termasuk dari pencarian dan layar Data.
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const ctl = new AbortController();
    api.get(selectedId, ctl.signal).then(
      (l) => !ctl.signal.aborted && setSelected(l),
      () => {
        if (ctl.signal.aborted) return;
        toast.error("Lokasi tidak ditemukan. Mungkin sudah dihapus.");
        navigate("/", { replace: true });
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const select = useCallback((id: string | null) => navigate(id ? `/?lokasi=${id}` : "/", { replace: true }), [navigate]);
  const onStatus = useCallback((status: LayerStatus, info?: { truncated: boolean; message?: string }) => setLayer({ status, truncated: info?.truncated ?? false, ...(info?.message ? { message: info.message } : {}) }), []);

  const applyShape = (shape: Pick<LocationFilter, "circle" | "polygon">) => {
    const next: LocationFilter = { ...filter };
    delete next.circle;
    delete next.polygon;
    setFilter({ ...next, ...shape });
    setMode("none");
  };

  const stops = route.stops;
  const inRoute = selected ? stops.some((s) => s.id === selected.id) : false;
  const toggleRoute = () => {
    if (!selected) return;
    setRoute((r) => ({
      open: true,
      stops: inRoute ? r.stops.filter((s) => s.id !== selected.id) : r.stops.length >= 27 ? r.stops : [...r.stops, { id: selected.id, name: selected.name, lat: selected.latitude, lng: selected.longitude }],
    }));
  };

  async function remove() {
    if (!selected) return;
    try {
      await api.remove(selected.id);
      toast.ok("Lokasi dihapus.");
      setConfirmDelete(false);
      select(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus.");
    }
  }

  const activeCount = [filter.kind, filter.category, filter.province, filter.city, filter.district, filter.q, filter.circle, filter.polygon].filter(Boolean).length;
  const drawing = mode !== "none";

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Map
        id="main"
        mapId={config.mapId}
        defaultCenter={INDONESIA}
        defaultZoom={5}
        mapTypeId={mapType}
        colorScheme={theme === "dark" ? "DARK" : "LIGHT"}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        minZoom={3}
        className="size-full"
      >
        <ClusterLayer filter={filter} refreshKey={refreshKey} selectedId={selectedId} onSelect={select} onViewport={setViewport} onStatus={onStatus} />
        <ShapeOverlay {...(filter.circle ? { circle: filter.circle } : {})} {...(filter.polygon ? { polygon: filter.polygon } : {})} />
        <DrawingLayer mode={mode} handle={draw} onShape={applyShape} onCancel={() => setMode("none")} onAdd={(at) => { setMode("none"); setForm({ location: null, at }); }} />
        <FitToFilter filter={filter} skip={Boolean(selectedId)} />
        <FocusSelected location={selected} />
      </Map>
      <MapTools mapType={mapType} onMapType={setMapType} />
      {route.open && <RoutePanelSlot stops={stops} onChange={(s) => setRoute((r) => ({ ...r, stops: s }))} onClose={() => setRoute((r) => ({ ...r, open: false }))} />}

      {/* Lapisan kontrol melayang di atas peta */}
      <div className="pointer-events-none absolute inset-x-2 top-[4.25rem] z-10 flex flex-col gap-2 md:inset-x-4 md:top-20">
        <div className="pointer-events-auto flex flex-col gap-2 self-start rounded-float border border-line bg-surface p-2.5 shadow-float md:max-w-[calc(100%-5rem)]">
          <div className="flex items-center gap-2 md:hidden">
            <Button icon="filter" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              Filter{activeCount ? ` (${activeCount})` : ""}
            </Button>
          </div>
          <div className={cn("md:block", filtersOpen ? "block" : "hidden")}>
            <FilterControls />
          </div>
        </div>

        <ViewStats viewport={viewport} filter={filter} refreshKey={refreshKey} layer={layer} />

        {(filter.circle || filter.polygon) && (
          <div className="pointer-events-auto self-start">
            <Button icon="close" onClick={() => patch({ circle: undefined, polygon: undefined })}>
              Hapus bentuk {filter.circle ? "lingkaran" : "area"}
            </Button>
          </div>
        )}

        {drawing && (
          <div role="status" className="pointer-events-auto flex flex-wrap items-center gap-2 self-start rounded-float border border-accent bg-surface px-4 py-2.5 shadow-float">
            <p className="font-medium">
              {mode === "circle" && "Klik pusat lingkaran, lalu klik lagi untuk menentukan jari-jari."}
              {mode === "polygon" && "Klik untuk menambah sudut. Klik dua kali atau tekan Enter untuk selesai."}
              {mode === "add" && "Klik lokasi di peta untuk menaruh titik baru."}
            </p>
            {mode === "polygon" && (
              <Button variant="primary" onClick={() => draw.current?.finish()}>
                Selesai
              </Button>
            )}
            <Button onClick={() => setMode("none")}>Batal</Button>
          </div>
        )}

        {layer.status === "error" && (
          <div role="alert" className="pointer-events-auto flex max-w-md items-center gap-3 self-start rounded-float border border-danger bg-surface px-4 py-2.5 shadow-float">
            <p className="text-danger">{layer.message ?? "Peta gagal memuat lokasi."}</p>
            <Button onClick={() => window.dispatchEvent(new Event("peta:retry"))}>Coba lagi</Button>
          </div>
        )}
      </div>

      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-4">
          <div className="pointer-events-auto max-w-sm rounded-float border border-line bg-surface p-5 text-center shadow-float">
            <h2 className="text-base font-semibold">Belum ada lokasi</h2>
            <p className="mt-1 text-ink-2">{canEdit ? "Impor berkas CSV atau klik tombol tambah di peta untuk menaruh titik pertama." : "Belum ada data yang bisa ditampilkan. Minta penyunting untuk menambahkannya."}</p>
            {canEdit && (
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" icon="upload" onClick={() => navigate("/impor")}>
                  Impor CSV
                </Button>
                <Button icon="plus" onClick={() => setMode("add")}>
                  Tambah di peta
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alat gambar di sisi kiri bawah */}
      <div className="absolute bottom-20 left-2 z-10 flex flex-col gap-1 rounded-float border border-line bg-surface p-1 shadow-float md:bottom-6 md:left-4" role="toolbar" aria-label="Alat peta">
        <IconButton icon="circle" label="Filter dengan lingkaran" pressed={mode === "circle"} onClick={() => setMode(mode === "circle" ? "none" : "circle")} />
        <IconButton icon="polygon" label="Filter dengan area gambar" pressed={mode === "polygon"} onClick={() => setMode(mode === "polygon" ? "none" : "polygon")} />
        <IconButton icon="route" label="Panel rute" pressed={route.open} onClick={() => setRoute((r) => ({ ...r, open: !r.open }))} />
        {canEdit && <IconButton icon="plus" label="Tambah lokasi di peta" pressed={mode === "add"} onClick={() => setMode(mode === "add" ? "none" : "add")} />}
      </div>

      <div className="pointer-events-none absolute inset-x-2 bottom-16 z-10 flex flex-col items-stretch gap-2 md:inset-x-auto md:bottom-6 md:right-4 md:top-auto md:items-end">
        {selected && (
          <DetailCard
            location={selected}
            canEdit={canEdit}
            inRoute={inRoute}
            onClose={() => select(null)}
            onEdit={() => setForm({ location: selected })}
            onDelete={() => setConfirmDelete(true)}
            onToggleRoute={toggleRoute}
          />
        )}
        {layer.truncated && (
          <p role="status" className="pointer-events-auto self-end rounded-control bg-surface px-3 py-1.5 text-[13px] shadow-float">
            Terlalu banyak titik di area ini. Perbesar atau persempit dengan filter untuk melihat semuanya.
          </p>
        )}
      </div>

      <LocationForm
        open={form !== null}
        location={form?.location ?? null}
        at={form?.at}
        categories={categories}
        onClose={() => setForm(null)}
        onSaved={(l) => {
          setForm(null);
          setSelected(l);
          setRefreshKey((k) => k + 1);
          if (selectedId !== l.id) select(l.id);
        }}
      />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Hapus lokasi">
        <p>
          <span className="font-semibold">{selected?.name}</span> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Batal</Button>
          <Button variant="danger" onClick={() => void remove()}>
            Hapus
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Panel rute ditaruh di sisi kiri atas agar tidak bertabrakan dengan kartu detail. */
function RoutePanelSlot(props: { stops: Stop[]; onChange: (s: Stop[]) => void; onClose: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-36 z-10 md:inset-x-auto md:bottom-6 md:left-20">
      <RoutePanel {...props} />
    </div>
  );
}

function MapTools({ mapType, onMapType }: { mapType: "roadmap" | "hybrid"; onMapType: (t: "roadmap" | "hybrid") => void }) {
  const map = useMap("main");
  const toast = useToast();
  const [full, setFull] = useState(false);
  useEffect(() => {
    const h = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  return (
    <div className="absolute right-2 top-[4.25rem] z-10 flex flex-col gap-1 rounded-float border border-line bg-surface p-1 shadow-float md:right-4 md:top-20" role="toolbar" aria-label="Tampilan peta">
      <IconButton icon="plus" label="Perbesar" onClick={() => map?.setZoom((map.getZoom() ?? 5) + 1)} />
      <IconButton icon="minus" label="Perkecil" onClick={() => map?.setZoom((map.getZoom() ?? 5) - 1)} />
      <IconButton icon="map" label={mapType === "roadmap" ? "Tampilkan citra satelit" : "Tampilkan peta jalan"} pressed={mapType === "hybrid"} onClick={() => onMapType(mapType === "roadmap" ? "hybrid" : "roadmap")} />
      <IconButton
        icon="locate"
        label="Ke lokasi saya"
        onClick={() =>
          navigator.geolocation
            ? navigator.geolocation.getCurrentPosition(
                (p) => {
                  map?.panTo({ lat: p.coords.latitude, lng: p.coords.longitude });
                  map?.setZoom(15);
                },
                () => toast.error("Lokasi Anda tidak bisa dibaca. Periksa izin lokasi di peramban."),
                { timeout: 8000 },
              )
            : toast.error("Peramban ini tidak mendukung lokasi.")
        }
      />
      <IconButton
        icon="expand"
        label={full ? "Keluar dari layar penuh" : "Layar penuh"}
        pressed={full}
        onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
      />
    </div>
  );
}

/** Menyesuaikan peta ke seluruh hasil saat filter (selain bentuk) berubah. */
function FitToFilter({ filter, skip }: { filter: LocationFilter; skip: boolean }) {
  const map = useMap();
  const scope = useMemo(() => {
    const { circle: _c, polygon: _p, bbox: _b, ...rest } = filter;
    return JSON.stringify(rest);
  }, [filter]);
  const first = useRef(true);
  useEffect(() => {
    if (!map) return;
    if (first.current && skip) {
      first.current = false;
      return;
    }
    first.current = false;
    const ctl = new AbortController();
    const { circle: _c, polygon: _p, bbox: _b, ...rest } = filter;
    api.extent(rest, ctl.signal).then(
      (r) => {
        if (ctl.signal.aborted || !r.bbox) return;
        const { west, south, east, north } = r.bbox;
        if (west === east && south === north) {
          map.setCenter({ lat: south, lng: west });
          map.setZoom(15);
        } else map.fitBounds({ west, south, east, north }, 72);
      },
      () => {},
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, scope]);
  return null;
}

function FocusSelected({ location }: { location: Location | null }) {
  const map = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !location || last.current === location.id) return;
    last.current = location.id;
    const b = map.getBounds();
    if (!b || !b.contains({ lat: location.latitude, lng: location.longitude }) || (map.getZoom() ?? 0) < 12) {
      map.panTo({ lat: location.latitude, lng: location.longitude });
      if ((map.getZoom() ?? 0) < 14) map.setZoom(15);
    }
  }, [map, location]);
  return null;
}

/** Angka ringkas untuk area yang sedang terlihat, dihitung server dari data nyata. */
function ViewStats({ viewport, filter, refreshKey, layer }: { viewport: Viewport | null; filter: LocationFilter; refreshKey: number; layer: { status: LayerStatus } }) {
  const dv = useDebounced(viewport, 400);
  const key = JSON.stringify({ filter, bbox: dv?.bbox, refreshKey });
  const summary = useResource(
    (signal) => (dv ? api.summary({ ...filter, bbox: dv.bbox }, signal) : Promise.resolve(null)),
    [key],
  );
  const s = summary.data;
  return (
    <div className="pointer-events-auto flex items-stretch divide-x divide-line self-start overflow-hidden rounded-float border border-line bg-surface shadow-float" aria-label="Ringkasan area peta" role="group">
      <Stat label="Lokasi di area ini" value={s?.total} loading={summary.status === "loading" || layer.status === "loading"} primary />
      <Stat label="Murid" value={s?.students} loading={summary.status === "loading"} />
      <Stat label="Guru" value={s?.teachers} loading={summary.status === "loading"} />
    </div>
  );
}

function Stat({ label, value, loading, primary }: { label: string; value: number | undefined; loading: boolean; primary?: boolean }) {
  return (
    <div className={cn("px-4 py-2", primary && "bg-navy text-white")}>
      <p className={cn("text-[12px]", primary ? "text-white/75" : "text-ink-2")}>{label}</p>
      <p className={cn("num flex items-center gap-2 font-semibold leading-tight", primary ? "text-[28px] text-accent" : "text-xl")}>
        {value === undefined ? "-" : formatNumber(value)}
        {loading && <Spinner className="size-3.5" />}
      </p>
    </div>
  );
}

function MapUnavailable({ reason }: { reason?: string }) {
  const { navigate } = useRouter();
  return (
    <div className="grid min-h-dvh place-items-center px-4 pt-20">
      <div className="max-w-lg rounded-float border border-line bg-surface p-6 shadow-float">
        <h1 className="text-xl font-semibold">Peta belum bisa ditampilkan</h1>
        <p className="mt-2 text-ink-2">
          {reason ? reason : <>Kunci Google Maps belum diatur. Isi <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">GOOGLE_MAPS_KEY</code> dan{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">GOOGLE_MAP_ID</code> di lingkungan server (berkas <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">.env</code>), lalu mulai ulang server.</>}
        </p>
        <p className="mt-2 text-ink-2">Layar lain tetap bisa dipakai tanpa peta.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon="table" onClick={() => navigate("/data")}>
            Buka data lokasi
          </Button>
          <Button icon="report" onClick={() => navigate("/laporan")}>
            Buka laporan
          </Button>
        </div>
      </div>
    </div>
  );
}
