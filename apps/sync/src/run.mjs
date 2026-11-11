// Menarik data Dapodik untuk satu wilayah lalu mengirimnya ke Peta Sekolah.
// Pemakaian:  PETA_URL=https://peta.contoh.go.id PETA_TOKEN=peta_... node src/run.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { collectDapodik, ServerTroubleError } from "./dapodik.mjs";
import { toCsv } from "./csv.mjs";
import { COLUMNS, mapSchool } from "./mapper.mjs";
import { checkAgainstPrevious } from "./guard.mjs";
import { normalizeCity, normalizeProvince } from "./normalize.mjs";
import { PetaClient } from "./client.mjs";

const env = process.env;
const dry = process.argv.includes("--dry");
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
};
const outDir = env.OUT_DIR ?? "out";
const SOURCE = "dapodik";

if (!dry && (!env.PETA_URL || !env.PETA_TOKEN)) {
  console.error("PETA_URL dan PETA_TOKEN wajib diisi (atau jalankan dengan --dry untuk hanya membuat CSV lokal).");
  process.exit(2);
}
const client = dry ? null : new PetaClient(env.PETA_URL, env.PETA_TOKEN);

async function report(runId, result) {
  if (client && runId) await client.finishRun(runId, result).catch((e) => console.error(`Gagal melapor: ${e.message}`));
}

let runId = null;
try {
  let previousSeen = 0;
  if (client) {
    const prior = await client.listRuns(SOURCE);
    previousSeen = prior.lastSuccess?.schoolsSeen ?? 0;
    runId = (await client.startRun(SOURCE, cfg.scopeLabel)).id;
  }

  let result;
  try {
    result = await collectDapodik(cfg);
  } catch (err) {
    const partial = err.partial;
    console.error(`\n${err.message}\n`);
    await report(runId, { status: "gagal", message: err.message, schoolsSeen: partial?.schoolsSeen ?? 0, failed: partial?.failed?.length ?? 0 });
    process.exit(err instanceof ServerTroubleError ? 3 : 1);
  }

  const inContext = (r) =>
    normalizeProvince(r.provinsi) === normalizeProvince(cfg.provinsi) && normalizeCity(r.kabupaten) === normalizeCity(cfg.kabupaten);
  const rows = result.details.filter(inContext).map(mapSchool).filter(Boolean);
  console.log(`Sekolah sesuai wilayah dan lengkap: ${rows.length} dari ${result.details.length} detail (${result.failed.length} gagal diambil).`);

  const verdict = checkAgainstPrevious({ seen: rows.length, previousSeen });
  if (!verdict.ok) {
    console.error(`Hasil ditolak: ${verdict.reason}`);
    await report(runId, { status: "ditolak", message: verdict.reason, schoolsSeen: rows.length, failed: result.failed.length });
    process.exit(4);
  }

  const csv = toCsv(COLUMNS, rows);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `dapodik-${cfg.scopeLabel.replace(/\W+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, `﻿${csv}`);
  console.log(`CSV: ${file}`);

  if (dry) {
    console.log("Mode uji: tidak dikirim ke Peta Sekolah.");
  } else {
    const imported = await client.importCsv(path.basename(file), csv);
    console.log(`Diimpor: ${imported.inserted} baru, ${imported.updated} diperbarui, ${imported.failed} dilewati.`);
    await report(runId, {
      status: "selesai",
      schoolsSeen: rows.length,
      inserted: imported.inserted,
      updated: imported.updated,
      failed: imported.failed + result.failed.length,
      importBatchId: imported.id,
      message: result.failed.length ? `${result.failed.length} sekolah gagal diambil dan dilewati.` : null,
    });
  }
} catch (err) {
  console.error(err.message);
  await report(runId, { status: "gagal", message: String(err.message).slice(0, 900) });
  process.exit(1);
}
