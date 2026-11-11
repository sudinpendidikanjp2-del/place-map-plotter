import type { Sql } from "../db/client.ts";
import { badRequest, notFound } from "../http/errors.ts";

export interface SyncRun {
  id: string;
  source: string;
  scope: string;
  status: "berjalan" | "selesai" | "gagal" | "ditolak";
  schoolsSeen: number;
  inserted: number;
  updated: number;
  failed: number;
  message: string | null;
  importBatchId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const COLS = (sql: Sql) => sql`
  id::text, source, scope, status, schools_seen, inserted, updated, failed, message, import_batch_id::text, started_at, finished_at`;

const STATUSES = ["berjalan", "selesai", "gagal", "ditolak"] as const;

function int(v: unknown): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 100_000_000 ? n : 0;
}

/** Riwayat penarikan data dari sumber luar, dilaporkan oleh pekerja terjadwal. */
export class SyncService {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async start(input: { source?: unknown; scope?: unknown }): Promise<SyncRun> {
    const source = String(input.source ?? "").trim().slice(0, 40);
    const scope = String(input.scope ?? "").trim().slice(0, 200);
    if (!source || !scope) throw badRequest("Sumber dan cakupan wajib diisi.");
    // Eksekusi lama yang tidak pernah ditutup (pekerja mati) ditandai gagal agar tidak menggantung.
    await this.sql`update sync_runs set status = 'gagal', message = 'Pekerja berhenti tanpa melapor.', finished_at = now()
      where source = ${source} and status = 'berjalan' and started_at < now() - interval '12 hours'`;
    const rows = await this.sql<SyncRun[]>`insert into sync_runs (source, scope) values (${source}, ${scope}) returning ${COLS(this.sql)}`;
    return rows[0]!;
  }

  async finish(id: string, input: Record<string, unknown>): Promise<SyncRun> {
    if (!/^\d+$/.test(id)) throw notFound("Eksekusi tidak ditemukan.");
    const status = String(input.status ?? "");
    if (!(STATUSES as readonly string[]).includes(status)) throw badRequest("Status tidak dikenal.");
    const batch = input.importBatchId !== undefined && /^\d+$/.test(String(input.importBatchId)) ? String(input.importBatchId) : null;
    const rows = await this.sql<SyncRun[]>`
      update sync_runs set status = ${status}, schools_seen = ${int(input.schoolsSeen)}, inserted = ${int(input.inserted)},
        updated = ${int(input.updated)}, failed = ${int(input.failed)}, message = ${input.message ? String(input.message).slice(0, 1000) : null},
        import_batch_id = ${batch}, finished_at = case when ${status} = 'berjalan' then null else now() end
      where id = ${id} returning ${COLS(this.sql)}`;
    if (!rows[0]) throw notFound("Eksekusi tidak ditemukan.");
    return rows[0];
  }

  async list(source?: string): Promise<{ items: SyncRun[]; lastSuccess: SyncRun | null }> {
    const items = await this.sql<SyncRun[]>`
      select ${COLS(this.sql)} from sync_runs ${source ? this.sql`where source = ${source}` : this.sql``} order by id desc limit 30`;
    const last = await this.sql<SyncRun[]>`
      select ${COLS(this.sql)} from sync_runs where status = 'selesai' ${source ? this.sql`and source = ${source}` : this.sql``} order by id desc limit 1`;
    return { items, lastSuccess: last[0] ?? null };
  }
}
