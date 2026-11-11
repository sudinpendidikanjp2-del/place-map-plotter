import { readdir, readFile } from "node:fs/promises";
import type { Sql } from "./client.ts";

const DIR = new URL("./migrations/", import.meta.url);
const LOCK_KEY = 727_001;

/** Menjalankan berkas .sql berurutan yang belum tercatat. Aman dijalankan bersamaan lewat advisory lock. */
export async function migrate(sql: Sql): Promise<string[]> {
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await readFile(new URL(file, DIR), "utf8"));
      await tx`insert into schema_migrations (name) values (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
