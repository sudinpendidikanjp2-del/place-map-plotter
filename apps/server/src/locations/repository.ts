import type postgres from "postgres";
import { parseAddress, type ClusterFeature, type Location, type LocationFilter, type LocationInput, type Summary } from "@peta/domain";
import type { Sql } from "../db/client.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { isEmptyFilter } from "./filter.ts";

type Frag = postgres.PendingQuery<postgres.Row[]>;

const MAX_BULK_IDS = 10_000;
const MAX_CLUSTER_FEATURES = 1500;
const TOTAL_CAP = 100_000;

/** Zoom ke atas ini tidak lagi dikelompokkan, titik ditampilkan satu per satu. */
export const INDIVIDUAL_ZOOM = 17;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export class LocationRepository {
  private readonly sql: Sql;
  private facetCache = new Map<string, { at: number; value: unknown }>();

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
      c.push(sql`ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})`);
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
      attributes, ST_Y(geom) as latitude, ST_X(geom) as longitude, province, city, district,
      version, created_at, updated_at`;
  }

  async get(id: string): Promise<Location> {
    if (!/^\d+$/.test(id)) throw notFound();
    const rows = await this.sql<Location[]>`select ${this.columns()} from locations where id = ${id}`;
    if (!rows[0]) throw notFound("Lokasi tidak ditemukan.");
    return rows[0];
  }

  async clusters(f: LocationFilter, zoom: number): Promise<{ features: ClusterFeature[]; total: number; truncated: boolean }> {
    const sql = this.sql;
    const where = this.where(f);
    let features: ClusterFeature[];
    if (zoom >= INDIVIDUAL_ZOOM) {
      features = await sql<ClusterFeature[]>`
        select 1 as count, ST_Y(geom) as lat, ST_X(geom) as lng, id::text as id, kind, name
        from locations ${where} limit ${MAX_CLUSTER_FEATURES + 1}`;
    } else {
      // Sel kira-kira 60 piksel pada zoom ini, dengan asal koordinat global agar kluster stabil saat peta digeser.
      const cell = 84.375 / 2 ** zoom;
      features = await sql<ClusterFeature[]>`
        select count(*)::int as count, avg(ST_Y(geom)) as lat, avg(ST_X(geom)) as lng,
          case when count(*) = 1 then min(id)::text end as id,
          case when count(*) = 1 then min(kind) end as kind,
          case when count(*) = 1 then min(name) end as name
        from locations ${where}
        group by ST_SnapToGrid(geom, ${cell})
        order by count(*) desc
        limit ${MAX_CLUSTER_FEATURES + 1}`;
    }
    const truncated = features.length > MAX_CLUSTER_FEATURES;
    if (truncated) features = features.slice(0, MAX_CLUSTER_FEATURES);
    const total = features.reduce((n, x) => n + x.count, 0);
    return { features, total, truncated };
  }

  /** Batas area semua lokasi yang sesuai filter, dipakai web untuk menyesuaikan tampilan peta. */
  async extent(f: LocationFilter): Promise<{ count: number; bbox: { west: number; south: number; east: number; north: number } | null }> {
    const rows = await this.sql<{ count: number; west: number | null; south: number | null; east: number | null; north: number | null }[]>`
      select count(*)::int as count, min(ST_X(geom)) as west, min(ST_Y(geom)) as south, max(ST_X(geom)) as east, max(ST_Y(geom)) as north
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
    const order = opts.sort === "nama" ? sql`order by locations.name, locations.id` : sql`order by locations.id desc`;
    const rows = await sql<Location[]>`
      select ${this.columns()} from locations ${base} ${cursorCond} ${order} limit ${limit + 1}`;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(JSON.stringify(opts.sort === "nama" ? { n: last.name, id: last.id } : { id: last.id })).toString("base64url")
        : null;

    let total = 0;
    let totalCapped = false;
    if (!opts.cursor) {
      const t = await sql<{ n: number }[]>`select count(*)::int as n from (select 1 from locations ${base} limit ${TOTAL_CAP + 1}) t`;
      total = t[0]!.n;
      totalCapped = total > TOTAL_CAP;
      if (totalCapped) total = TOTAL_CAP;
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
      select kind, name, category, ST_Y(geom) as latitude, ST_X(geom) as longitude, address, province, city, district,
        founded_year, students, teachers, description, photo_url
      from locations ${this.where(f)} order by id`.cursor(batch);
  }
}
