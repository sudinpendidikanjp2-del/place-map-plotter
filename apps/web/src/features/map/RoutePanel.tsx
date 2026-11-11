import { useEffect, useRef, useState } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Button, IconButton, Spinner } from "../../shared/ui/primitives.tsx";
import { formatDistance, formatDuration } from "../../shared/lib/format.ts";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const ERRORS: Record<string, string> = {
  ZERO_RESULTS: "Tidak ada jalur darat di antara titik-titik ini.",
  OVER_QUERY_LIMIT: "Kuota layanan rute terlampaui. Coba lagi nanti.",
  REQUEST_DENIED: "Layanan rute ditolak. Pastikan Directions API aktif untuk kunci Google Maps.",
  NOT_FOUND: "Salah satu titik tidak bisa ditemukan oleh layanan rute.",
  MAX_WAYPOINTS_EXCEEDED: "Terlalu banyak titik. Maksimal 25 titik antara.",
};

/** Menghitung rute berkendara antar lokasi terpilih memakai layanan Directions Google. */
export function RoutePanel({ stops, onChange, onClose }: { stops: Stop[]; onChange: (s: Stop[]) => void; onClose: () => void }) {
  const map = useMap("main");
  const routes = useMapsLibrary("routes");
  const renderer = useRef<google.maps.DirectionsRenderer | null>(null);
  const [optimize, setOptimize] = useState(true);
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; distance?: number; duration?: number; message?: string }>({ status: "idle" });

  useEffect(() => {
    if (!map || !routes) return;
    renderer.current = new routes.DirectionsRenderer({ map, suppressMarkers: false, preserveViewport: false });
    return () => renderer.current?.setMap(null);
  }, [map, routes]);

  useEffect(() => {
    renderer.current?.set("directions", null);
    setState({ status: "idle" });
  }, [stops.length]);

  async function compute() {
    if (!routes || stops.length < 2) return;
    setState({ status: "busy" });
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    try {
      const result = await new routes.DirectionsService().route({
        origin: { lat: first.lat, lng: first.lng },
        destination: { lat: last.lat, lng: last.lng },
        waypoints: stops.slice(1, -1).map((s) => ({ location: { lat: s.lat, lng: s.lng }, stopover: true })),
        optimizeWaypoints: optimize,
        travelMode: google.maps.TravelMode.DRIVING,
      });
      renderer.current?.setDirections(result);
      const legs = result.routes[0]?.legs ?? [];
      setState({
        status: "done",
        distance: legs.reduce((n, l) => n + (l.distance?.value ?? 0), 0),
        duration: legs.reduce((n, l) => n + (l.duration?.value ?? 0), 0),
      });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setState({ status: "error", message: ERRORS[code] ?? "Rute tidak bisa dihitung saat ini." });
    }
  }

  const move = (i: number, d: -1 | 1) => {
    const next = [...stops];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <section aria-label="Rute" className="rise pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-float border border-line bg-surface shadow-float md:w-80">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-semibold">Rute</h2>
        <IconButton icon="close" label="Tutup panel rute" onClick={onClose} />
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-4">
        {stops.length === 0 && <p className="text-ink-2">Pilih lokasi di peta, lalu tekan Tambah ke rute. Titik pertama adalah awal, titik terakhir adalah tujuan.</p>}
        <ol className="flex flex-col gap-1.5">
          {stops.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-control bg-surface-2 py-1 pl-3 pr-1">
              <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-navy text-[11px] font-semibold text-accent">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <IconButton icon="chevron" label={`Turunkan ${s.name}`} className="size-8 rotate-0" disabled={i === stops.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon="close" label={`Hapus ${s.name} dari rute`} className="size-8" onClick={() => onChange(stops.filter((x) => x.id !== s.id))} />
            </li>
          ))}
        </ol>
        {stops.length >= 3 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} className="size-4 accent-[var(--navy)]" />
            Urutkan titik antara otomatis
          </label>
        )}
        {state.status === "error" && (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {state.message}
          </p>
        )}
        {state.status === "done" && (
          <p role="status" className="num rounded-control bg-surface-2 px-3 py-2 font-medium">
            {formatDistance(state.distance ?? 0)} · {formatDuration(state.duration ?? 0)}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" icon="route" disabled={stops.length < 2 || !routes || state.status === "busy"} onClick={() => void compute()}>
            {state.status === "busy" ? <Spinner /> : "Hitung rute"}
          </Button>
          <Button variant="ghost" disabled={stops.length === 0} onClick={() => onChange([])}>
            Kosongkan
          </Button>
        </div>
      </div>
    </section>
  );
}
