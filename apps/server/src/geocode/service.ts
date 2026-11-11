import type { Sql } from "../db/client.ts";
import { searchPlaces } from "../places/search.ts";

const MAX_ATTEMPTS = 3;
// Indonesia, dengan sedikit ruang. Hasil di luar ini hampir pasti salah cocok.
const BOUNDS = { south: -11.5, north: 6.5, west: 94.5, east: 141.5 };

export interface GeocodeStatus {
  missing: number;
  exhausted: number;
  geocoded: number;
  usedToday: number;
  dailyLimit: number;
  configured: boolean;
}

function cityKey(city: string | null): string | null {
  if (!city) return null;
  const k = city.replace(/^(kota|kabupaten|kab\.?)\s+(adm\.?\s+)?/i, "").trim().toLowerCase();
  return k.length >= 3 ? k : null;
}

/**
 * Mencari koordinat lokasi yang belum punya titik lewat Google Places. Hasilnya ditandai "perkiraan" (geocoded) dan
 * baru dianggap benar setelah ada yang memeriksanya. Dibatasi kuota harian agar biaya tidak tak terduga.
 */
export class GeocodeService {
  private readonly sql: Sql;
  private readonly opts: { key: string | null; endpoint: string; dailyLimit: number; fetchImpl?: typeof fetch };
  private running = false;

  constructor(sql: Sql, opts: { key: string | null; endpoint: string; dailyLimit: number; fetchImpl?: typeof fetch }) {
    this.sql = sql;
    this.opts = opts;
  }

  async status(): Promise<GeocodeStatus> {
    const [c, u] = await Promise.all([
      this.sql<{ missing: number; exhausted: number; geocoded: number }[]>`
        select count(*) filter (where geom is null and geocode_attempts < ${MAX_ATTEMPTS})::int as missing,
               count(*) filter (where geom is null and geocode_attempts >= ${MAX_ATTEMPTS})::int as exhausted,
               count(*) filter (where coord_source = 'geocoded')::int as geocoded
        from locations where geom is null or coord_source = 'geocoded'`,
      this.sql<{ n: number }[]>`select coalesce((select n from geocode_usage where day = current_date), 0)::int as n`,
    ]);
    return { ...c[0]!, usedToday: u[0]!.n, dailyLimit: this.opts.dailyLimit, configured: Boolean(this.opts.key) };
  }

  async run(limit: number): Promise<{ tried: number; found: number; notFound: number; stopped: string | null }> {
    if (this.running) return { tried: 0, found: 0, notFound: 0, stopped: "Pencarian koordinat sedang berjalan." };
    this.running = true;
    let tried = 0;
    let found = 0;
    let notFound = 0;
    let stopped: string | null = null;
    try {
      const rows = await this.sql<{ id: string; name: string; address: string | null; province: string | null; city: string | null; district: string | null }[]>`
        select id::text, name, address, province, city, district from locations
        where geom is null and geocode_attempts < ${MAX_ATTEMPTS}
        order by geocode_attempts, id limit ${Math.max(1, Math.min(limit, 500))}`;
      for (const r of rows) {
        const used = (await this.sql<{ n: number }[]>`
          insert into geocode_usage (day, n) values (current_date, 1)
          on conflict (day) do update set n = geocode_usage.n + 1 returning n`)[0]!.n;
        if (used > this.opts.dailyLimit) {
          await this.sql`update geocode_usage set n = n - 1 where day = current_date`;
          stopped = `Batas harian ${this.opts.dailyLimit} pencarian tercapai.`;
          break;
        }
        tried++;
        const query = [r.name, r.district ? `Kecamatan ${r.district}` : null, r.city, r.province].filter(Boolean).join(", ");
        let results;
        try {
          results = await searchPlaces({ key: this.opts.key, endpoint: this.opts.endpoint, query, ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}) });
        } catch (e) {
          stopped = e instanceof Error ? e.message : "Pencarian gagal.";
          await this.sql`update geocode_usage set n = n - 1 where day = current_date`;
          tried--;
          break;
        }
        const key = cityKey(r.city);
        const hit = results.find(
          (p) =>
            p.latitude >= BOUNDS.south && p.latitude <= BOUNDS.north && p.longitude >= BOUNDS.west && p.longitude <= BOUNDS.east &&
            (!key || `${p.address ?? ""} ${p.name}`.toLowerCase().includes(key)),
        );
        if (hit) {
          await this.sql`
            update locations set geom = ST_SetSRID(ST_MakePoint(${hit.longitude}, ${hit.latitude}), 4326),
              coord_source = 'geocoded', geocode_note = ${`${hit.name}${hit.address ? `, ${hit.address}` : ""}`.slice(0, 300)},
              geocode_attempts = geocode_attempts + 1, version = version + 1, updated_at = now()
            where id = ${r.id} and geom is null`;
          found++;
        } else {
          await this.sql`update locations set geocode_attempts = geocode_attempts + 1 where id = ${r.id}`;
          notFound++;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    } finally {
      this.running = false;
    }
    return { tried, found, notFound, stopped };
  }
}
