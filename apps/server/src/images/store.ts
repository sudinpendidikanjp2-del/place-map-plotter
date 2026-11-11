import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { HttpError, badRequest } from "../http/errors.ts";

export type Variant = "full" | "thumb";
export const MAX_BYTES: Record<Variant, number> = { full: 6 * 1024 * 1024, thumb: 400 * 1024 };

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/** Mengenali jenis gambar dari byte awal berkas, bukan dari klaim klien. */
export function sniffMime(head: Buffer): ImageMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Penyimpanan gambar di berkas, dibagi per dua digit terakhir id agar satu folder tidak menampung jutaan berkas. */
export class ImageStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private path(id: string, variant: Variant): string {
    return join(this.dir, id.slice(-2).padStart(2, "0"), `${id}.${variant}`);
  }

  async write(id: string, variant: Variant, body: Readable | AsyncIterable<Buffer | string>, expect: ImageMime): Promise<number> {
    const target = this.path(id, variant);
    await mkdir(join(this.dir, id.slice(-2).padStart(2, "0")), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    const out = createWriteStream(tmp, { flags: "w" });
    let bytes = 0;
    let first = true;
    const limit = MAX_BYTES[variant];
    try {
      for await (const part of body) {
        const chunk = typeof part === "string" ? Buffer.from(part) : part;
        if (first) {
          first = false;
          if (sniffMime(chunk) !== expect) throw badRequest("Isi berkas bukan gambar yang sesuai dengan jenis yang dinyatakan.");
        }
        bytes += chunk.length;
        if (bytes > limit) throw new HttpError(413, "too_large", `Gambar melebihi batas ${Math.round(limit / 1024)} KB.`);
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", resolve));
      }
      if (bytes === 0) throw badRequest("Berkas gambar kosong.");
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
      await rename(tmp, target);
      return bytes;
    } catch (e) {
      out.destroy();
      await rm(tmp, { force: true });
      throw e;
    }
  }

  open(id: string, variant: Variant): Readable {
    return createReadStream(this.path(id, variant));
  }

  async size(id: string, variant: Variant): Promise<number | null> {
    try {
      return (await stat(this.path(id, variant))).size;
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    await Promise.all((["full", "thumb"] as const).map((v) => rm(this.path(id, v), { force: true })));
  }

  /** Daftar id gambar yang berkasnya ada di disk. */
  async listIds(): Promise<string[]> {
    const ids = new Set<string>();
    let shards: string[];
    try {
      shards = await readdir(this.dir);
    } catch {
      return [];
    }
    for (const shard of shards) {
      for (const file of await readdir(join(this.dir, shard)).catch(() => [])) {
        const m = file.match(/^(\d+)\.(full|thumb)$/);
        if (m) ids.add(m[1]!);
      }
    }
    return [...ids];
  }
}
