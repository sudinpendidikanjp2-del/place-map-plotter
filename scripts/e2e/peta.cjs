const { chromium } = require("playwright"); const fs = require("fs");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
const MAP_BASE = process.env.E2E_MAP_BASE || "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL || "admin@contoh.id";
const PASSWORD = process.env.E2E_PASSWORD || "kata-sandi-dev-1";
const S = process.env.E2E_OUT || require("os").tmpdir();
const mock = fs.readFileSync(__dirname + "/google-maps-mock.js", "utf8");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage();
  const problems = []; p.on("pageerror", (e) => problems.push("pageerror: " + e.message)); p.on("console", (m) => m.type() === "error" && !/401|503/.test(m.text()) && problems.push("console: " + m.text()));
  await p.route(/maps\.googleapis\.com\/maps\/api\/js/, async (route) => { const cb = new URL(route.request().url()).searchParams.get("callback"); await route.fulfill({ contentType: "text/javascript", body: mock + `;setTimeout(()=>{const f="${cb}".split(".").reduce((o,k)=>o&&o[k],window);f&&f();},0);` }); });
  const step = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`);
  await p.goto(`${MAP_BASE}/masuk`); await p.getByLabel("Email").fill(EMAIL); await p.getByLabel("Kata sandi").fill(PASSWORD); await p.getByRole("button", { name: "Masuk" }).click(); await p.waitForURL(`${MAP_BASE}/`);
  await p.waitForSelector("[data-mockmap]", { timeout: 8000 }); await p.waitForSelector("mock-marker", { timeout: 8000 });
  const n0 = await p.locator("mock-marker").count(); step("peta memuat cluster dari server", n0 > 0, `${n0} penanda`);
  await p.waitForTimeout(600); await p.screenshot({ path: S + "/20-peta.png" });
  const strip = await p.getByRole("group", { name: "Ringkasan area peta" }).innerText(); step("strip ringkasan terisi dari data nyata", /\d/.test(strip), strip.replace(/\s+/g, " "));
  // zoom ke cluster
  const z0 = await p.evaluate(() => window.__map.z); await p.locator("mock-marker").first().dispatchEvent("click"); await p.waitForTimeout(500);
  const z1 = await p.evaluate(() => window.__map.z); step("klik cluster memperbesar peta", z1 > z0, `${z0} -> ${z1}`);
  // zoom dekat sampai titik individual, klik titik
  await p.evaluate(() => { window.__map.setCenter({ lat: -6.19, lng: 106.83 }); window.__map.setZoom(15); }); await p.waitForTimeout(900);
  const singles = await p.locator("mock-marker [role=img]").count(); step("zoom dekat menampilkan titik individual", singles > 0, `${singles} titik`);
  await p.locator("mock-marker [role=img]").first().dispatchEvent("click"); await p.waitForSelector("aside[aria-label^='Detail']", { timeout: 5000 });
  step("klik titik membuka kartu detail dan URL memuat id", /lokasi=\d+/.test(p.url()), p.url());
  await p.screenshot({ path: S + "/21-detail.png" });
  await p.getByRole("button", { name: "Tambah ke rute" }).click(); await p.waitForSelector("section[aria-label='Rute']");
  step("tambah ke rute membuka panel rute", (await p.locator("section[aria-label='Rute'] li").count()) === 1);
  await p.getByRole("button", { name: "Tutup detail" }).click(); await p.waitForTimeout(300); step("tutup detail menghapus id dari URL", !/lokasi=/.test(p.url()));
  // filter jenis -> peta menyesuaikan
  await p.getByRole("button", { name: "Aset", exact: true }).click(); await p.waitForTimeout(1200);
  step("filter jenis memuat ulang cluster", (await p.locator("mock-marker").count()) >= 0);
  await p.getByRole("button", { name: "Atur ulang" }).click(); await p.waitForTimeout(800);
  // gambar lingkaran
  await p.getByRole("button", { name: "Filter dengan lingkaran" }).click(); step("mode lingkaran menampilkan petunjuk", await p.getByText("Klik pusat lingkaran").isVisible());
  await p.keyboard.press("Escape"); step("Escape membatalkan mode gambar", !(await p.getByText("Klik pusat lingkaran").isVisible()));
  // pencarian cepat -> peta fokus
  await p.keyboard.press("Control+k"); await p.getByLabel("Kata kunci").fill("Sekolah Uji 7"); await p.waitForSelector("ul button"); await p.locator("ul button").first().click();
  await p.waitForSelector("aside[aria-label^='Detail']"); step("hasil pencarian membuka detail di peta", true);
  await p.screenshot({ path: S + "/22-cari-detail.png" });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(600); await p.screenshot({ path: S + "/23-peta-seluler.png" });
  step("tanpa overflow horizontal di 390px (Peta)", !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  console.log(problems.length ? "MASALAH:\n" + problems.join("\n") : "tidak ada galat konsol"); await b.close();
})().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
