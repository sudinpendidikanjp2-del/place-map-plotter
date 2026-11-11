import { useEffect, useRef, useState, type DragEvent } from "react";
import { FIELD_LABEL, KIND_LABEL, LOCATION_KINDS, mapHeaders, parseCsv, type LocationKind, type MappedField } from "@peta/domain";
import { ApiError, api, type ImportBatch } from "../../data/api.ts";
import { formatDate, formatNumber } from "../../shared/lib/format.ts";
import { useResource } from "../../shared/lib/hooks.ts";
import { Button, Dialog, EmptyState, ErrorState, Field, Select, SkeletonRows } from "../../shared/ui/primitives.tsx";
import { Icon } from "../../shared/ui/icons.tsx";
import { useToast } from "../../shared/ui/toast.tsx";
import { cn } from "../../shared/lib/cn.ts";

const REQUIRED: MappedField[] = ["name", "latitude", "longitude"];
const STATUS_LABEL: Record<ImportBatch["status"], string> = {
  menunggu: "Menunggu berkas",
  berjalan: "Berjalan",
  selesai: "Selesai",
  gagal: "Gagal",
  dibatalkan: "Dibatalkan",
};

interface Preview {
  headers: string[];
  rows: string[][];
  mapping: Record<MappedField, number>;
  missing: MappedField[];
}

async function readPreview(file: File): Promise<Preview> {
  const head = await file.slice(0, 96 * 1024).text();
  const rows = parseCsv(head.slice(0, head.lastIndexOf("\n") > 0 ? head.lastIndexOf("\n") : undefined));
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const mapping = mapHeaders(headers);
  return { headers, rows: rows.slice(1, 6), mapping, missing: REQUIRED.filter((f) => mapping[f] === -1) };
}

export function ImportPage() {
  const toast = useToast();
  const history = useResource((s) => api.imports.list(s), []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [kind, setKind] = useState<LocationKind>("sekolah");
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "failed">("idle");
  const [upload, setUpload] = useState(0);
  const [live, setLive] = useState<ImportBatch | null>(null);
  const [result, setResult] = useState<ImportBatch | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ImportBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  async function choose(f: File | null) {
    setResult(null);
    setFailure(null);
    setPhase("idle");
    setPreviewError(null);
    setPreview(null);
    setFile(f);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name) && f.type !== "text/csv") {
      setPreviewError("Berkas harus berformat CSV.");
      return;
    }
    try {
      setPreview(await readPreview(f));
    } catch {
      setPreviewError("Berkas tidak bisa dibaca.");
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    void choose(e.dataTransfer.files[0] ?? null);
  }

  async function start() {
    if (!file) return;
    setPhase("uploading");
    setUpload(0);
    setLive(null);
    setFailure(null);
    let batch: ImportBatch | null = null;
    try {
      batch = await api.imports.create(file.name, kind);
      const id = batch.id;
      poll.current = setInterval(() => void api.imports.get(id).then((b) => b.status === "berjalan" && setLive(b)).catch(() => {}), 1000);
      const done = await api.imports.upload(id, file, (fr) => {
        setUpload(fr);
        if (fr >= 1) setPhase("processing");
      });
      setResult(done);
      setPhase("done");
      toast.ok(`${formatNumber(done.inserted)} lokasi diimpor.`);
    } catch (e) {
      setFailure(e instanceof ApiError || e instanceof Error ? e.message : "Impor gagal.");
      setPhase("failed");
    } finally {
      if (poll.current) clearInterval(poll.current);
      history.reload();
    }
  }

  async function cancelBatch() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const r = await api.imports.cancel(cancelTarget.id);
      toast.ok(`${formatNumber(r.removed)} lokasi dari impor ini dihapus.`);
      setCancelTarget(null);
      history.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membatalkan impor.");
    } finally {
      setCancelling(false);
    }
  }

  const busy = phase === "uploading" || phase === "processing";
  const canStart = Boolean(file && preview && preview.missing.length === 0 && !busy);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impor data</h1>
        <p className="text-ink-2">Unggah berkas CSV berisi sekolah, fasilitas, atau aset. Berkas diproses bertahap di server, ukuran besar tidak masalah.</p>
      </div>

      <section className="rounded-card border border-line bg-surface p-4 md:p-5" aria-label="Unggah berkas">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn("flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-10 text-center transition-colors duration-150", drag ? "border-accent bg-accent/10" : "border-line")}
        >
          <span className="grid size-11 place-items-center rounded-full bg-navy text-accent">
            <Icon name="upload" size={22} />
          </span>
          <div>
            <p className="font-medium">{file ? file.name : "Tarik berkas CSV ke sini"}</p>
            <p className="text-[13px] text-ink-2">{file ? (file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`) : "atau pilih dari perangkat Anda"}</p>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Pilih berkas CSV" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {file ? "Ganti berkas" : "Pilih berkas"}
          </Button>
        </div>
        {previewError && (
          <p role="alert" className="mt-3 text-danger">
            {previewError}
          </p>
        )}

        {preview && (
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <h2 className="mb-2 font-semibold">Kolom yang dikenali</h2>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(FIELD_LABEL) as MappedField[]).map((f) => {
                  const idx = preview.mapping[f];
                  const ok = idx >= 0;
                  const required = REQUIRED.includes(f);
                  return (
                    <li key={f} className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-2">
                      <span>
                        {FIELD_LABEL[f]}
                        {required && <span className="text-ink-2"> (wajib)</span>}
                      </span>
                      <span className={cn("truncate text-[13px]", ok ? "font-medium" : required ? "text-danger" : "text-ink-2")}>{ok ? preview.headers[idx] : required ? "Tidak ditemukan" : "Tidak ada"}</span>
                    </li>
                  );
                })}
              </ul>
              {preview.missing.length > 0 && (
                <p role="alert" className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-danger">
                  Kolom wajib belum ada: {preview.missing.map((m) => FIELD_LABEL[m]).join(", ")}. Ubah judul kolom di berkas, lalu pilih ulang.
                </p>
              )}
              <p className="mt-2 text-[13px] text-ink-2">Kolom lain disimpan sebagai data tambahan pada setiap lokasi.</p>
            </div>

            <div className="overflow-x-auto rounded-control border border-line">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Pratinjau lima baris pertama</caption>
                <thead className="bg-surface-2 text-ink-2">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        {h || `Kolom ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {preview.headers.map((_, j) => (
                        <td key={j} className="max-w-48 truncate px-3 py-2">
                          {r[j]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="Jenis untuk baris tanpa kolom Jenis" className="w-full sm:w-64">
                {(p) => (
                  <Select {...p} value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as LocationKind)}>
                    {LOCATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="primary" icon="upload" busy={busy} disabled={!canStart} onClick={() => void start()}>
                Mulai impor
              </Button>
            </div>
          </div>
        )}

        {busy && (
          <div className="mt-5" role="status" aria-live="polite">
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="font-medium">{phase === "uploading" ? "Mengunggah berkas" : "Memproses di server"}</span>
              <span className="num text-ink-2">{phase === "uploading" ? `${Math.round(upload * 100)}%` : live ? `${formatNumber(live.inserted)} lokasi masuk` : "Menyiapkan"}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${phase === "uploading" ? upload * 100 : 100}%` }} />
            </div>
          </div>
        )}

        {phase === "failed" && failure && (
          <p role="alert" className="mt-5 rounded-control bg-danger/10 px-3 py-2 text-danger">
            {failure}
          </p>
        )}

        {phase === "done" && result && (
          <div className="rise mt-5 rounded-card border border-line bg-surface-2 p-4" role="status">
            <h2 className="font-semibold">Impor selesai</h2>
            <dl className="mt-2 grid grid-cols-3 gap-3">
              <Stat label="Baris dibaca" value={result.total} />
              <Stat label="Masuk" value={result.inserted} tone="ok" />
              <Stat label="Dilewati" value={result.failed} tone={result.failed ? "danger" : undefined} />
            </dl>
            {result.errors.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer font-medium">Lihat baris yang dilewati{result.failed > result.errors.length ? ` (${result.errors.length} pertama)` : ""}</summary>
                <ul className="mt-2 max-h-56 overflow-y-auto text-[13px]">
                  {result.errors.map((e) => (
                    <li key={e.row} className="border-t border-line py-1.5">
                      <span className="num font-medium">Baris {e.row}:</span> {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section aria-label="Riwayat impor" className="overflow-hidden rounded-card border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Riwayat impor</h2>
        {history.status === "loading" && !history.data && <SkeletonRows rows={3} />}
        {history.status === "error" && <ErrorState error={history.error} onRetry={history.reload} />}
        {history.data && history.data.items.length === 0 && <EmptyState title="Belum ada impor">Impor pertama Anda akan tercatat di sini dan bisa dibatalkan per berkas.</EmptyState>}
        {history.data && history.data.items.length > 0 && (
          <ul>
            {history.data.items.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.filename}</p>
                  <p className="text-[13px] text-ink-2">
                    {formatDate(b.createdAt)} · {STATUS_LABEL[b.status]} · <span className="num">{formatNumber(b.inserted)}</span> masuk, <span className="num">{formatNumber(b.failed)}</span> dilewati
                  </p>
                </div>
                {b.status !== "dibatalkan" && b.inserted > 0 && (
                  <Button variant="ghost" icon="undo" onClick={() => setCancelTarget(b)}>
                    Batalkan impor
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title="Batalkan impor">
        <p>
          Seluruh <span className="num font-semibold">{formatNumber(cancelTarget?.inserted)}</span> lokasi dari berkas <span className="font-semibold">{cancelTarget?.filename}</span> akan dihapus. Lokasi dari impor lain tidak terpengaruh.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setCancelTarget(null)}>Kembali</Button>
          <Button variant="danger" busy={cancelling} onClick={() => void cancelBatch()}>
            Hapus hasil impor
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "danger" | undefined }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className={cn("num text-2xl font-semibold", tone === "ok" && "text-ok", tone === "danger" && "text-danger")}>{formatNumber(value)}</dd>
    </div>
  );
}
