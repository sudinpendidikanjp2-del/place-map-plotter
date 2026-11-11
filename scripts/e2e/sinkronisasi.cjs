// Uji layar Sinkronisasi, token API, sekolah tanpa koordinat, dan pencarian koordinat otomatis.
// Butuh data hasil pekerja (apps/sync) di basis data dan server dengan GOOGLE_MAPS_KEY, GOOGLE_SERVER_KEY, PLACES_ENDPOINT=http://127.0.0.1:3199/places
const { chromium } = require("playwright"); const fs = require("fs"); const http = require("http");
const MAP_BASE = process.env.E2E_MAP_BASE || "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL || "admin@contoh.id";
const PASSWORD = process.env.E2E_PASSWORD || "kata-sandi-dev-1";
const OUT = process.env.E2E_OUT || require("os").tmpdir();
const mock = fs.readFileSync(__dirname + "/google-maps-mock.js", "utf8");
(async () => {
  const fake = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ places: [{ displayName: { text: "SD UJI" }, formattedAddress: "Jl. Uji, Kec. Senen, Kota Jakarta Pusat, DKI Jakarta", location: { latitude: -6.18, longitude: 106.84 } }] })); });
  await new Promise((r) => fake.listen(3199, "127.0.0.1", r));
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  const problems = []; p.on("pageerror", (e) => problems.push("pageerror: " + e.message)); p.on("console", (m) => m.type() === "error" && !/401|503/.test(m.text()) && problems.push("console: " + m.text()));
  await p.route(/maps\.googleapis\.com\/maps\/api\/js/, async (route) => { const cb = new URL(route.request().url()).searchParams.get("callback"); await route.fulfill({ contentType: "text/javascript", body: mock + `;setTimeout(()=>{const f="${cb}".split(".").reduce((o,k)=>o&&o[k],window);f&&f();},0);` }); });
  const step = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`);
  await p.goto(`${MAP_BASE}/masuk`); await p.getByLabel("Email").fill(EMAIL); await p.getByLabel("Kata sandi").fill(PASSWORD); await p.getByRole("button", { name: "Masuk" }).click(); await p.waitForURL(`${MAP_BASE}/`);

  // sekolah tanpa koordinat di layar Data
  await p.goto(`${MAP_BASE}/data`); await p.waitForSelector("[role=listitem]");
  await p.getByRole("button", { name: "Tanpa koordinat" }).click(); await p.waitForTimeout(900);
  const nocoord = await p.locator("[role=listitem]").count(); step("filter tanpa koordinat menampilkan sekolah hasil sinkronisasi", nocoord > 0, `${nocoord} baris`);
  step("baris diberi tanda tanpa titik", (await p.getByText("Tanpa titik").count()) > 0);
  await p.getByRole("button", { name: /^Ubah / }).first().click();
  step("form ubah mengosongkan koordinat, bukan tulisan null", (await p.getByLabel("Lintang", { exact: true }).inputValue()) === "");
  await p.keyboard.press("Escape");

  // layar Sinkronisasi
  await p.getByRole("link", { name: "Sinkronisasi" }).first().click(); await p.waitForSelector("text=Riwayat penarikan Dapodik");
  step("riwayat penarikan tampil", (await p.locator("section[aria-label='Riwayat sinkronisasi'] li").count()) > 0);
  await p.screenshot({ path: OUT + "/50-sinkronisasi.png", fullPage: true });
  await p.getByRole("button", { name: "Buat token" }).click(); await p.getByLabel("Nama token").fill("Token uji e2e"); await p.getByRole("button", { name: "Buat", exact: true }).click();
  await p.waitForSelector("text=Token tidak akan ditampilkan lagi"); const tok = await p.locator("dialog code").innerText(); step("token dibuat dan ditampilkan sekali", /^peta_/.test(tok));
  await p.getByRole("button", { name: "Selesai" }).click();
  const li = p.locator("section[aria-label='Token API'] li", { hasText: "Token uji e2e" }); await li.getByRole("button", { name: "Cabut" }).click(); await p.waitForSelector("text=Token dicabut");
  step("token bisa dicabut", true);

  // pencarian koordinat otomatis
  await p.waitForSelector("text=Belum punya titik");
  await p.getByRole("button", { name: /Cari 50 koordinat/ }).click(); await p.waitForSelector("text=koordinat ditemukan", { timeout: 20000 });
  step("pencarian koordinat otomatis menemukan titik", true);
  await p.goto(`${MAP_BASE}/data`); await p.waitForSelector("[role=listitem]");
  await p.getByRole("button", { name: "Koordinat perkiraan" }).click(); await p.waitForTimeout(900);
  step("filter koordinat perkiraan menampilkan hasilnya", (await p.getByText("Titik perkiraan").count()) > 0);
  await p.locator("[role=listitem] button").first().click(); await p.waitForSelector("aside[aria-label^='Detail']", { timeout: 10000 });
  step("detail menandai koordinat perkiraan", await p.getByText("Koordinat perkiraan").first().isVisible());
  await p.screenshot({ path: OUT + "/51-perkiraan.png" });
  await p.getByRole("button", { name: "Tandai sudah benar" }).click(); await p.waitForSelector("text=ditandai sudah benar");
  step("tanda perkiraan hilang setelah dikonfirmasi", (await p.getByRole("note").count()) === 0);
  console.log(problems.length ? "MASALAH:\n" + problems.join("\n") : "tidak ada galat konsol");
  await b.close(); fake.close();
})().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
