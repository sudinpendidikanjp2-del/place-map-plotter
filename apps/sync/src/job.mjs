// Satu kali penarikan: kumpulkan, normalkan, jaga, impor, lalu lapor. Dipakai oleh CLI dan mode daemon.
import fs from "node:fs";
import path from "node:path";
import { collectDapodik, ServerTroubleError } from "./dapodik.mjs";
import { toCsv } from "./csv.mjs";
import { COLUMNS, mapSchool } from "./mapper.mjs";
import { checkAgainstPrevious } from "./guard.mjs";
import { normalizeCity, normalizeProvince } from "./normalize.mjs";

export const SOURCE = "dapodik";

/** Sekolah berdetail dipetakan penuh. Sekolah yang detailnya belum terambil tetap masuk dengan data dasar dari daftar kecamatan. */
export function buildRows(result, cfg) {
  const inContext = (r) =>
    normalizeProvince(r.provinsi) === normalizeProvince(cfg.provinsi) && normalizeCity(r.kabupaten) === normalizeCity(cfg.kabupaten);
  const full = result.details.filter(inContext).map((d) => mapSchool(d)).filter(Boolean);
  const basic = (result.basics ?? [])
    .map((b) => mapSchool({ ...b, kecamatan: b.__kecamatan, kabupaten: cfg.kabupaten, provinsi: cfg.provinsi }, { basic: true }))
    .filter(Boolean);
  return { full, basic, rows: [...full, ...basic], skippedBasic: (result.basics ?? []).length - basic.length };
}

/**
 * @returns {Promise<{ code: number, status: string }>} code = kode keluar untuk CLI
 */
export async function executeRun({ cfg, client, runId, outDir, dry = false, log = console.log, scope = cfg.scopeLabel }) {
  const report = async (result) => {
    if (client && runId) await client.finishRun(runId, result).catch((e) => log(`Gagal melapor: ${e.message}`));
  };
  try {
    let previousSeen = 0;
    if (client) previousSeen = (await client.listRuns(SOURCE)).lastSuccess?.schoolsSeen ?? 0;
    if (client && !runId) runId = (await client.startRun(SOURCE, scope)).id;

    let lastReport = 0;
    const onProgress = (p) => {
      if (Date.now() - lastReport < 15_000) return;
      lastReport = Date.now();
      void report({ status: "berjalan", message: `Tahap 2: detail ${p.done}/${p.total} sekolah (gagal ${p.failed})` });
    };
    await report({ status: "berjalan", message: "Tahap 1: mengambil daftar sekolah" });

    let result;
    try {
      result = await collectDapodik(cfg, log, onProgress);
    } catch (err) {
      log(`\n${err.message}\n`);
      await report({ status: "gagal", message: String(err.message).slice(0, 900), schoolsSeen: err.partial?.schoolsSeen ?? 0, failed: err.partial?.failed?.length ?? 0 });
      return { code: err instanceof ServerTroubleError ? 3 : 1, status: "gagal" };
    }

    const { full, basic, rows, skippedBasic } = buildRows(result, cfg);
    log(`Sekolah masuk: ${rows.length} (${full.length} berdetail lengkap, ${basic.length} hanya data dasar${skippedBasic ? `, ${skippedBasic} dilewati karena nama tidak terbaca` : ""}).`);

    const verdict = checkAgainstPrevious({ seen: rows.length, previousSeen });
    if (!verdict.ok) {
      log(`Hasil ditolak: ${verdict.reason}`);
      await report({ status: "ditolak", message: verdict.reason, schoolsSeen: rows.length, failed: result.failed.length });
      return { code: 4, status: "ditolak" };
    }

    const csv = toCsv(COLUMNS, rows);
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `dapodik-${cfg.scopeLabel.replace(/\W+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.writeFileSync(file, `﻿${csv}`);
    log(`CSV: ${file}`);
    if (dry) {
      log("Mode uji: tidak dikirim ke Peta Sekolah.");
      return { code: 0, status: "selesai" };
    }

    const imported = await client.importCsv(path.basename(file), csv);
    log(`Diimpor: ${imported.inserted} baru, ${imported.updated} diperbarui, ${imported.failed} dilewati.`);
    const notes = [];
    if (basic.length) notes.push(`${basic.length} sekolah hanya data dasar karena detailnya belum terambil${result.stopped ? ` (${result.stopped})` : ""}; dilengkapi pada penarikan berikutnya.`);
    else if (result.failed.length) notes.push(`${result.failed.length} sekolah gagal diambil detailnya.`);
    await report({
      status: "selesai",
      schoolsSeen: rows.length,
      inserted: imported.inserted,
      updated: imported.updated,
      failed: imported.failed + result.failed.length,
      importBatchId: imported.id,
      message: notes.join(" ") || null,
    });
    return { code: 0, status: "selesai" };
  } catch (err) {
    log(err.message);
    await report({ status: "gagal", message: String(err.message).slice(0, 900) });
    return { code: 1, status: "gagal" };
  }
}
