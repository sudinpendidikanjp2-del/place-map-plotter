import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { start } from "./helpers.ts";

let hasPlaywright = true;
try {
  createRequire(new URL("../../sync/package.json", import.meta.url))("playwright");
} catch {
  hasPlaywright = false;
}
// @ts-expect-error mjs
import { startFakePortal } from "../../sync/test/fake-portal.mjs";

test("daemon menjalankan permintaan dari web sampai impor selesai, walau detail HTTP 500", { skip: !hasPlaywright && "Playwright pekerja tidak terpasang" }, async () => {
  const h = await start({});
  const portal = await startFakePortal({ perKecamatan: 3, behavior: { detailStatus: 500 } });
  const admin = await h.client("admin");
  await h.sql`truncate locations, import_batches, sync_runs, sync_workers, api_tokens restart identity cascade`;
  const made = (await admin.json("/api/tokens", { method: "POST", json: { name: "d" } })).body;
  const p = spawn("node", ["src/run.mjs", "--daemon"], { cwd: new URL("../../sync/", import.meta.url).pathname, env: { ...process.env, PETA_URL: h.base, PETA_TOKEN: made.token, DAPODIK_URL: portal.url, POLL_SECONDS: "1", SYNC_EVERY_HOURS: "0", DELAY_MIN_MS: "1", DELAY_MAX_MS: "2", MAX_CONSECUTIVE_FAIL: "2", RETRY: "0", BACKOFF_MS: "1", CACHE_DIR: `/tmp/dcache${Date.now()}`, OUT_DIR: `/tmp/dout${Date.now()}` }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  try {
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await admin.json("/api/sync/request", { method: "POST" })).status, 201);
    let run: any;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      run = (await admin.json("/api/sync/runs?source=dapodik")).body.items[0];
      if (run && !["menunggu", "berjalan"].includes(run.status)) break;
    }
    assert.ok(out.length > 0);
    assert.equal(run.status, "selesai");
    assert.equal(run.inserted, 6);
    assert.equal((await h.sql`select count(*)::int n from locations where district = 'Senen'`)[0]!.n, 3);
  } finally { p.kill(); await portal.close(); await h.close(); }
});
