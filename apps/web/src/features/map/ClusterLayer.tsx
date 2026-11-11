import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import type { BBox, ClusterFeature, LocationFilter } from "@peta/domain";
import { api } from "../../data/api.ts";
import { paddedBBox } from "./geo.ts";
import { ClusterBubble, PointMarker } from "./markers.tsx";

export interface Viewport {
  bbox: BBox;
  zoom: number;
}

export type LayerStatus = "loading" | "ready" | "error";

/** Mengambil cluster dari server setiap peta berhenti bergerak, filter berubah, atau data diubah. */
export function ClusterLayer({
  filter,
  refreshKey,
  selectedId,
  onSelect,
  onViewport,
  onStatus,
}: {
  filter: LocationFilter;
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onViewport: (v: Viewport) => void;
  onStatus: (s: LayerStatus, info?: { truncated: boolean; message?: string }) => void;
}) {
  const map = useMap();
  const [features, setFeatures] = useState<ClusterFeature[]>([]);
  const [nonce, setNonce] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  const filterKey = JSON.stringify(filter);
  const cb = useRef({ onViewport, onStatus });
  cb.current = { onViewport, onStatus };

  useEffect(() => {
    if (!map) return;
    const run = () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      if (!bounds || zoom === undefined) return;
      const bbox = paddedBBox(bounds);
      const z = Math.round(zoom);
      cb.current.onViewport({ bbox: paddedBBox(bounds, 0), zoom: z });
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      cb.current.onStatus("loading");
      api.clusters({ ...filter, bbox }, z, c.signal).then(
        (r) => {
          if (c.signal.aborted) return;
          setFeatures(r.features);
          cb.current.onStatus("ready", { truncated: r.truncated });
        },
        (e: unknown) => {
          if (c.signal.aborted) return;
          cb.current.onStatus("error", { truncated: false, message: e instanceof Error ? e.message : "Gagal memuat peta." });
        },
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    };
    const l = map.addListener("idle", schedule);
    run();
    return () => {
      l.remove();
      clearTimeout(timer);
      ctl.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, filterKey, refreshKey, nonce]);

  function zoomInto(f: ClusterFeature) {
    if (!map) return;
    map.panTo({ lat: f.lat, lng: f.lng });
    map.setZoom(Math.min((map.getZoom() ?? 5) + 2, 20));
  }

  return (
    <>
      {features.map((f) =>
        f.count > 1 ? (
          <AdvancedMarker key={`c-${f.lat.toFixed(5)}-${f.lng.toFixed(5)}`} position={{ lat: f.lat, lng: f.lng }} title={`${f.count} lokasi, perbesar untuk melihat`} onClick={() => zoomInto(f)}>
            <ClusterBubble count={f.count} />
          </AdvancedMarker>
        ) : f.id ? (
          <AdvancedMarker key={`p-${f.id}`} position={{ lat: f.lat, lng: f.lng }} title={f.name ?? "Lokasi"} zIndex={f.id === selectedId ? 10 : 1} onClick={() => onSelect(f.id!)}>
            <PointMarker feature={f} selected={f.id === selectedId} />
          </AdvancedMarker>
        ) : null,
      )}
      <RetryHook onRetry={() => setNonce((n) => n + 1)} />
    </>
  );
}

function RetryHook({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const h = () => onRetry();
    window.addEventListener("peta:retry", h);
    return () => window.removeEventListener("peta:retry", h);
  }, [onRetry]);
  return null;
}
