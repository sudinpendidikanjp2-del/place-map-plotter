// Menarik data Dapodik untuk satu wilayah lalu mengirimnya ke Peta Sekolah.
// Pemakaian:  PETA_URL=https://peta.contoh.go.id PETA_TOKEN=peta_... node src/run.mjs [--dry | --daemon]
// --daemon: tetap berjalan, mengambil permintaan "Sinkronkan sekarang" dari web, dan menarik terjadwal tiap SYNC_EVERY_HOURS (bawaan 168, 0 = mati).
import { PetaClient } from "./client.mjs";
import { SOURCE, executeRun } from "./job.mjs";

const env = process.env;
const dry = process.argv.includes("--dry");
const daemon = process.argv.includes("--daemon");
const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const cfg = {
  base: env.DAPODIK_URL ?? "https://dapo.kemendikdasmen.go.id",
  kodeProvinsi: env.DAPODIK_KODE_PROVINSI ?? "010000",
  kodeKabupaten: env.DAPODIK_KODE_KABUPATEN ?? "016000",
  kecamatan: list(env.DAPODIK_KECAMATAN),
  // Konteks dipakai untuk membuang detail yang ternyata dari wilayah lain.
  provinsi: env.DAPODIK_PROVINSI ?? "Prov. D.K.I. Jakarta",
  kabupaten: env.DAPODIK_KABUPATEN ?? "Kota Adm. Jakarta Pusat",
  scopeLabel: env.SCOPE_LABEL ?? "Jakarta Pusat",
  headless: env.HEADLESS !== "false",
  delayMinMs: Number(env.DELAY_MIN_MS ?? 4000),
  delayMaxMs: Number(env.DELAY_MAX_MS ?? 7000),
  refreshDays: Number(env.REFRESH_DAYS ?? 7),
  maxPerRun: Number(env.MAX_PER_RUN ?? 0),
  cacheDir: env.CACHE_DIR ?? "cache",
  retry: Number(env.RETRY ?? 2),
  backoffMs: Number(env.BACKOFF_MS ?? 60_000),
  maxConsecutiveFail: Number(env.MAX_CONSECUTIVE_FAIL ?? 5),
};
const outDir = env.OUT_DIR ?? "out";

if (!dry && (!env.PETA_URL || !env.PETA_TOKEN)) {
  console.error("PETA_URL dan PETA_TOKEN wajib diisi (atau jalankan dengan --dry untuk hanya membuat CSV lokal).");
  process.exit(2);
}
const client = dry ? null : new PetaClient(env.PETA_URL, env.PETA_TOKEN);

if (!daemon) {
  const { code } = await executeRun({ cfg, client, runId: null, outDir, dry });
  process.exit(code);
}

// ---------- Mode daemon ----------
const pollMs = Number(env.POLL_SECONDS ?? 30) * 1000;
const everyMs = Number(env.SYNC_EVERY_HOURS ?? 168) * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (stopping = true));
console.log(`Pekerja menunggu permintaan (cek tiap ${pollMs / 1000} detik${everyMs ? `, terjadwal tiap ${everyMs / 3_600_000} jam` : ", tanpa jadwal"}).`);

let lastFinished = 0;
while (!stopping) {
  try {
    const { run } = await client.claim(SOURCE, cfg.scopeLabel);
    if (run) {
      console.log(`Permintaan dari web diterima (eksekusi ${run.id}).`);
      await executeRun({ cfg, client, runId: run.id, outDir, scope: cfg.scopeLabel });
      lastFinished = Date.now();
    } else if (everyMs) {
      const last = (await client.listRuns(SOURCE)).items.find((r) => r.status !== "menunggu");
      const lastAt = last ? new Date(last.finishedAt ?? last.startedAt).getTime() : 0;
      if (last?.status !== "berjalan" && Date.now() - Math.max(lastAt, lastFinished) >= everyMs) {
        console.log("Waktunya penarikan terjadwal.");
        await executeRun({ cfg, client, runId: null, outDir, scope: cfg.scopeLabel });
        lastFinished = Date.now();
      }
    }
  } catch (err) {
    console.error(`Gagal menghubungi Peta Sekolah: ${err.message}`);
  }
  await sleep(pollMs);
}
