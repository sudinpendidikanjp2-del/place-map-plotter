const { chromium } = require("playwright");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
const MAP_BASE = process.env.E2E_MAP_BASE || "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL || "admin@contoh.id";
const PASSWORD = process.env.E2E_PASSWORD || "kata-sandi-dev-1";
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  const bad = [];
  async function tabAudit(name, max = 40) {
    let stops = 0; const seen = new Set();
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < max; i++) {
      await p.keyboard.press("Tab");
      const info = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        return { id: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30), tag: e.tagName, ow: parseFloat(cs.outlineWidth), os: cs.outlineStyle, vis: r.width > 0 && r.height > 0, sh: cs.boxShadow !== "none" }; });
      if (!info) continue; const key = info.tag + info.id; if (seen.has(key)) continue; seen.add(key); stops++;
      if (!(info.os !== "none" && info.ow > 0) && !info.sh) bad.push(`${name}: sin fokus terlihat: ${key}`);
      if (!info.vis) bad.push(`${name}: fokus pada elemen tak terlihat: ${key}`);
    }
    console.log(`${name}: ${stops} perhentian Tab unik`);
  }
  await p.goto(`${BASE}/masuk`);
  await tabAudit("masuk", 8);
  await p.getByLabel("Email").fill(EMAIL); await p.getByLabel("Kata sandi").fill(PASSWORD);
  await p.keyboard.press("Enter"); await p.waitForURL(`${BASE}/`);
  console.log("PASS login dengan Enter (tanpa mouse)");
  await p.goto(`${BASE}/data`); await p.waitForSelector("[role=listitem]");
  await tabAudit("data", 45);
  // dialog: fokus terkunci dan Escape menutup
  await p.getByRole("button", { name: "Tambah", exact: true }).focus(); await p.keyboard.press("Enter");
  const inDialog = await p.evaluate(() => !!document.activeElement.closest("dialog"));
  console.log((inDialog ? "PASS" : "FAIL") + " fokus pindah ke dalam dialog saat dibuka");
  for (let i = 0; i < 25; i++) { await p.keyboard.press("Tab"); if (!(await p.evaluate(() => !!document.activeElement.closest("dialog") || document.activeElement === document.body))) { bad.push("fokus bocor ke halaman di belakang dialog"); break; } }
  await p.keyboard.press("Escape");
  console.log((await p.getByRole("dialog").isVisible() ? "FAIL" : "PASS") + " Escape menutup dialog");
  // pintasan pencarian
  await p.keyboard.press("Control+k"); console.log((await p.getByRole("dialog").isVisible() ? "PASS" : "FAIL") + " Ctrl+K membuka pencarian"); await p.keyboard.press("Escape");
  // lompat: tampilan reduced motion
  console.log(bad.length ? "MASALAH:\n" + bad.join("\n") : "PASS semua perhentian Tab punya penanda fokus terlihat");
  await b.close();
})();
