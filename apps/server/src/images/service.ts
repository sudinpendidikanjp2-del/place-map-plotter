import type { LocationImage } from "@peta/domain";
import type { Sql } from "../db/client.ts";
import { badRequest, notFound } from "../http/errors.ts";
import { ImageStore, type ImageMime, type Variant } from "./store.ts";

export const MAX_IMAGES_PER_LOCATION = 8;
const MIMES: ImageMime[] = ["image/jpeg", "image/png", "image/webp"];

export class ImageService {
  private readonly sql: Sql;
  readonly store: ImageStore;

  constructor(sql: Sql, store: ImageStore) {
    this.sql = sql;
    this.store = store;
  }

  async create(locationId: string, input: { mime: unknown; width: unknown; height: unknown; caption?: unknown }, userId: string): Promise<{ id: string }> {
    if (!/^\d+$/.test(locationId)) throw notFound("Lokasi tidak ditemukan.");
    const mime = input.mime as ImageMime;
    const width = Number(input.width);
    const height = Number(input.height);
    if (!MIMES.includes(mime)) throw badRequest("Jenis gambar harus JPEG, PNG, atau WebP.");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000) throw badRequest("Ukuran gambar tidak valid.");
    const caption = typeof input.caption === "string" && input.caption.trim() ? input.caption.trim().slice(0, 200) : null;
    const exists = await this.sql`select 1 from locations where id = ${locationId}`;
    if (exists.length === 0) throw notFound("Lokasi tidak ditemukan.");
    const count = await this.sql<{ n: number }[]>`select count(*)::int as n from location_images where location_id = ${locationId}`;
    if (count[0]!.n >= MAX_IMAGES_PER_LOCATION) throw badRequest(`Satu lokasi maksimal ${MAX_IMAGES_PER_LOCATION} gambar.`);
    const rows = await this.sql<{ id: string }[]>`
      insert into location_images (location_id, mime, width, height, caption, position, created_by)
      values (${locationId}, ${mime}, ${width}, ${height}, ${caption}, ${count[0]!.n}, ${userId}) returning id::text`;
    return rows[0]!;
  }

  async meta(id: string): Promise<{ id: string; locationId: string; mime: ImageMime; ready: boolean }> {
    if (!/^\d+$/.test(id)) throw notFound("Gambar tidak ditemukan.");
    const rows = await this.sql<{ id: string; locationId: string; mime: ImageMime; ready: boolean }[]>`
      select id::text, location_id::text, mime, ready from location_images where id = ${id}`;
    if (!rows[0]) throw notFound("Gambar tidak ditemukan.");
    return rows[0];
  }

  async receive(id: string, variant: Variant, body: AsyncIterable<Buffer | string>): Promise<{ ready: boolean }> {
    const m = await this.meta(id);
    const bytes = await this.store.write(id, variant, body, m.mime);
    const rows = variant === "full"
      ? await this.sql<{ ready: boolean }[]>`update location_images set bytes = ${bytes}, ready = (thumb_bytes > 0) where id = ${id} returning ready`
      : await this.sql<{ ready: boolean }[]>`update location_images set thumb_bytes = ${bytes}, ready = (bytes > 0) where id = ${id} returning ready`;
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.meta(id);
    await this.sql`delete from location_images where id = ${id}`;
    await this.store.remove(id);
  }

  async list(locationId: string): Promise<LocationImage[]> {
    return this.sql<LocationImage[]>`
      select id::text, width, height, caption from location_images where location_id = ${locationId} and ready order by position, id`;
  }

  async idsForLocations(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.sql<{ id: string }[]>`select id::text from location_images where location_id = any(${ids.map(Number)}::bigint[])`;
    return rows.map((r) => r.id);
  }

  /** Menghapus berkas yatim (lokasinya sudah dihapus) dan unggahan setengah jadi yang lebih dari satu jam. */
  async sweep(): Promise<number> {
    await this.sql`delete from location_images where not ready and created_at < now() - interval '1 hour'`;
    const onDisk = await this.store.listIds();
    let removed = 0;
    for (let i = 0; i < onDisk.length; i += 5000) {
      const batch = onDisk.slice(i, i + 5000);
      const known = new Set((await this.sql<{ id: string }[]>`select id::text from location_images where id = any(${batch.map(Number)}::bigint[])`).map((r) => r.id));
      for (const id of batch) if (!known.has(id)) {
        await this.store.remove(id);
        removed++;
      }
    }
    return removed;
  }
}
