import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { LocationFilter } from "@peta/domain";
import { haversineM } from "./geo.ts";

export type DrawMode = "none" | "circle" | "polygon" | "add";
export interface DrawHandle {
  finish: () => void;
}

const STYLE = { strokeColor: "#F5B700", strokeWeight: 2.5, fillColor: "#F5B700", fillOpacity: 0.16, clickable: false } as const;

/** Menggambar lingkaran dan area langsung dengan peristiwa peta, tanpa pustaka drawing Google yang sudah usang. */
export function DrawingLayer({
  mode,
  onShape,
  onAdd,
  onCancel,
  handle,
}: {
  mode: DrawMode;
  onShape: (shape: Pick<LocationFilter, "circle" | "polygon">) => void;
  onAdd: (at: { lat: number; lng: number }) => void;
  onCancel: () => void;
  handle: Ref<DrawHandle>;
}) {
  const map = useMap();
  const finishRef = useRef<(() => void) | null>(null);
  useImperativeHandle(handle, () => ({ finish: () => finishRef.current?.() }), []);

  useEffect(() => {
    if (!map || mode === "none") return;
    const prev = { draggableCursor: map.get("draggableCursor"), doubleClick: map.get("disableDoubleClickZoom") };
    map.setOptions({ draggableCursor: "crosshair", disableDoubleClickZoom: true });
    const listeners: google.maps.MapsEventListener[] = [];
    const cleanups: (() => void)[] = [];

    if (mode === "add") {
      listeners.push(map.addListener("click", (e: google.maps.MapMouseEvent) => e.latLng && onAdd({ lat: e.latLng.lat(), lng: e.latLng.lng() })));
    }

    if (mode === "circle") {
      const circle = new google.maps.Circle({ ...STYLE, map, radius: 1 });
      let center: google.maps.LatLng | null = null;
      cleanups.push(() => circle.setMap(null));
      listeners.push(
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          if (!center) {
            center = e.latLng;
            circle.setCenter(center);
            return;
          }
          const radiusM = Math.max(50, haversineM({ lat: center.lat(), lng: center.lng() }, { lat: e.latLng.lat(), lng: e.latLng.lng() }));
          onShape({ circle: { lat: center.lat(), lng: center.lng(), radiusM } });
        }),
        map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
          if (center && e.latLng) circle.setRadius(haversineM({ lat: center.lat(), lng: center.lng() }, { lat: e.latLng.lat(), lng: e.latLng.lng() }));
        }),
      );
    }

    if (mode === "polygon") {
      const path: google.maps.LatLng[] = [];
      const poly = new google.maps.Polygon({ ...STYLE, map, paths: [] });
      cleanups.push(() => poly.setMap(null));
      const finish = () => {
        if (path.length < 3) return;
        onShape({ polygon: path.map((p) => [p.lng(), p.lat()] as [number, number]) });
      };
      finishRef.current = finish;
      listeners.push(
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          path.push(e.latLng);
          poly.setPath(path);
        }),
        map.addListener("mousemove", (e: google.maps.MapMouseEvent) => e.latLng && path.length > 0 && poly.setPath([...path, e.latLng])),
        map.addListener("dblclick", () => {
          path.pop();
          finish();
        }),
      );
    }

    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && mode === "polygon") finishRef.current?.();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      listeners.forEach((l) => l.remove());
      cleanups.forEach((c) => c());
      map.setOptions({ draggableCursor: prev.draggableCursor ?? null, disableDoubleClickZoom: Boolean(prev.doubleClick) });
      finishRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode]);

  return null;
}

/** Menampilkan bentuk yang sedang dipakai sebagai filter. */
export function ShapeOverlay({ circle, polygon }: Pick<LocationFilter, "circle" | "polygon">) {
  const map = useMap();
  const key = JSON.stringify({ circle, polygon });
  useEffect(() => {
    if (!map) return;
    let overlay: google.maps.Circle | google.maps.Polygon | null = null;
    if (circle) overlay = new google.maps.Circle({ ...STYLE, map, center: { lat: circle.lat, lng: circle.lng }, radius: circle.radiusM });
    else if (polygon) overlay = new google.maps.Polygon({ ...STYLE, map, paths: polygon.map(([lng, lat]) => ({ lat, lng })) });
    return () => overlay?.setMap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}
