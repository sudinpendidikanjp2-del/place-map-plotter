import { useState } from "react";
import { KIND_LABEL, hasActiveFilter, type Summary } from "@peta/domain";
import { api } from "../../data/api.ts";
import { useAuth } from "../../app/auth.tsx";
import { useFilter } from "../../app/filter.tsx";
import { useRouter } from "../../app/router.tsx";
import { formatCompact, formatMonth, formatNumber } from "../../shared/lib/format.ts";
import { useResource } from "../../shared/lib/hooks.ts";
import { Button, DownloadLink, EmptyState, ErrorState, SkeletonRows } from "../../shared/ui/primitives.tsx";
import { useToast } from "../../shared/ui/toast.tsx";
import { FilterControls } from "../locations/FilterControls.tsx";
import { KindBadge } from "../locations/kind.tsx";

const INDONESIA = { west: 95, south: -11, east: 141, north: 6 };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportPage() {
  const { can } = useAuth();
  const { filter } = useFilter();
  const { navigate } = useRouter();
  const toast = useToast();
  const key = JSON.stringify(filter);
  const summary = useResource((s) => api.summary(filter, s), [key]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);

  const staticMapUrl = () => {
    const p = new URLSearchParams(api.staticMapUrl(filter, 4).split("?")[1]);
    for (const [k, v] of Object.entries(INDONESIA)) p.set(k, String(v));
    return `/api/export/static-map?${p}`;
  };

  async function exportPdf() {
    if (!summary.data) return;
    setPdfBusy(true);
    try {
      const { buildPdf } = await import("./pdf.ts");
      const { blob, mapIncluded } = await buildPdf(summary.data, filter, staticMapUrl());
      download(blob, `laporan-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.ok(mapIncluded ? "Laporan PDF diunduh." : "Laporan PDF diunduh tanpa gambar peta (kunci Static Maps belum diatur di server).");
    } catch {
      toast.error("Laporan PDF gagal dibuat.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function exportImage() {
    setImgBusy(true);
    try {
      const res = await fetch(staticMapUrl(), { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Gambar peta gagal dibuat.");
      download(await res.blob(), `peta-${new Date().toISOString().slice(0, 10)}.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gambar peta gagal dibuat.");
    } finally {
      setImgBusy(false);
    }
  }

  const s = summary.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Laporan</h1>
          <p className="text-ink-2">{hasActiveFilter(filter) ? "Ringkasan untuk data yang sesuai filter." : "Ringkasan seluruh data."}</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ekspor">
          <DownloadLink href={api.exportCsvUrl(filter)} icon="table">Data CSV</DownloadLink>
          <Button icon="image" busy={imgBusy} onClick={() => void exportImage()}>
            Gambar peta
          </Button>
          <Button variant="primary" icon="download" busy={pdfBusy} disabled={!s || s.total === 0} onClick={() => void exportPdf()}>
            Laporan PDF
          </Button>
          {can("admin") && (
            <DownloadLink href={api.backupUrl} icon="download">Cadangan penuh</DownloadLink>
          )}
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-3">
        <FilterControls />
      </div>

      {summary.status === "loading" && !s && <SkeletonRows rows={5} />}
      {summary.status === "error" && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {s && s.total === 0 && (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            title={hasActiveFilter(filter) ? "Tidak ada data yang sesuai filter" : "Belum ada data untuk dilaporkan"}
            action={!hasActiveFilter(filter) && can("editor") ? <Button variant="primary" icon="upload" onClick={() => navigate("/impor")}>Impor dari CSV</Button> : undefined}
          >
            Laporan akan terisi setelah ada lokasi.
          </EmptyState>
        </div>
      )}
      {s && s.total > 0 && <Body s={s} />}
    </div>
  );
}

function Body({ s }: { s: Summary }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        <section className="rounded-card bg-navy p-5 text-white" aria-label="Total lokasi">
          <p className="text-white/75">Total lokasi</p>
          <p className="num mt-1 text-[40px] font-semibold leading-none text-accent">{formatNumber(s.total)}</p>
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
            {s.byKind.map((k) => (
              <li key={k.kind} className="flex items-center gap-2">
                <KindBadge kind={k.kind} size={22} className="ring-1 ring-white/40" />
                <span className="text-white/85">{KIND_LABEL[k.kind]}</span>
                <span className="num font-semibold">{formatNumber(k.count)}</span>
              </li>
            ))}
          </ul>
        </section>
        <Kpi label="Jumlah murid" value={s.students} />
        <Kpi label="Jumlah guru" value={s.teachers} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bars title="Lokasi per kategori" rows={s.byCategory.map((c) => ({ label: c.category, value: c.count }))} />
        <Bars title="Murid per kategori" rows={s.byCategory.filter((c) => c.students > 0).map((c) => ({ label: c.category, value: c.students }))} empty="Belum ada data jumlah murid." />
        <Bars title="Lokasi per provinsi" rows={s.byProvince.map((p) => ({ label: p.province, value: p.count }))} />
        <Months rows={s.addedPerMonth} />
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label={label}>
      <p className="text-ink-2">{label}</p>
      <p className="num mt-1 text-[28px] font-semibold leading-none">{formatNumber(value)}</p>
    </section>
  );
}

function Bars({ title, rows, empty = "Belum ada data." }: { title: string; rows: { label: string; value: number }[]; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-ink-2">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
              <span className="truncate" title={r.label}>
                {r.label}
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
              </span>
              <span className="num text-right font-medium">{formatNumber(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function lastTwelveMonths(rows: Summary["addedPerMonth"]): Summary["addedPerMonth"] {
  const byMonth = new Map(rows.map((r) => [r.month, r.count]));
  const out: Summary["addedPerMonth"] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, count: byMonth.get(key) ?? 0 });
  }
  return out;
}

function Months({ rows: raw }: { rows: Summary["addedPerMonth"] }) {
  const rows = lastTwelveMonths(raw);
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label="Lokasi ditambahkan per bulan">
      <h2 className="font-semibold">Ditambahkan per bulan</h2>
      {raw.length === 0 ? (
        <p className="mt-3 text-ink-2">Belum ada penambahan dalam 12 bulan terakhir.</p>
      ) : (
        <ul className="mt-4 flex h-40 items-end gap-1.5">
          {rows.map((r) => (
            <li key={r.month} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center">
              <span className="num text-[12px] text-ink-2">{r.count ? formatCompact(r.count) : ""}</span>
              <span className="block rounded-t-md bg-primary" style={{ height: `${r.count === 0 ? 2 : Math.max(4, (r.count / max) * 100)}%`, opacity: r.count === 0 ? 0.35 : 1 }} />
              <span className="truncate text-[11px] text-ink-2">{formatMonth(r.month)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
