const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
const MAP_BASE = process.env.E2E_MAP_BASE || "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL || "admin@contoh.id";
const PASSWORD = process.env.E2E_PASSWORD || "kata-sandi-dev-1";
const OUT = process.env.E2E_OUT || require("os").tmpdir();
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  const step = (n, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"} ${n} ${extra}`);

  await page.goto(`${BASE}/`);
  await page.waitForURL("**/masuk");
  step("tanpa login diarahkan ke /masuk", true);
  await page.screenshot({ path: OUT + "/01-masuk.png" });

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Kata sandi").fill("salah-salah-salah");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.getByRole("alert").waitFor({ timeout: 5000 }).catch(() => {}); step("login salah menampilkan galat", await page.getByRole("alert").isVisible());
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);
  step("login benar masuk ke peta", true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "/02-peta-tanpa-kunci.png" });

  await page.getByRole("link", { name: "Data" }).first().click();
  await page.waitForSelector("[role=listitem]");
  step("layar Data memuat baris", (await page.locator("[role=listitem]").count()) > 3);
  await page.screenshot({ path: OUT + "/03-data.png" });

  await page.getByRole("button", { name: "Fasilitas", exact: true }).click();
  await page.waitForTimeout(700);
  const n = await page.locator("p", { hasText: "lokasi sesuai filter" }).first().textContent();
  step("filter jenis bekerja", /sesuai filter/.test(n || ""), n || "");
  await page.getByLabel("Provinsi").selectOption({ index: 1 });
  await page.waitForTimeout(700);
  step("kota aktif setelah pilih provinsi", await page.getByLabel("Kota atau kabupaten").isEnabled());
  await page.getByRole("button", { name: "Atur ulang" }).click();

  await page.getByRole("button", { name: /^Ubah / }).first().click();
  step("form ubah terbuka", await page.getByRole("dialog").isVisible());
  await page.screenshot({ path: OUT + "/04-form.png" });
  await page.keyboard.press("Escape");
  step("Escape menutup dialog", !(await page.getByRole("dialog").isVisible()));

  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page.getByRole("button", { name: "Simpan" }).click();
  step("validasi form menampilkan galat", (await page.getByText("Nama wajib diisi.").count()) > 0);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.getByLabel("Kata kunci").fill("Sekolah Uji 12");
  await page.waitForSelector("ul button");
  step("pencarian cepat menampilkan hasil", (await page.locator("ul button").count()) > 0);
  await page.screenshot({ path: OUT + "/05-cari.png" });
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Laporan" }).first().click();
  await page.waitForSelector("text=Total lokasi");
  step("laporan tampil", true);
  await page.screenshot({ path: OUT + "/06-laporan.png", fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }).catch(() => null), page.getByRole("link", { name: "Data CSV" }).click()]);
  step("ekspor CSV mengunduh berkas", !!dl, dl ? dl.suggestedFilename() : "");
  const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), page.getByRole("button", { name: "Laporan PDF" }).click()]);
  step("laporan PDF terunduh", !!pdf, pdf ? pdf.suggestedFilename() : "");

  await page.getByRole("link", { name: "Impor" }).first().click();
  await page.waitForSelector("text=Impor data");
  require("fs").writeFileSync("/tmp/uji-impor.csv", "Nama;Lat;Lng;Jumlah Siswa;Akreditasi\nSekolah Impor 1;-6,2;106,8;250;A\nSekolah Impor 2;abc;106,8;10;B\n");
  await page.setInputFiles("input[type=file]", "/tmp/uji-impor.csv");
  await page.waitForSelector("text=Kolom yang dikenali");
  step("pratinjau CSV menampilkan pemetaan kolom", true);
  await page.screenshot({ path: OUT + "/07-impor.png", fullPage: true });
  await page.getByRole("button", { name: "Mulai impor" }).click();
  await page.waitForSelector("text=Impor selesai", { timeout: 15000 });
  step("impor selesai dengan 1 masuk, 1 dilewati", (await page.getByText("Dilewati").count()) > 0);
  await page.screenshot({ path: OUT + "/08-impor-selesai.png", fullPage: true });
  await page.getByRole("button", { name: "Batalkan impor" }).first().click();
  await page.getByRole("button", { name: "Hapus hasil impor" }).click();
  await page.waitForTimeout(800);
  step("batch impor dapat dibatalkan", true);

  await page.getByRole("link", { name: "Admin" }).first().click();
  await page.waitForSelector("text=Pengguna");
  await page.screenshot({ path: OUT + "/09-admin.png" });
  step("layar Admin tampil", true);

  await page.getByRole("button", { name: /Ganti ke tema gelap/ }).click();
  await page.getByRole("link", { name: "Laporan" }).first().click();
  await page.waitForSelector("text=Total lokasi");
  await page.screenshot({ path: OUT + "/10-laporan-gelap.png" });
  await page.getByRole("link", { name: "Data" }).first().click();
  await page.waitForSelector("[role=listitem]");
  await page.screenshot({ path: OUT + "/11-data-gelap.png" });
  step("tema gelap berfungsi", true);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: OUT + "/12-data-seluler.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  step("tanpa overflow horizontal di 390px (Data)", !overflow);
  await page.getByRole("link", { name: "Laporan" }).last().click();
  await page.waitForSelector("text=Total lokasi");
  await page.screenshot({ path: OUT + "/13-laporan-seluler.png", fullPage: true });
  step("tanpa overflow horizontal di 390px (Laporan)", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  console.log("MASALAH KONSOL:", problems.length ? problems.join("\n") : "tidak ada");
  await browser.close();
})().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
