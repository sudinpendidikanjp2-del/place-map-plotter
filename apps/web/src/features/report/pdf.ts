import { KIND_LABEL, type LocationFilter, type Summary } from "@peta/domain";
import { formatMonth, formatNumber } from "../../shared/lib/format.ts";

function describeFilter(f: LocationFilter): string {
  const parts: string[] = [];
  if (f.kind) parts.push(`Jenis: ${KIND_LABEL[f.kind]}`);
  if (f.category) parts.push(`Kategori: ${f.category}`);
  if (f.province) parts.push(`Provinsi: ${f.province}`);
  if (f.city) parts.push(`Kota/Kab.: ${f.city}`);
  if (f.district) parts.push(`Kecamatan: ${f.district}`);
  if (f.q) parts.push(`Kata kunci: ${f.q}`);
  return parts.length ? parts.join(" | ") : "Semua data";
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Membuat PDF di peramban. Pustaka dimuat malas agar tidak membebani layar lain. */
export async function buildPdf(summary: Summary, filter: LocationFilter, mapImageUrl: string | null): Promise<{ blob: Blob; mapIncluded: boolean }> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  let y = M;
  const NAVY: [number, number, number] = [11, 31, 75];
  const MUTED: [number, number, number] = [75, 85, 114];

  const ensure = (h: number) => {
    if (y + h > 285) {
      doc.addPage();
      y = M;
    }
  };

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(18).text("Laporan Data Lokasi", M, 16);
  doc.setFont("helvetica", "normal").setFontSize(9).text(new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }), W - M, 16, { align: "right" });
  y = 36;

  doc.setTextColor(...MUTED).setFontSize(9).text(doc.splitTextToSize(`Filter: ${describeFilter(filter)}`, W - 2 * M), M, y);
  y += 10;

  const kpis: [string, string][] = [
    ["Total lokasi", formatNumber(summary.total)],
    ["Jumlah murid", formatNumber(summary.students)],
    ["Jumlah guru", formatNumber(summary.teachers)],
  ];
  const bw = (W - 2 * M - 8) / 3;
  kpis.forEach(([label, value], i) => {
    const x = M + i * (bw + 4);
    doc.setDrawColor(226, 223, 214).setFillColor(248, 247, 243).roundedRect(x, y, bw, 22, 3, 3, "FD");
    doc.setTextColor(...MUTED).setFontSize(9).text(label, x + 4, y + 7);
    doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(16).text(value, x + 4, y + 17);
    doc.setFont("helvetica", "normal");
  });
  y += 30;

  let mapIncluded = false;
  if (mapImageUrl) {
    try {
      const res = await fetch(mapImageUrl, { credentials: "same-origin" });
      if (res.ok) {
        const img = await toDataUrl(await res.blob());
        ensure(100);
        doc.addImage(img, "PNG", M, y, W - 2 * M, ((W - 2 * M) * 400) / 640);
        y += ((W - 2 * M) * 400) / 640 + 8;
        mapIncluded = true;
      }
    } catch {
      /* peta tidak tersedia, laporan tetap dibuat tanpa gambar */
    }
  }

  const bars = (title: string, rows: { label: string; value: number }[]) => {
    if (!rows.length) return;
    ensure(14 + rows.length * 7);
    doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(11).text(title, M, y);
    doc.setFont("helvetica", "normal");
    y += 6;
    const max = Math.max(...rows.map((r) => r.value), 1);
    for (const r of rows) {
      ensure(7);
      doc.setTextColor(40, 48, 72).setFontSize(9).text(doc.splitTextToSize(r.label, 52)[0] as string, M, y + 3.5);
      doc.setFillColor(...NAVY).rect(M + 56, y, Math.max(0.6, (r.value / max) * 90), 4.5, "F");
      doc.setTextColor(...MUTED).text(formatNumber(r.value), M + 56 + 94, y + 3.5);
      y += 7;
    }
    y += 5;
  };

  bars("Jumlah lokasi per jenis", summary.byKind.map((k) => ({ label: KIND_LABEL[k.kind], value: k.count })));
  bars("Jumlah lokasi per kategori", summary.byCategory.map((c) => ({ label: c.category, value: c.count })));
  bars("Jumlah murid per kategori", summary.byCategory.filter((c) => c.students > 0).map((c) => ({ label: c.category, value: c.students })));
  bars("Jumlah lokasi per provinsi", summary.byProvince.map((p) => ({ label: p.province, value: p.count })));
  bars("Lokasi ditambahkan per bulan", summary.addedPerMonth.map((m) => ({ label: formatMonth(m.month), value: m.count })));

  return { blob: doc.output("blob"), mapIncluded };
}
