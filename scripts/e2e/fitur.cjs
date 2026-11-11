// Uji fitur: filter jenjang dan kecamatan, cari titik dari nama tempat, gambar lokasi, label nama di peta.
// Butuh server dengan GOOGLE_MAPS_KEY=uji, GOOGLE_SERVER_KEY=uji, dan PLACES_ENDPOINT=http://127.0.0.1:3199/places
const { chromium } = require("playwright"); const fs = require("fs"); const http = require("http");
const MAP_BASE = process.env.E2E_MAP_BASE || "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL || "admin@contoh.id";
const PASSWORD = process.env.E2E_PASSWORD || "kata-sandi-dev-1";
const OUT = process.env.E2E_OUT || require("os").tmpdir();
const mock = fs.readFileSync(__dirname + "/google-maps-mock.js", "utf8");
// PNG 64x48 sah dibuat saat dijalankan (zlib + CRC), supaya pasti bisa didekode peramban.
function makePng(w, h) {
  const zlib = require("zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 11; raw[o + 1] = 31 + x; raw[o + 2] = 75 + y; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(64, 48);
(async () => {
  const fake = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ places: [{ displayName: { text: "SDN Uji Menteng 01" }, formattedAddress: "Jl. Besuki No.4, Kec. Menteng, Kota Jakarta Pusat, DKI Jakarta", location: { latitude: -6.1951, longitude: 106.8319 } }] })); });
  await new Promise((r) => fake.listen(3199, "127.0.0.1", r));
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  const problems = []; p.on("pageerror", (e) => problems.push("pageerror: " + e.message)); p.on("console", (m) => m.type() === "error" && !/401|503/.test(m.text()) && problems.push("console: " + m.text()));
  await p.route(/maps\.googleapis\.com\/maps\/api\/js/, async (route) => { const cb = new URL(route.request().url()).searchParams.get("callback"); await route.fulfill({ contentType: "text/javascript", body: mock + `;setTimeout(()=>{const f="${cb}".split(".").reduce((o,k)=>o&&o[k],window);f&&f();},0);` }); });
  const step = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"} ${n} ${x}`);
  await p.goto(`${MAP_BASE}/masuk`); await p.getByLabel("Email").fill(EMAIL); await p.getByLabel("Kata sandi").fill(PASSWORD); await p.getByRole("button", { name: "Masuk" }).click(); await p.waitForURL(`${MAP_BASE}/`);

  // 1. filter jenjang dan kecamatan di layar Data
  await p.goto(`${MAP_BASE}/data`); await p.waitForSelector("[role=listitem]");
  const total = async () => Number(((await p.locator("p", { hasText: "lokasi" }).first().textContent()) || "").replace(/\D/g, ""));
  const all = await total();
  await p.getByLabel("Jenjang").selectOption("SMA"); await p.waitForTimeout(900);
  const sma = await total(); step("filter jenjang SMA mempersempit daftar", sma > 0 && sma < all, `${all} -> ${sma}`);
  await p.getByLabel("Provinsi").selectOption({ index: 1 }); await p.waitForTimeout(700);
  step("kecamatan aktif setelah memilih provinsi (tanpa memilih kota)", await p.getByLabel("Kecamatan").isEnabled());
  await p.getByLabel("Kecamatan").selectOption({ index: 1 }); await p.waitForTimeout(900);
  const kec = await total(); step("filter kecamatan mempersempit lagi", kec > 0 && kec <= sma, `${sma} -> ${kec}`);
  await p.getByRole("button", { name: "Atur ulang" }).click();

  // 2. cari titik dari nama tempat saat menambah lokasi
  await p.getByRole("button", { name: "Tambah", exact: true }).click();
  await p.getByLabel("Cari titik dari nama tempat").fill("SDN Uji Menteng 01"); await p.getByRole("button", { name: "Cari", exact: true }).click();
  await p.waitForSelector("text=Jl. Besuki No.4"); await p.getByRole("dialog").locator("ul button").first().click();
  step("pilih hasil mengisi lintang dan bujur", (await p.getByLabel("Lintang", { exact: true }).inputValue()) === "-6.195100" && (await p.getByLabel("Bujur", { exact: true }).inputValue()) === "106.831900");
  step("pilih hasil mengisi nama dan alamat", (await p.getByLabel("Nama", { exact: true }).inputValue()) === "SDN Uji Menteng 01" && /Besuki/.test(await p.getByLabel("Alamat", { exact: true }).inputValue()));
  await p.getByRole("dialog").getByLabel("Jenjang").selectOption("SD"); await p.getByLabel("NPSN").fill(String(10000000 + (Date.now() % 80000000)));

  // 3. gambar lokasi
  fs.writeFileSync("/tmp/uji-gambar.png", PNG);
  await p.setInputFiles("input[aria-label='Pilih gambar']", "/tmp/uji-gambar.png"); await p.waitForSelector("img[alt='Gambar yang akan diunggah']");
  step("gambar yang dipilih tampil sebagai pratinjau", true);
  await p.getByRole("button", { name: "Simpan" }).click(); await p.waitForSelector("text=Lokasi ditambahkan", { timeout: 15000 });
  step("lokasi tersimpan bersama gambarnya", true);
  await p.screenshot({ path: OUT + "/40-simpan.png" });

  // 4. peta: detail menampilkan galeri; label nama tanpa cluster
  await p.goto(`${MAP_BASE}/`); await p.waitForSelector("mock-marker");
  await p.keyboard.press("Control+k"); await p.getByLabel("Kata kunci").fill("SDN Uji Menteng"); await p.waitForSelector("ul button"); await p.locator("ul button").first().click();
  await p.waitForSelector("aside[aria-label^='Detail']"); await p.waitForTimeout(500);
  const thumbs = await p.locator("aside ul[aria-label^='Gambar'] img").count(); step("kartu detail menampilkan galeri gambar", thumbs === 1);
  await p.locator("aside ul[aria-label^='Gambar'] button").first().click(); await p.waitForSelector("dialog img[alt^='Gambar']", { state: "visible" });
  const loaded = await p.locator("dialog img").first().evaluate((i) => i.complete && i.naturalWidth > 0); step("gambar penuh termuat di lightbox", loaded);
  await p.keyboard.press("Escape");
  await p.screenshot({ path: OUT + "/41-detail-gambar.png" });
  await p.getByRole("button", { name: "Tutup detail" }).click();
  const before = await p.locator("mock-marker").count();
  await p.getByRole("button", { name: /Tampilkan label nama/ }).click(); await p.waitForTimeout(1500);
  const labelled = await p.locator("mock-marker span.truncate").count();
  step("label nama menampilkan titik tanpa cluster", labelled > 0, `${before} penanda -> ${labelled} berlabel`);
  await p.screenshot({ path: OUT + "/42-label.png" });
  step("tombol label bisa dimatikan kembali", await p.getByRole("button", { name: /Sembunyikan label nama/ }).isVisible());
  console.log(problems.length ? "MASALAH:\n" + problems.join("\n") : "tidak ada galat konsol");
  await b.close(); fake.close();
})().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
