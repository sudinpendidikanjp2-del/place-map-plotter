import { LEVELS, LOCATION_KINDS, type BBox, type Level, type LocationFilter, type LocationKind } from "@peta/domain";
import { badRequest } from "../http/errors.ts";

function num(v: string | null, name: string): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`Parameter ${name} harus berupa angka.`);
  return n;
}

function str(v: string | null, max = 200): string | undefined {
  const s = v?.trim();
  return s ? s.slice(0, max) : undefined;
}

export function parseBBox(q: URLSearchParams): BBox | undefined {
  const west = num(q.get("west"), "west");
  const south = num(q.get("south"), "south");
  const east = num(q.get("east"), "east");
  const north = num(q.get("north"), "north");
  if (west === undefined || south === undefined || east === undefined || north === undefined) return undefined;
  if (south < -90 || north > 90 || south > north) throw badRequest("Batas lintang area tidak valid.");
  if (west < -180 || east > 180 || west > east) throw badRequest("Batas bujur area tidak valid.");
  return { west, south, east, north };
}

/** Membaca parameter filter dari URL. Semua nilai divalidasi sebelum menyentuh basis data. */
export function parseFilter(q: URLSearchParams): LocationFilter {
  const filter: LocationFilter = {};

  const kind = q.get("kind");
  if (kind) {
    if (!(LOCATION_KINDS as readonly string[]).includes(kind)) throw badRequest("Jenis tidak dikenal.");
    filter.kind = kind as LocationKind;
  }
  const category = str(q.get("category"), 100);
  if (category) filter.category = category;
  const level = str(q.get("level"), 20);
  if (level) {
    if (!(LEVELS as readonly string[]).includes(level)) throw badRequest("Jenjang tidak dikenal.");
    filter.level = level as Level;
  }
  const coords = q.get("coords");
  if (coords) {
    if (coords !== "none" && coords !== "geocoded") throw badRequest("Parameter coords harus none atau geocoded.");
    filter.coords = coords;
  }
  const province = str(q.get("province"), 100);
  if (province) filter.province = province;
  const city = str(q.get("city"), 100);
  if (city) filter.city = city;
  const district = str(q.get("district"), 100);
  if (district) filter.district = district;
  const text = str(q.get("q"), 100);
  if (text) filter.q = text;

  const bbox = parseBBox(q);
  if (bbox) filter.bbox = bbox;

  const circle = q.get("circle");
  if (circle) {
    const [lat, lng, r] = circle.split(",").map(Number);
    if (![lat, lng, r].every((n) => Number.isFinite(n)) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180 || r! <= 0 || r! > 20_000_000) {
      throw badRequest("Parameter circle harus berbentuk lintang,bujur,radiusMeter.");
    }
    filter.circle = { lat: lat!, lng: lng!, radiusM: r! };
  }

  const polygon = q.get("polygon");
  if (polygon) {
    const pts = polygon.split(";").map((p) => p.split(",").map(Number) as [number, number]);
    if (pts.length < 3 || pts.length > 500 || pts.some((p) => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
      throw badRequest("Parameter polygon harus berisi 3 sampai 500 titik bujur,lintang yang dipisah titik koma.");
    }
    filter.polygon = pts;
  }
  return filter;
}

/** Filter sengaja kosong berarti seluruh data, tindakan massal harus menolaknya. */
export function isEmptyFilter(f: LocationFilter): boolean {
  return Object.keys(f).length === 0;
}
