// Pengumpul data Dapodik lewat otomasi peramban. Semua data diambil dari respons yang dipanggil halaman portal itu
// sendiri saat dibuka seperti pengguna biasa. Tidak ada token yang dibaca atau dipakai ulang di luar halaman,
// tidak ada penyamaran peramban, dan tidak ada upaya melewati tantangan akses: bila portal menolak (401, 403, 429),
// pengumpul berhenti dan melapor.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { latestDetail } from "./mapper.mjs";

export class ServerTroubleError extends Error {}

const BLOCK_TYPES = new Set(["image", "font", "stylesheet", "media"]);
const BLOCK_HOSTS = /google-analytics|googletagmanager|histats|doubleclick|facebook/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function extractRows(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  for (const k of ["data", "rows", "result", "results", "items", "sekolah", "kecamatan"]) {
    if (Array.isArray(json[k])) return json[k];
    if (json[k] && typeof json[k] === "object") {
      const inner = extractRows(json[k]);
      if (inner.length) return inner;
    }
  }
  return [];
}

export function totalPagesOf(json) {
  if (!json || typeof json !== "object") return 1;
  const src = { ...json, ...(json.meta || {}), ...(json.pagination || {}) };
  for (const k of ["last_page", "lastPage", "total_pages", "totalPages", "totalPage"]) if (Number(src[k]) > 0) return Number(src[k]);
  return 1;
}

const findKey = (obj, ...patterns) => {
  const keys = Object.keys(obj || {});
  for (const re of patterns) {
    const k = keys.find((x) => re.test(x));
    if (k) return k;
  }
  return null;
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function readCache(file, maxAgeDays) {
  if (!fs.existsSync(file)) return null;
  if ((Date.now() - fs.statSync(file).mtimeMs) / 86_400_000 > maxAgeDays) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeCache(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/**
 * @param {object} cfg
 * @param {string} cfg.base          alamat portal
 * @param {string} cfg.kodeProvinsi  mis. "010000"
 * @param {string} cfg.kodeKabupaten mis. "016000"
 * @param {string[]} cfg.kecamatan   nama atau kode kecamatan yang diambil, kosong = semua
 * @param {number} cfg.delayMinMs    jeda minimum antar halaman
 * @param {number} cfg.delayMaxMs
 * @param {number} cfg.refreshDays   data di cache lebih muda dari ini tidak diambil ulang
 */
export async function collectDapodik(cfg, log = console.log) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ headless: cfg.headless !== false });
  const context = await browser.newContext({ locale: "id-ID" });
  await context.route("**/*", (route) => {
    const req = route.request();
    return BLOCK_TYPES.has(req.resourceType()) || BLOCK_HOSTS.test(req.url()) ? route.abort() : route.continue();
  });
  const page = await context.newPage();
  const timeout = cfg.timeoutMs ?? 45_000;
  const retry = cfg.retry ?? 2;
  const backoff = cfg.backoffMs ?? 60_000;
  const maxFail = cfg.maxConsecutiveFail ?? 5;
  let consecutiveFail = 0;
  const politeDelay = () => sleep(cfg.delayMinMs + Math.random() * (cfg.delayMaxMs - cfg.delayMinMs));

  function checkStatus(status) {
    if (status === 401 || status === 403) throw new ServerTroubleError(`Portal menolak akses (HTTP ${status}). Penarikan dihentikan: periksa izin dan akun, jangan menambah penyamaran.`);
    if (status === 429 || status >= 500) throw new Error(`HTTP ${status} (server sibuk)`);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  }

  async function withRetry(fn) {
    for (let attempt = 1; attempt <= retry + 1; attempt++) {
      try {
        const out = await fn();
        consecutiveFail = 0;
        return out;
      } catch (err) {
        if (err instanceof ServerTroubleError) throw err;
        consecutiveFail++;
        if (consecutiveFail >= maxFail) throw new ServerTroubleError(`${consecutiveFail} kali gagal beruntun (terakhir: ${err.message}). Server kemungkinan sedang terbebani, penarikan dihentikan.`);
        if (attempt > retry) throw err;
        const wait = backoff * 2 ** (attempt - 1);
        log(`  ${err.message}, istirahat ${Math.round(wait / 1000)} detik`);
        await page.goto("about:blank").catch(() => {});
        await sleep(wait);
      }
    }
  }

  // Membuka halaman portal dan menangkap respons API yang dipanggil halaman itu sendiri.
  const captureJson = (url, matcher) =>
    withRetry(async () => {
      const wait = page.waitForResponse((r) => {
        if (r.request().method() === "OPTIONS") return false;
        try {
          return matcher(new URL(r.url()));
        } catch {
          return false;
        }
      }, { timeout });
      wait.catch(() => {});
      const nav = await page.goto(url, { waitUntil: "commit", timeout });
      // Halaman itu sendiri ditolak (mis. tantangan akses): berhenti, jangan menunggu API yang tidak akan datang.
      if (nav) checkStatus(nav.status());
      const res = await wait;
      checkStatus(res.status());
      return res.json();
    });

  const cacheDir = cfg.cacheDir ?? "cache";
  const details = [];
  const failed = [];
  let kecamatanCount = 0;
  const progres = (suffix = "") => `${cfg.base}/progres/${cfg.kodeProvinsi}/${cfg.kodeKabupaten}${suffix}`;

  try {
    log("Tahap 1: daftar kecamatan");
    const kecFile = path.join(cacheDir, "tahap1", `kecamatan_${cfg.kodeKabupaten}.json`);
    let kecRows = readCache(kecFile, cfg.refreshDays);
    if (!kecRows) {
      kecRows = extractRows(await captureJson(progres(), (u) => u.pathname === "/api/progress-pengiriman/kecamatan"));
      if (!kecRows.length) throw new Error("Daftar kecamatan kosong atau format respons tidak dikenali.");
      writeCache(kecFile, kecRows);
      await politeDelay();
    }
    const kodeKey = findKey(kecRows[0], /^kode_kecamatan$/i, /^kode_wilayah$/i, /kode/i);
    const namaKey = findKey(kecRows[0], /^kecamatan$/i, /^nama_kecamatan$/i, /^nama$/i, /nama/i);
    if (!kodeKey) throw new Error(`Kolom kode kecamatan tidak ditemukan. Kolom yang ada: ${Object.keys(kecRows[0]).join(", ")}`);
    const wanted = new Set((cfg.kecamatan ?? []).map(norm));
    const kecList = kecRows.filter((k) => !wanted.size || wanted.has(norm(k[kodeKey])) || wanted.has(norm(k[namaKey])));
    kecamatanCount = kecList.length;
    log(`  ${kecList.length} kecamatan`);

    const npsnList = new Map();
    for (const k of kecList) {
      const kode = String(k[kodeKey]).trim();
      const file = path.join(cacheDir, "tahap1", `school_${kode}.json`);
      let rows = readCache(file, cfg.refreshDays);
      const fromCache = Boolean(rows);
      if (!rows) {
        const first = await captureJson(progres(`/${kode}`), (u) => u.pathname === "/api/progress-pengiriman/kecamatan/school");
        rows = extractRows(first);
        const pages = totalPagesOf(first);
        // Daftar bertingkat halaman tidak bisa dipastikan lengkap dari satu pemuatan. Lebih baik gagal daripada diam-diam terpotong.
        if (pages > 1) throw new Error(`Kecamatan ${kode} memiliki ${pages} halaman data. Pengumpulan berbasis halaman perlu disesuaikan dengan cara portal memuat halaman berikutnya.`);
        writeCache(file, rows);
      }
      const npsnKey = rows.length ? findKey(rows[0], /^npsn$/i, /npsn/i) : null;
      let added = 0;
      for (const r of rows) {
        const npsn = npsnKey && r[npsnKey] ? String(r[npsnKey]).trim() : null;
        if (npsn && !npsnList.has(npsn)) {
          npsnList.set(npsn, r);
          added++;
        }
      }
      log(`  ${k[namaKey] ?? kode}${fromCache ? " [cache]" : ""}: ${added} sekolah`);
      if (!fromCache) await politeDelay();
    }

    const maxPerRun = cfg.maxPerRun ?? 0;
    let todo = [];
    for (const npsn of npsnList.keys()) {
      const cached = readCache(path.join(cacheDir, "detail", `${npsn}.json`), cfg.refreshDays);
      if (cached) details.push(cached);
      else todo.push(npsn);
    }
    if (maxPerRun > 0 && todo.length > maxPerRun) todo = todo.slice(0, maxPerRun);
    log(`Tahap 2: detail ${npsnList.size} sekolah (${details.length} dari cache, ${todo.length} diambil)`);
    for (let i = 0; i < todo.length; i++) {
      const npsn = todo[i];
      try {
        const json = await captureJson(`${cfg.base}/sekolah?npsn=${encodeURIComponent(npsn)}`, (u) => u.pathname === "/api/detail-sekolah" && u.searchParams.get("npsn") === String(npsn));
        const row = latestDetail(extractRows(json));
        if (row) {
          writeCache(path.join(cacheDir, "detail", `${npsn}.json`), row);
          details.push(row);
        } else failed.push({ npsn, alasan: "data kosong" });
      } catch (err) {
        if (err instanceof ServerTroubleError) {
          todo.slice(i).forEach((n) => failed.push({ npsn: n, alasan: "belum diambil (dihentikan)" }));
          throw Object.assign(err, { partial: { details, failed, kecamatanCount, schoolsSeen: npsnList.size } });
        }
        failed.push({ npsn, alasan: err.message });
      }
      if ((i + 1) % 10 === 0 || i + 1 === todo.length) log(`  ${i + 1}/${todo.length} (gagal: ${failed.length})`);
      await politeDelay();
    }
    return { details, failed, kecamatanCount, schoolsSeen: npsnList.size };
  } finally {
    await browser.close().catch(() => {});
  }
}
