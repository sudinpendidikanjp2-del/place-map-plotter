import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CsvParser,
  FIELD_LABEL,
  LOCATION_KINDS,
  mapHeaders,
  parseAddress,
  rowToRaw,
  validateLocationInput,
  type LocationKind,
  type MappedField,
} from "@peta/domain";
import type { Sql } from "../db/client.ts";
import { HttpError, badRequest, conflict, notFound } from "../http/errors.ts";

export interface ImportBatch {
  id: string;
  filename: string;
  defaultKind: LocationKind;
  status: "menunggu" | "berjalan" | "selesai" | "gagal" | "dibatalkan";
  total: number;
  inserted: number;
  /** Baris ber-NPSN yang sudah ada dan diperbarui. */
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const CHUNK_ROWS = 20_000;
const MAX_STORED_ERRORS = 200;

const BATCH_COLUMNS = (sql: Sql) => sql`
  id::text, filename, default_kind, status, total, inserted, updated, failed, errors, message, created_at, finished_at`;

function copyField(v: string | number | null): string {
  if (v === null) return "\\N";
  return String(v).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

interface StagedRow {
  kind: string;
  name: string;
  category: string;
  level: string | null;
  npsn: string | null;
  address: string | null;
  description: string | null;
  foundedYear: number | null;
  photoUrl: string | null;
  students: number | null;
  teachers: number | null;
  attributes: string;
  lat: number | null;
  lng: number | null;
  province: string | null;
  city: string | null;
  district: string | null;
}

export class ImportService {
  private readonly sql: Sql;
  private readonly maxBytes: number;

  constructor(sql: Sql, maxBytes: number) {
    this.sql = sql;
    this.maxBytes = maxBytes;
  }

  async create(filename: string, defaultKind: string, userId: string | null): Promise<ImportBatch> {
    if (!(LOCATION_KINDS as readonly string[]).includes(defaultKind)) throw badRequest("Jenis bawaan tidak dikenal.");
    const name = filename.trim().slice(0, 255);
    if (!name) throw badRequest("Nama berkas wajib diisi.");
    const rows = await this.sql<ImportBatch[]>`
      insert into import_batches (filename, default_kind, created_by) values (${name}, ${defaultKind}, ${userId})
      returning ${BATCH_COLUMNS(this.sql)}`;
    return rows[0]!;
  }

  async get(id: string): Promise<ImportBatch> {
    if (!/^\d+$/.test(id)) throw notFound("Impor tidak ditemukan.");
    const rows = await this.sql<ImportBatch[]>`select ${BATCH_COLUMNS(this.sql)} from import_batches where id = ${id}`;
    if (!rows[0]) throw notFound("Impor tidak ditemukan.");
    return rows[0];
  }

  async list(): Promise<ImportBatch[]> {
    return this.sql<ImportBatch[]>`
      select ${BATCH_COLUMNS(this.sql)} from import_batches order by id desc limit 50`;
  }

  /** Membatalkan batch: seluruh lokasi dari impor ini dihapus dalam satu pernyataan. */
  async cancel(id: string): Promise<{ removed: number }> {
    const batch = await this.get(id);
    if (batch.status === "dibatalkan") return { removed: 0 };
    await this.sql`update import_batches set status = 'dibatalkan', finished_at = coalesce(finished_at, now()) where id = ${id}`;
    const rows = await this.sql`delete from locations where import_batch_id = ${id} returning id`;
    return { removed: rows.length };
  }

  /** Memproses isi berkas secara bertahap. Memori tetap konstan berapa pun ukuran berkas. */
  async run(id: string, body: AsyncIterable<Buffer | string>, userId: string | null): Promise<ImportBatch> {
    const sql = this.sql;
    const batch = await this.get(id);
    if (batch.status !== "menunggu") throw conflict("Berkas untuk impor ini sudah pernah diproses.");
    await sql`update import_batches set status = 'berjalan' where id = ${id}`;

    const errors: ImportBatch["errors"] = [];
    let total = 0;
    let inserted = 0;
    let added = 0;
    let updated = 0;
    let failed = 0;
    let rowNumber = 0;
    let headers: string[] | null = null;
    let mapping: Record<MappedField, number> | null = null;
    let chunk: StagedRow[] = [];
    let bytes = 0;
    let aborted = false;

    const addError = (row: number, message: string) => {
      failed++;
      if (errors.length < MAX_STORED_ERRORS) errors.push({ row, message });
    };

    const flush = async () => {
      if (chunk.length === 0) return;
      const rows = chunk;
      chunk = [];
      const status = await sql<{ status: string }[]>`select status from import_batches where id = ${id}`;
      if (status[0]?.status === "dibatalkan") {
        aborted = true;
        return;
      }
      await sql.begin(async (tx) => {
        await tx`
          create temp table stg (
            kind text, name text, category text, level text, npsn text, address text, description text, founded_year int, photo_url text,
            students int, teachers int, attributes text, lat float8, lng float8, province text, city text, district text
          ) on commit drop`;
        const writable = await tx`
          copy stg (kind, name, category, level, npsn, address, description, founded_year, photo_url, students, teachers,
            attributes, lat, lng, province, city, district) from stdin`.writable();
        await pipeline(
          Readable.from(
            (function* () {
              for (const r of rows) {
                yield `${[r.kind, r.name, r.category, r.level, r.npsn, r.address, r.description, r.foundedYear, r.photoUrl, r.students, r.teachers, r.attributes, r.lat, r.lng, r.province, r.city, r.district].map(copyField).join("\t")}\n`;
              }
            })(),
          ),
          writable,
        );
        // Baris ber-NPSN yang sudah ada diperbarui (tarik ulang data Dapodik tidak menggandakan). Ganda dalam satu
        // bongkahan diambil yang terakhir.
        const res = await tx<{ inserted: boolean }[]>`
          with numbered as (select *, row_number() over () as rn from stg),
          uniq as (
            select * from numbered where npsn is null
            union all
            (select distinct on (npsn) * from numbered where npsn is not null order by npsn, rn desc)
          )
          insert into locations (kind, name, category, level, npsn, address, description, founded_year, photo_url, students, teachers,
            attributes, geom, province, city, district, import_batch_id, created_by, updated_by, coord_source)
          select kind, name, category, level, npsn, address, description, founded_year, photo_url, students, teachers,
            attributes::jsonb, case when lng is null then null else ST_SetSRID(ST_MakePoint(lng, lat), 4326) end, province, city, district,
            ${id}, ${userId}, ${userId}, case when lng is null then 'none' else 'import' end
          from uniq
          on conflict (npsn) where npsn is not null do update set
            name = excluded.name, category = excluded.category, level = coalesce(excluded.level, locations.level),
            address = coalesce(nullif(excluded.address, ''), locations.address),
            description = coalesce(excluded.description, locations.description),
            founded_year = coalesce(excluded.founded_year, locations.founded_year),
            students = coalesce(excluded.students, locations.students), teachers = coalesce(excluded.teachers, locations.teachers),
            attributes = locations.attributes || excluded.attributes,
            -- Koordinat dari impor tidak menimpa koordinat yang sudah diperiksa manual, dan baris tanpa koordinat tidak menghapusnya.
            geom = case when excluded.geom is not null and locations.coord_source <> 'manual' then excluded.geom else locations.geom end,
            coord_source = case when excluded.geom is not null and locations.coord_source <> 'manual' then 'import' else locations.coord_source end,
            province = excluded.province, city = excluded.city, district = excluded.district,
            updated_by = excluded.updated_by, version = locations.version + 1, updated_at = now()
          returning (xmax = 0) as inserted`;
        added += res.filter((r) => r.inserted).length;
        updated += res.filter((r) => !r.inserted).length;
      });
      inserted = added;
      await sql`update import_batches set total = ${total}, inserted = ${inserted}, updated = ${updated}, failed = ${failed}, errors = ${sql.json(errors)} where id = ${id}`;
    };

    const handleRow = (row: string[]): string | null => {
      if (!headers) {
        headers = row.map((h) => h.trim());
        mapping = mapHeaders(headers);
        const missing = (["name"] as const).filter((f) => mapping![f] === -1);
        if (missing.length) return `Kolom wajib tidak ditemukan: ${missing.map((f) => FIELD_LABEL[f]).join(", ")}.`;
        return null;
      }
      rowNumber++;
      total++;
      const raw = rowToRaw(row, headers, mapping!, { kind: batch.defaultKind });
      const v = validateLocationInput(raw);
      if (!v.ok) {
        addError(rowNumber + 1, Object.values(v.errors).join(" "));
        return null;
      }
      const geo = parseAddress(v.value.address);
      chunk.push({
        kind: v.value.kind,
        name: v.value.name,
        category: v.value.category,
        level: v.value.level,
        npsn: v.value.npsn,
        address: v.value.address,
        description: v.value.description,
        foundedYear: v.value.foundedYear,
        photoUrl: v.value.photoUrl,
        students: v.value.students,
        teachers: v.value.teachers,
        attributes: JSON.stringify(v.value.attributes),
        lat: v.value.latitude,
        lng: v.value.longitude,
        province: v.value.province ?? geo.province,
        city: v.value.city ?? geo.city,
        district: v.value.district ?? geo.district,
      });
      return null;
    };

    try {
      const parser = new CsvParser();
      const decoder = new TextDecoder("utf-8");
      const consume = async (rows: string[][]) => {
        for (const row of rows) {
          const fatal = handleRow(row);
          if (fatal) throw badRequest(fatal);
          if (chunk.length >= CHUNK_ROWS) await flush();
          if (aborted) return;
        }
      };
      for await (const part of body) {
        const buf = typeof part === "string" ? Buffer.from(part) : part;
        bytes += buf.length;
        if (bytes > this.maxBytes) throw new HttpError(413, "too_large", "Berkas melebihi batas ukuran unggahan.");
        await consume(parser.push(decoder.decode(buf, { stream: true })));
        if (aborted) break;
      }
      if (!aborted) {
        await consume([...parser.push(decoder.decode()), ...parser.end()]);
        await flush();
      }
      if (!headers) throw badRequest("Berkas kosong.");
      if (aborted) {
        await sql`delete from locations where import_batch_id = ${id}`;
        return this.get(id);
      }
      const rows = await sql<ImportBatch[]>`
        update import_batches set status = 'selesai', total = ${total}, inserted = ${inserted}, updated = ${updated}, failed = ${failed},
          errors = ${sql.json(errors)}, finished_at = now()
        where id = ${id} returning ${BATCH_COLUMNS(sql)}`;
      return rows[0]!;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Impor gagal.";
      await sql`
        update import_batches set status = 'gagal', message = ${message}, total = ${total}, inserted = ${inserted}, updated = ${updated},
          failed = ${failed}, errors = ${sql.json(errors)}, finished_at = now() where id = ${id}`;
      throw e;
    }
  }
}
