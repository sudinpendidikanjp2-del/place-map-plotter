import { useState } from "react";
import { api, type SyncRun } from "../../data/api.ts";
import { formatNumber } from "../../shared/lib/format.ts";
import { useResource } from "../../shared/lib/hooks.ts";
import { Button, Dialog, EmptyState, ErrorState, Field, Input, SkeletonRows } from "../../shared/ui/primitives.tsx";
import { useToast } from "../../shared/ui/toast.tsx";
import { cn } from "../../shared/lib/cn.ts";

const STATUS: Record<SyncRun["status"], string> = { berjalan: "Berjalan", selesai: "Selesai", gagal: "Gagal", ditolak: "Ditolak penjaga" };
const STALE_DAYS = 10;

const when = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function SyncPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sinkronisasi</h1>
        <p className="text-ink-2">Penarikan data berkala dari Dapodik oleh pekerja terjadwal, pencarian koordinat otomatis, dan token API pekerja.</p>
      </div>
      <Runs />
      <Geocode />
      <Tokens />
    </div>
  );
}

function Runs() {
  const runs = useResource((s) => api.sync.runs(s), []);
  const last = runs.data?.lastSuccess;
  const staleDays = last ? Math.floor((Date.now() - new Date(last.finishedAt ?? last.startedAt).getTime()) / 86_400_000) : null;
  return (
    <section aria-label="Riwayat sinkronisasi" className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">Riwayat penarikan Dapodik</h2>
        <Button variant="ghost" icon="undo" onClick={runs.reload}>
          Muat ulang
        </Button>
      </div>
      {runs.status === "loading" && !runs.data && <SkeletonRows rows={3} />}
      {runs.status === "error" && <ErrorState error={runs.error} onRetry={runs.reload} />}
      {runs.data && (
        <>
          {runs.data.items.length === 0 ? (
            <EmptyState title="Belum ada penarikan">Pekerja terjadwal melaporkan setiap eksekusinya di sini. Lihat apps/sync/README.md untuk memasangnya.</EmptyState>
          ) : (
            <>
              {staleDays !== null && staleDays >= STALE_DAYS && (
                <p role="alert" className="border-b border-line bg-danger/10 px-4 py-2 text-danger">
                  Penarikan berhasil terakhir {staleDays} hari lalu. Periksa jadwal dan log pekerja.
                </p>
              )}
              {!last && (
                <p role="alert" className="border-b border-line bg-danger/10 px-4 py-2 text-danger">
                  Belum ada penarikan yang berhasil.
                </p>
              )}
              <ul>
                {runs.data.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0">
                    <span className={cn("rounded-md px-2 py-0.5 text-[12px] font-medium", r.status === "selesai" ? "bg-ok/15 text-ok" : r.status === "berjalan" ? "bg-surface-2 text-ink-2" : "bg-danger/10 text-danger")}>{STATUS[r.status]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {r.source} · {r.scope}
                      </p>
                      <p className="text-[13px] text-ink-2">
                        {when(r.startedAt)} · <span className="num">{formatNumber(r.schoolsSeen)}</span> sekolah, <span className="num">{formatNumber(r.inserted)}</span> baru, <span className="num">{formatNumber(r.updated)}</span> diperbarui, <span className="num">{formatNumber(r.failed)}</span> gagal
                      </p>
                      {r.message && <p className="text-[13px] text-ink-2">{r.message}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Geocode() {
  const toast = useToast();
  const status = useResource((s) => api.geocode.status(s), []);
  const [busy, setBusy] = useState(false);
  const st = status.data;

  async function run() {
    setBusy(true);
    try {
      const r = await api.geocode.run(50);
      toast.ok(`${r.found} koordinat ditemukan dari ${r.tried} pencarian.${r.stopped ? ` ${r.stopped}` : ""}`);
      status.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pencarian gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Koordinat otomatis" className="rounded-card border border-line bg-surface p-4">
      <h2 className="font-semibold">Pencarian koordinat otomatis</h2>
      <p className="mt-1 text-ink-2">Sekolah dari Dapodik tidak membawa koordinat. Titiknya dicari lewat Google Places dari nama dan wilayah, ditandai perkiraan, dan baru dianggap benar setelah diperiksa. Setiap pencarian memakai kuota Google berbayar.</p>
      {status.status === "error" && <ErrorState error={status.error} onRetry={status.reload} />}
      {st && (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Belum punya titik" value={st.missing} />
            <Fact label="Titik perkiraan" value={st.geocoded} />
            <Fact label="Gagal 3 kali" value={st.exhausted} />
            <Fact label="Kuota hari ini" value={`${formatNumber(st.usedToday)} / ${formatNumber(st.dailyLimit)}`} />
          </dl>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" icon="search" busy={busy} disabled={!st.configured || st.missing === 0} onClick={() => void run()}>
              Cari 50 koordinat sekarang
            </Button>
            {!st.configured && <p className="text-[13px] text-danger">GOOGLE_SERVER_KEY belum diatur di server.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num text-xl font-semibold">{typeof value === "number" ? formatNumber(value) : value}</dd>
    </div>
  );
}

function Tokens() {
  const toast = useToast();
  const tokens = useResource((s) => api.tokens.list(s), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const t = await api.tokens.create(name);
      setCreated(t.token);
      setCreating(false);
      setName("");
      tokens.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.tokens.revoke(id);
      toast.ok("Token dicabut.");
      tokens.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencabut token.");
    }
  }

  return (
    <section aria-label="Token API" className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-semibold">Token API</h2>
          <p className="text-[13px] text-ink-2">Untuk pekerja terjadwal. Token hanya bisa mengimpor dan melaporkan sinkronisasi, tidak bisa membaca atau menghapus data.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          Buat token
        </Button>
      </div>
      {tokens.status === "loading" && !tokens.data && <SkeletonRows rows={2} />}
      {tokens.status === "error" && <ErrorState error={tokens.error} onRetry={tokens.reload} />}
      {tokens.data && tokens.data.items.length === 0 && <EmptyState title="Belum ada token" />}
      {tokens.data && tokens.data.items.length > 0 && (
        <ul>
          {tokens.data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t.name}
                  {t.revokedAt && <span className="ml-2 rounded-md bg-danger/10 px-1.5 py-0.5 text-[12px] font-normal text-danger">Dicabut</span>}
                </p>
                <p className="text-[13px] text-ink-2">
                  Dibuat {when(t.createdAt)} · {t.lastUsedAt ? `dipakai terakhir ${when(t.lastUsedAt)}` : "belum pernah dipakai"}
                </p>
              </div>
              {!t.revokedAt && (
                <Button variant="ghost" className="text-danger" onClick={() => void revoke(t.id)}>
                  Cabut
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Buat token API">
        <div className="flex flex-col gap-4">
          <Field label="Nama token" hint="Mis. Pekerja Dapodik Jakarta Pusat">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Batal</Button>
            <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void create()}>
              Buat
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={created !== null} onClose={() => setCreated(null)} title="Token dibuat">
        <p>Salin token ini sekarang. Token tidak akan ditampilkan lagi.</p>
        <code className="mt-3 block break-all rounded-control bg-surface-2 p-3 font-mono text-[13px]">{created}</code>
        <div className="mt-4 flex justify-end gap-2">
          <Button icon="check" onClick={() => void navigator.clipboard?.writeText(created ?? "").then(() => toast.ok("Token disalin."))}>
            Salin
          </Button>
          <Button variant="primary" onClick={() => setCreated(null)}>
            Selesai
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
