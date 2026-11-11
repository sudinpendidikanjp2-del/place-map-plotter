import type postgres from "postgres";
import { parseAddress, type ClusterFeature, type Location, type LocationFilter, type LocationInput, type Summary } from "@peta/domain";
import type { Sql } from "../db/client.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { isEmptyFilter } from "./filter.ts";

type Frag = postgres.PendingQuery<postgres.Row[]>;

/** Zoom tertinggi yang punya pra-agregasi. Harus sama dengan generate_series di migrasi 004. */
export const CELL_MAX_ZOOM = 14;
const MAX_BULK_IDS = 10_000;
const MAX_CLUSTER_FEATURES = 1500;
const TOTAL_CAP = 100_000;
const SPATIAL_TOTAL_CAP = 10_000;

/** Zoom ke atas ini tidak lagi dikelompokkan, titik ditampilkan satu per satu. */
export const INDIVIDUAL_ZOOM = 17;

/** Pra-agregasi mencakup jenis, kategori, dan provinsi pada zoom 0 sampai 14. Filter lain memakai kueri langsung. */
export function canUseCells(f: LocationFilter, zoom: number): boolean {
  return zoom <= CELL_MAX_ZOOM && !f.q && !f.city && !f.district && !f.circle && !f.polygon;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export class LocationRepository {
  private readonly sql: Sql;
  private facetCache = new Map<string, { at: number; value: unknown }>();
  private resultCache = new Map<string, { value: unknown }>();

  constructor(sql: Sql) {
    this.sql = sql;
  }

  private where(f: LocationFilter): Frag {
    const sql = this.sql;
    const c: Frag[] = [];
    if (f.kind) c.push(sql`kind = ${f.kind}`);
    if (f.category) c.push(sql`category = ${f.category}`);
    if (f.province) c.push(sql`province = ${f.province}`);
    if (f.city) c.push(sql`city = ${f.city}`);
    if (f.district) c.push(sql`district = ${f.district}`);
    if (f.q) {
      const like = `%${escapeLike(f.q)}%`;
      c.push(sql`(name ilike ${like} or address ilike ${like})`);
    }
    if (f.bbox) {
      const b = f.bbox;
      c.push(sql`geom && ST_MakeEnvelope(${b.west}, ${b.south}, ${b.east}, ${b.north}, 4326)`);
    }
    if (f.circle) {
      const { lat, lng, radiusM } = f.circle;
      const dLat = radiusM / 111_320;
      const dLng = Math.min(180, radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180))));
      c.push(sql`geom && ST_MakeEnvelope(${lng - dLng}, ${Math.max(-90, lat - dLat)}, ${lng + dLng}, ${Math.min(90, lat + dLat)}, 4326)`);
      if (radiusM <= 100_000) {
        // Pendekatan ekuirektangular dengan aritmetika biasa, puluhan kali lebih cepat daripada jarak geografi per baris.
        // Galatnya di bawah 0,5% untuk radius sampai 100 km. Radius lebih besar memakai jarak geografi yang tepat.
        const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
        c.push(sql`(power((lng - ${lng}::float8) * ${kx}::float8, 2) + power((lat - ${lat}::float8) * ${111_320}::float8, 2)) <= ${radiusM * radiusM}::float8`);
      } else {
        c.push(sql`ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})`);
      }
    }
    if (f.polygon) {
      const ring = [...f.polygon, f.polygon[0]!].map(([x, y]) => `${x} ${y}`).join(",");
      c.push(sql`ST_Covers(ST_GeomFromText(${`POLYGON((${ring}))`}, 4326), geom)`);
    }
    if (c.length === 0) return sql``;
    return sql`where ${c.reduce((a, b) => sql`${a} and ${b}`)}`;
  }

  private columns(): Frag {
    return this.sql`
      id::text, kind, name, category, address, description, founded_year, photo_url, students, teachers,
      attributes, lat as latitude, lng as longitude, province, city, district,
      version, created_at, updated_at`;
  }

  async get(id: string): Promise<Location> {
    if (!/^\d+$/.test(id)) throw notFound();
    const rows = await this.sql<Location[]>`select ${this.columns()} from locations where id = ${id}`;
    if (!rows[0]) throw notFound("Lokasi tidak ditemukan.");
    return rows[0];
  }

  private async version(): Promise<string> {
    const rows = await this.sql<{ version: string }[]>`select version::text from data_version`;
    return rows[0]!.version;
  }

  /** Hasil mahal dipakai bersama antar pengguna. Kunci memuat versi data, jadi tidak pernah basi. */
  private async memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const full = `${await this.version()}|${key}`;
    const hit = this.resultCache.get(full);
    if (hit) {
      this.resultCache.delete(full);
      this.resultCache.set(full, hit);
      return hit.value as T;
    }
    const value = await load();
    this.resultCache.set(full, { value });
    if (this.resultCache.size > 300) this.resultCache.delete(this.resultCache.keys().next().value!);
    return value;
  }

  async clusters(f: LocationFilter, zoom: number): Promise<{ features: ClusterFeature[]; total: number; truncated: boolean }> {
    const sql = this.sql;
    // Sel kira-kira 60 piksel pada zoom ini, dengan asal koordinat global agar kluster stabil saat peta digeser.
    const cell = 84.375 / 2 ** zoom;
    let q = f;
    if (f.bbox) {
      // Area dibulatkan ke kelipatan sel supaya geseran kecil memakai ulang hasil yang sama.
      const step = cell * 4;
      const b = f.bbox;
      q = {
        ...f,
        bbox: {
          west: Math.max(-180, Math.floor(b.west / step) * step),
          south: Math.max(-90, Math.floor(b.south / step) * step),
          east: Math.min(180, Math.ceil(b.east / step) * step),
          north: Math.min(90, Math.ceil(b.north / step) * step),
        },
      };
    }
    return this.memo(`clusters|${zoom}|${JSON.stringify(q)}`, async () => {
      const features = canUseCells(q, zoom) ? await this.clustersFromCells(q, zoom, cell) : await this.clustersLive(q, zoom, cell);
      const truncated = features.length > MAX_CLUSTER_FEATURES;
      const out = truncated ? features.slice(0, MAX_CLUSTER_FEATURES) : features;
      return { features: out, total: out.reduce((n, x) => n + x.count, 0), truncated };
    });
  }

  /** Kueri langsung ke tabel lokasi. Dipakai untuk zoom dekat dan filter yang tidak tercakup pra-agregasi. */
  async clustersLive(f: LocationFilter, zoom: number, cell = 84.375 / 2 ** zoom): Promise<ClusterFeature[]> {
    const sql = this.sql;
    const where = this.where(f);
    if (zoom >= INDIVIDUAL_ZOOM) {
      return sql<ClusterFeature[]>`
        select 1 as count, lat, lng, id::text as id, kind, name
        from locations ${where} limit ${MAX_CLUSTER_FEATURES + 1}`;
    }
    return sql<ClusterFeature[]>`
      select count(*)::int as count, avg(lat) as lat, avg(lng) as lng,
        case when count(*) = 1 then min(id)::text end as id,
        case when count(*) = 1 then min(kind) end as kind,
        case when count(*) = 1 then min(name) end as name
      from locations ${where}
      group by floor(lng / ${cell}::float8), floor(lat / ${cell}::float8)
      order by count(*) desc
      limit ${MAX_CLUSTER_FEATURES + 1}`;
  }

  /** Membaca sel yang sudah dijumlahkan, sehingga biayanya mengikuti jumlah sel, bukan jumlah lokasi. */
  async clustersFromCells(f: LocationFilter, zoom: number, cell = 84.375 / 2 ** zoom): Promise<ClusterFeature[]> {
    const sql = this.sql;
    const c: Frag[] = [sql`z = ${zoom}`];
    if (f.bbox) {
      c.push(sql`cx between ${Math.floor(f.bbox.west / cell)} and ${Math.floor(f.bbox.east / cell)}`);
      c.push(sql`cy between ${Math.floor(f.bbox.south / cell)} and ${Math.floor(f.bbox.north / cell)}`);
    }
    if (f.kind) c.push(sql`kind = ${f.kind}`);
    if (f.category) c.push(sql`category = ${f.category}`);
    if (f.province) c.push(sql`province = ${f.province}`);
    const where = c.reduce((a, b) => sql`${a} and ${b}`);
    const rows = await sql<ClusterFeature[]>`
      select sum(n)::int as count, sum(sum_lat) / sum(n) as lat, sum(sum_lng) / sum(n) as lng
      from cluster_cells where ${where}
      group by cx, cy
      having sum(n) > 0
      order by sum(n) desc
      limit ${MAX_CLUSTER_FEATURES + 1}`;
    const singles = rows.filter((r) => r.count === 1);
    if (singles.length === 0) return rows.map((r) => ({ ...r, id: null, kind: null, name: null }));
    // Sel berisi satu lokasi: ambil id, jenis, dan nama lewat indeks GiST dalam satu kueri.
    const found = await sql<{ x: number; y: number; id: string; kind: ClusterFeature["kind"]; name: string }[]>`
      select t.x, t.y, l.id::text as id, l.kind, l.name
      from unnest(${singles.map((r) => r.lng)}::float8[], ${singles.map((r) => r.lat)}::float8[]) as t(x, y)
      join lateral (
        select id, kind, name from locations
        where geom && ST_MakeEnvelope(t.x - 0.000001, t.y - 0.000001, t.x + 0.000001, t.y + 0.000001, 4326)
        limit 1
      ) l on true`;
    const byPos = new Map(found.map((r) => [`${r.x}|${r.y}`, r]));
    return rows.map((r) => {
      const hit = r.count === 1 ? byPos.get(`${r.lng}|${r.lat}`) : undefined;
      return { count: r.count, lat: r.lat, lng: r.lng, id: hit?.id ?? null, kind: hit?.kind ?? null, name: hit?.name ?? null };
    });
  }

  /** Batas area semua lokasi yang sesuai filter, dipakai web untuk menyesuaikan tampilan peta. */
  async extent(f: LocationFilter): Promise<{ count: number; bbox: { west: number; south: number; east: number; north: number } | null }> {
    const rows = await this.sql<{ count: number; west: number | null; south: number | null; east: number | null; north: number | null }[]>`
      select count(*)::int as count, min(lng) as west, min(lat) as south, max(lng) as east, max(lat) as north
      from locations ${this.where(f)}`;
    const r = rows[0]!;
    if (r.count === 0 || r.west === null || r.south === null || r.east === null || r.north === null) return { count: 0, bbox: null };
    return { count: r.count, bbox: { west: r.west, south: r.south, east: r.east, north: r.north } };
  }

  async list(
    f: LocationFilter,
    opts: { sort: "baru" | "nama"; limit: number; cursor?: string },
  ): Promise<{ items: Location[]; nextCursor: string | null; total: number; totalCapped: boolean }> {
    const sql = this.sql;
    const limit = Math.min(Math.max(opts.limit, 1), 200);
    const base = this.where(f);
    let cursorCond: Frag = sql``;
    let cur: { n?: string; id: string } | null = null;
    if (opts.cursor) {
      try {
        cur = JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8"));
      } catch {
        throw badRequest("Kursor tidak valid.");
      }
      if (!cur || typeof cur.id !== "string" || !/^\d+$/.test(cur.id)) throw badRequest("Kursor tidak valid.");
    }
    const hasWhere = !isEmptyFilter(f);
    const joiner = hasWhere ? sql`and` : sql`where`;
    if (cur) {
      cursorCond =
        opts.sort === "nama"
          ? sql`${joiner} (name, id) > (${cur.n ?? ""}, ${cur.id})`
          : sql`${joiner} id < ${cur.id}`;
    }
    // Filter teks dan spasial memilih baris lewat indeks GIN atau GiST. Urutan murni berdasarkan kunci utama membuat
    // perencana memindai seluruh tabel dari belakang (12 detik pada 10 juta baris). Ekspresi "+ 0" dan "|| ''"
    // mematikan indeks urutan sehingga hasil indeks filter dipakai lebih dulu lalu diurutkan.
    const selective = Boolean(f.q || f.circle || f.polygon || f.bbox);
    const order =
      opts.sort === "nama"
        ? selective
          ? sql`order by (locations.name || '') , locations.id`
          : sql`order by locations.name, locations.id`
        : selective
          ? sql`order by (locations.id + 0) desc`
          : sql`order by locations.id desc`;
    const cap = f.circle || f.polygon || f.bbox ? SPATIAL_TOTAL_CAP : TOTAL_CAP;
    const [rows, counted] = await Promise.all([
      sql<Location[]>`select ${this.columns()} from locations ${base} ${cursorCond} ${order} limit ${limit + 1}`,
      opts.cursor
        ? Promise.resolve(null)
        : this.memo(`count|${cap}|${JSON.stringify(f)}`, () =>
            sql<{ n: number }[]>`select count(*)::int as n from (select 1 from locations ${base} limit ${cap + 1}) t`,
          ),
    ]);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(JSON.stringify(opts.sort === "nama" ? { n: last.name, id: last.id } : { id: last.id })).toString("base64url")
        : null;

    let total = 0;
    let totalCapped = false;
    if (counted) {
      total = counted[0]!.n;
      totalCapped = total > cap;
      if (totalCapped) total = cap;
    }
    return { items, nextCursor, total, totalCapped };
  }

  async create(input: LocationInput, userId: string): Promise<Location> {
    const sql = this.sql;
    const geo = parseAddress(input.address);
    const rows = await sql<{ id: string }[]>`
      insert into locations (kind, name, category, address, description, founded_year, photo_url, students, teachers,
        attributes, geom, province, city, district, created_by, updated_by)
      values (${input.kind}, ${input.name}, ${input.category}, ${input.address}, ${input.description}, ${input.foundedYear},
        ${input.photoUrl}, ${input.students}, ${input.teachers}, ${sql.json(input.attributes)},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
        ${geo.province}, ${geo.city}, ${geo.district}, ${userId}, ${userId})
      returning id::text`;
    return this.get(rows[0]!.id);
  }

  async update(id: string, input: LocationInput, version: number, userId: string): Promise<Location> {
    const sql = this.sql;
    const geo = parseAddress(input.address);
    const rows = await sql<{ id: string }[]>`
      update locations set
        kind = ${input.kind}, name = ${input.name}, category = ${input.category}, address = ${input.address},
        description = ${input.description}, founded_year = ${input.foundedYear}, photo_url = ${input.photoUrl},
        students = ${input.students}, teachers = ${input.teachers}, attributes = ${sql.json(input.attributes)},
        geom = ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
        province = ${geo.province}, city = ${geo.city}, district = ${geo.district},
        updated_by = ${userId}, version = version + 1, updated_at = now()
      where id = ${id} and version = ${version}
      returning id::text`;
    if (!rows[0]) {
      const exists = await sql`select 1 from locations where id = ${id}`;
      if (exists.length === 0) throw notFound("Lokasi tidak ditemukan.");
      throw conflict("Data ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru.");
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    if (!/^\d+$/.test(id)) throw notFound();
    const rows = await this.sql`delete from locations where id = ${id} returning id`;
    if (rows.length === 0) throw notFound("Lokasi tidak ditemukan.");
  }

  private target(sel: { ids?: string[]; filter?: LocationFilter }): Frag {
    const sql = this.sql;
    if (sel.ids) {
      if (sel.ids.length === 0 || sel.ids.length > MAX_BULK_IDS) throw badRequest(`Pilih 1 sampai ${MAX_BULK_IDS} lokasi.`);
      if (!sel.ids.every((i) => /^\d+$/.test(i))) throw badRequest("Daftar id tidak valid.");
      return sql`where id = any(${sel.ids.map(Number)}::bigint[])`;
    }
    if (!sel.filter || isEmptyFilter(sel.filter)) {
      throw badRequest("Tindakan massal tanpa daftar id harus memakai minimal satu filter.");
    }
    return this.where(sel.filter);
  }

  async bulkUpdate(
    sel: { ids?: string[]; filter?: LocationFilter },
    patch: { category?: string; kind?: LocationInput["kind"] },
    userId: string,
  ): Promise<number> {
    if (patch.category === undefined && patch.kind === undefined) throw badRequest("Tidak ada perubahan yang diminta.");
    const sql = this.sql;
    const rows = await sql`
      update locations set
        category = coalesce(${patch.category ?? null}, category),
        kind = coalesce(${patch.kind ?? null}, kind),
        updated_by = ${userId}, version = version + 1, updated_at = now()
      ${this.target(sel)} returning id`;
    return rows.length;
  }

  async bulkDelete(sel: { ids?: string[]; filter?: LocationFilter }): Promise<number> {
    const rows = await this.sql`delete from locations ${this.target(sel)} returning id`;
    return rows.length;
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.facetCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    this.facetCache.set(key, { at: Date.now(), value });
    if (this.facetCache.size > 200) this.facetCache.clear();
    return value;
  }

  invalidate(): void {
    this.facetCache.clear();
  }

  async facets(scope: { province?: string; city?: string }) {
    const key = `facets:${scope.province ?? ""}:${scope.city ?? ""}`;
    return this.cached(key, 30_000, async () => {
      const sql = this.sql;
      const [categories, provinces, cities, districts] = await Promise.all([
        sql<{ category: string; count: number }[]>`
          select category, count(*)::int as count from locations group by category order by count desc, category limit 200`,
        sql<{ value: string; count: number }[]>`
          select province as value, count(*)::int as count from locations where province is not null group by province order by province`,
        scope.province
          ? sql<{ value: string; count: number }[]>`
              select city as value, count(*)::int as count from locations
              where province = ${scope.province} and city is not null group by city order by city limit 1000`
          : Promise.resolve([] as { value: string; count: number }[]),
        scope.province && scope.city
          ? sql<{ value: string; count: number }[]>`
              select district as value, count(*)::int as count from locations
              where province = ${scope.province} and city = ${scope.city} and district is not null
              group by district order by district limit 1000`
          : Promise.resolve([] as { value: string; count: number }[]),
      ]);
      return { categories, provinces, cities, districts };
    });
  }

  async summary(f: LocationFilter): Promise<Summary> {
    return this.memo(`summary|${JSON.stringify(f)}`, () => (canUseCells(f, 14) ? this.summaryFromAggregates(f) : this.computeSummary(f)));
  }

  /**
   * Ringkasan dari tabel pra-agregasi. Tanpa area: dari `stat_months`, tepat. Dengan area: dari `cluster_cells`
   * pada zoom yang selnya kira-kira seperlima puluh lebar area, jadi angka di tepi area berupa perkiraan.
   * Tren bulanan tidak tersedia untuk ringkasan berarea.
   */
  async summaryFromAggregates(f: LocationFilter): Promise<Summary> {
    const sql = this.sql;
    const dims = (): Frag[] => {
      const c: Frag[] = [];
      if (f.kind) c.push(sql`kind = ${f.kind}`);
      if (f.category) c.push(sql`category = ${f.category}`);
      if (f.province) c.push(sql`province = ${f.province}`);
      return c;
    };
    const join = (c: Frag[]) => (c.length ? sql`where ${c.reduce((a, b) => sql`${a} and ${b}`)}` : sql``);
    const spatial = f.bbox !== undefined;
    let table: Frag;
    let n: Frag;
    let st: Frag;
    let te: Frag;
    const c = dims();
    if (spatial) {
      const b = f.bbox!;
      const span = Math.max(b.east - b.west, 1e-6);
      const zoom = Math.min(14, Math.max(0, Math.round(Math.log2((84.375 * 50) / span))));
      const cell = 84.375 / 2 ** zoom;
      c.push(sql`z = ${zoom}`);
      c.push(sql`cx between ${Math.floor(b.west / cell)} and ${Math.floor(b.east / cell)}`);
      c.push(sql`cy between ${Math.floor(b.south / cell)} and ${Math.floor(b.north / cell)}`);
      table = sql`cluster_cells`;
      n = sql`n`;
      st = sql`sum_students`;
      te = sql`sum_teachers`;
    } else {
      table = sql`stat_months`;
      n = sql`n`;
      st = sql`students`;
      te = sql`teachers`;
    }
    const where = join(c);
    const [totals, byKind, byCategory, byProvince, perMonth] = await Promise.all([
      sql<{ total: number; students: number; teachers: number }[]>`
        select coalesce(sum(${n}), 0)::int as total, coalesce(sum(${st}), 0)::float8 as students,
          coalesce(sum(${te}), 0)::float8 as teachers from ${table} ${where}`,
      sql<Summary["byKind"]>`
        select kind, sum(${n})::int as count from ${table} ${where} group by kind having sum(${n}) > 0 order by count desc`,
      sql<Summary["byCategory"]>`
        select category, sum(${n})::int as count, coalesce(sum(${st}), 0)::float8 as students
        from ${table} ${where} group by category having sum(${n}) > 0 order by count desc, category limit 20`,
      sql<Summary["byProvince"]>`
        select case when province = '' then 'Belum diketahui' else province end as province, sum(${n})::int as count
        from ${table} ${where} group by province having sum(${n}) > 0 order by count desc limit 15`,
      spatial
        ? Promise.resolve([] as Summary["addedPerMonth"])
        : sql<Summary["addedPerMonth"]>`
            select to_char(month, 'YYYY-MM') as month, sum(n)::int as count from stat_months
            ${c.length ? sql`${where} and` : sql`where`} month >= (date_trunc('month', now()) - interval '11 months')::date
            group by month having sum(n) > 0 order by month`,
    ]);
    return { total: totals[0]!.total, students: totals[0]!.students, teachers: totals[0]!.teachers, byKind, byCategory, byProvince, addedPerMonth: perMonth };
  }

  async computeSummary(f: LocationFilter): Promise<Summary> {
    const sql = this.sql;
    const where = this.where(f);
    const [totals, byKind, byCategory, byProvince, perMonth] = await Promise.all([
      sql<{ total: number; students: number; teachers: number }[]>`
        select count(*)::int as total, coalesce(sum(students), 0)::bigint::float8 as students,
          coalesce(sum(teachers), 0)::bigint::float8 as teachers from locations ${where}`,
      sql<{ kind: Summary["byKind"][number]["kind"]; count: number }[]>`
        select kind, count(*)::int as count from locations ${where} group by kind order by count desc`,
      sql<Summary["byCategory"]>`
        select category, count(*)::int as count, coalesce(sum(students), 0)::bigint::float8 as students
        from locations ${where} group by category order by count desc, category limit 20`,
      sql<Summary["byProvince"]>`
        select coalesce(province, 'Belum diketahui') as province, count(*)::int as count
        from locations ${where} group by province order by count desc limit 15`,
      sql<Summary["addedPerMonth"]>`
        select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::int as count
        from locations ${where}
        ${isEmptyFilter(f) ? sql`where` : sql`and`} created_at >= date_trunc('month', now()) - interval '11 months'
        group by 1 order by 1`,
    ]);
    return {
      total: totals[0]!.total,
      students: totals[0]!.students,
      teachers: totals[0]!.teachers,
      byKind,
      byCategory,
      byProvince,
      addedPerMonth: perMonth,
    };
  }

  /** Aliran baris untuk ekspor CSV: memori konstan berapa pun jumlah barisnya. */
  stream(f: LocationFilter, batch = 2000) {
    const sql = this.sql;
    return sql`
      select kind, name, category, lat as latitude, lng as longitude, address, province, city, district,
        founded_year, students, teachers, description, photo_url
      from locations ${this.where(f)} order by id`.cursor(batch);
  }
}
