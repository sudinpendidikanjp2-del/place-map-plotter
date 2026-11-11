import type { LocationFilter } from "./types.ts";

/** Satu cara menyusun parameter URL dari filter, dipakai web dan tes. Format dibaca oleh `parseFilter` di server. */
export function filterToParams(f: LocationFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (f.kind) q.set("kind", f.kind);
  if (f.category) q.set("category", f.category);
  if (f.level) q.set("level", f.level);
  if (f.province) q.set("province", f.province);
  if (f.city) q.set("city", f.city);
  if (f.district) q.set("district", f.district);
  if (f.q) q.set("q", f.q);
  if (f.bbox) {
    q.set("west", String(f.bbox.west));
    q.set("south", String(f.bbox.south));
    q.set("east", String(f.bbox.east));
    q.set("north", String(f.bbox.north));
  }
  if (f.circle) q.set("circle", `${f.circle.lat},${f.circle.lng},${Math.round(f.circle.radiusM)}`);
  if (f.polygon) q.set("polygon", f.polygon.map((p) => `${p[0]},${p[1]}`).join(";"));
  return q;
}

export function hasActiveFilter(f: LocationFilter): boolean {
  return Boolean(f.kind || f.category || f.level || f.province || f.city || f.district || f.q || f.circle || f.polygon);
}
