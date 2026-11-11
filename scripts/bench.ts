// Benchmark skala terhadap data sintetis. Pemakaian: DATABASE_URL=... node scripts/bench.ts
// Jalankan `node scripts/seed.ts 1000000 --reset` lebih dulu.
import type { AddressInfo } from "node:net";
import { createApp } from "../apps/server/src/app.ts";
import { loadConfig } from "../apps/server/src/config.ts";
import { createSql } from "../apps/server/src/db/client.ts";
import { migrate } from "../apps/server/src/db/migrate.ts";
import { createUser } from "../apps/server/src/auth/users.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum diatur.");
const sql = createSql(url, 10);
await migrate(sql);
const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from locations`;
await sql`delete from users where email = 'bench@contoh.id'`;
await createUser(sql, { email: "bench@contoh.id", name: "Bench", role: "viewer", password: "kata-sandi-bench-1" });
const app = createApp(loadConfig({ DATABASE_URL: url, WEB_DIST: "/x" } as NodeJS.ProcessEnv), sql, { trustProxy: false });
await new Promise<void>((r) => app.server.listen(0, r));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ email: "bench@contoh.id", password: "kata-sandi-bench-1" }) });
const cookie = login.headers.get("set-cookie")!.split(";")[0]!;

async function time(path: string): Promise<number> {
  const t = performance.now();
  const res = await fetch(base + path, { headers: { cookie } });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return performance.now() - t;
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

const cases: [string, () => string][] = [
  ["cluster, seluruh Indonesia, zoom 5", () => "/api/locations/clusters?west=94&south=-11&east=141&north=6&zoom=5"],
  ["cluster, satu provinsi, zoom 9", () => { const x = Math.random() * 0.2; return `/api/locations/clusters?west=${106.5 + x}&south=-7&east=${107.5 + x}&north=-6&zoom=9`; }],
  ["cluster, satu kota, zoom 13", () => { const x = Math.random() * 0.05; return `/api/locations/clusters?west=${106.75 + x}&south=-6.25&east=${106.9 + x}&north=-6.13&zoom=13`; }],
  ["cluster dengan filter kategori", () => "/api/locations/clusters?west=94&south=-11&east=141&north=6&zoom=6&category=SD"],
  ["daftar halaman pertama (50 baris)", () => "/api/locations?limit=50"],
  ["daftar dengan filter provinsi dan kota", () => "/api/locations?limit=50&province=Jawa%20Barat&city=Kota%20Bandung"],
  ["pencarian teks (trigram)", () => `/api/locations?limit=20&q=${encodeURIComponent("Uji " + Math.floor(Math.random() * 900000 + 100000))}`],
  ["filter lingkaran 5 km", () => "/api/locations?limit=50&circle=-6.19,106.83,5000"],
  ["ringkasan laporan seluruh data", () => "/api/reports/summary"],
  ["ringkasan area peta", () => "/api/reports/summary?west=106.5&south=-7&east=107.5&north=-6"],
];
const COLD = 12;
const WARM = 30;
console.log(`Data: ${n.toLocaleString("id-ID")} lokasi. Dingin = cache hasil dikosongkan sebelum tiap permintaan (${COLD}x). Hangat = hasil sudah di cache (${WARM}x).\n`);
console.log("kasus".padEnd(44), "dingin p50".padStart(11), "dingin p95".padStart(11), "hangat p95".padStart(11));
for (const [name, mk] of cases.filter(([nm]) => !process.env.BENCH_ONLY || nm.includes(process.env.BENCH_ONLY))) {
  await time(mk());
  const cold: number[] = [];
  for (let i = 0; i < COLD; i++) {
    await sql`update data_version set version = version + 1`;
    cold.push(await time(mk()));
  }
  if (process.env.BENCH_DEBUG) console.log("dingin:", cold.map((x) => x.toFixed(0)).join(" "));
  const warm: number[] = [];
  for (let i = 0; i < WARM; i++) warm.push(await time(mk()));
  console.log(name.padEnd(44), `${pct(cold, 0.5).toFixed(0)} ms`.padStart(11), `${pct(cold, 0.95).toFixed(0)} ms`.padStart(11), `${pct(warm, 0.95).toFixed(0)} ms`.padStart(11));
}

// Ekspor CSV mengalir: waktu sampai byte pertama dan total
{
  const t = performance.now();
  const res = await fetch(`${base}/api/export/csv?province=Jawa%20Barat`, { headers: { cookie } });
  const reader = res.body!.getReader();
  const first = await reader.read();
  const tFirst = performance.now() - t;
  let bytes = first.value?.length ?? 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
  }
  console.log(`\nEkspor CSV satu provinsi: byte pertama ${tFirst.toFixed(0)} ms, total ${((performance.now() - t) / 1000).toFixed(1)} s, ${(bytes / 1048576).toFixed(0)} MB`);
}
await app.close();
await sql.end();
