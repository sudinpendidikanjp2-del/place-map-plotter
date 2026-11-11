import { useRef, useState, type FormEvent } from "react";
import { KIND_LABEL, LEVELS, LOCATION_KINDS, validateLocationInput, type FieldErrors, type Location, type LocationInput } from "@peta/domain";
import { ApiError, api, type PlaceResult } from "../../data/api.ts";
import { prepareImage, type PreparedImage } from "../../shared/lib/image.ts";
import { Button, Dialog, Field, IconButton, Input, Select, Spinner, Textarea } from "../../shared/ui/primitives.tsx";
import { Icon } from "../../shared/ui/icons.tsx";
import { useToast } from "../../shared/ui/toast.tsx";

type Draft = Record<
  "kind" | "name" | "category" | "level" | "npsn" | "latitude" | "longitude" | "address" | "province" | "city" | "district" | "description" | "foundedYear" | "photoUrl" | "students" | "teachers",
  string
>;

const MAX_IMAGES = 8;

function toDraft(l: Location | null, at?: { lat: number; lng: number }): Draft {
  return {
    kind: l?.kind ?? "sekolah",
    name: l?.name ?? "",
    category: l?.category ?? "",
    level: l?.level ?? "",
    npsn: l?.npsn ?? "",
    latitude: l ? String(l.latitude) : at ? at.lat.toFixed(6) : "",
    longitude: l ? String(l.longitude) : at ? at.lng.toFixed(6) : "",
    address: l?.address ?? "",
    province: l?.province ?? "",
    city: l?.city ?? "",
    district: l?.district ?? "",
    description: l?.description ?? "",
    foundedYear: l?.foundedYear?.toString() ?? "",
    photoUrl: l?.photoUrl ?? "",
    students: l?.students?.toString() ?? "",
    teachers: l?.teachers?.toString() ?? "",
  };
}

export function LocationForm({
  open,
  location,
  at,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  location: Location | null;
  at?: { lat: number; lng: number } | undefined;
  categories: string[];
  onClose: () => void;
  onSaved: (l: Location) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={location ? "Ubah lokasi" : "Tambah lokasi"} wide>
      {open && <Inner key={location?.id ?? "baru"} location={location} at={at} categories={categories} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function Inner({ location, at, categories, onClose, onSaved }: { location: Location | null; at: { lat: number; lng: number } | undefined; categories: string[]; onClose: () => void; onSaved: (l: Location) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(location, at));
  const [attrs, setAttrs] = useState<[string, string][]>(() => Object.entries(location?.attributes ?? {}));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [existing, setExisting] = useState(location?.images ?? []);
  const [queued, setQueued] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((s) => ({ ...s, [k]: e.target.value }));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setPreparing(true);
    const room = MAX_IMAGES - existing.length - queued.length;
    const accepted: PreparedImage[] = [];
    for (const f of Array.from(files).slice(0, Math.max(0, room))) {
      try {
        accepted.push(await prepareImage(f));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gambar tidak bisa dipakai.");
      }
    }
    if (files.length > room) toast.error(`Maksimal ${MAX_IMAGES} gambar per lokasi.`);
    setQueued((q) => [...q, ...accepted]);
    setPreparing(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removeExisting(id: string) {
    try {
      await api.images.remove(id);
      setExisting((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus gambar.");
    }
  }

  async function uploadQueued(locationId: string): Promise<number> {
    let failed = 0;
    for (let i = 0; i < queued.length; i++) {
      const img = queued[i]!;
      setProgress(`Mengunggah gambar ${i + 1} dari ${queued.length}`);
      try {
        const { id } = await api.images.create(locationId, { mime: img.mime, width: img.width, height: img.height });
        await api.images.upload(id, "full", img.full);
        await api.images.upload(id, "thumb", img.thumb);
      } catch {
        failed++;
      }
    }
    return failed;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const attributes: Record<string, string> = {};
    for (const [k, v] of attrs) if (k.trim() && v.trim()) attributes[k.trim()] = v;
    const v = validateLocationInput({ ...d, attributes });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      const saved = location ? await api.update(location.id, v.value as LocationInput, location.version) : await api.create(v.value as LocationInput);
      let finalLocation = saved;
      if (queued.length) {
        const failed = await uploadQueued(saved.id);
        finalLocation = await api.get(saved.id);
        if (failed) toast.error(`${failed} dari ${queued.length} gambar gagal diunggah. Buka Ubah untuk mencoba lagi.`);
      }
      toast.ok(location ? "Perubahan disimpan." : "Lokasi ditambahkan.");
      onSaved(finalLocation);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details as FieldErrors);
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const isSchool = d.kind === "sekolah";
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <PlaceSearch
        onPick={(p: PlaceResult) =>
          setD((s) => ({ ...s, name: s.name || p.name, address: p.address ?? s.address, latitude: p.latitude.toFixed(6), longitude: p.longitude.toFixed(6) }))
        }
      />

      <Field label="Jenis" error={errors.kind}>
        {(p) => (
          <Select {...p} value={d.kind} onChange={set("kind")}>
            {LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {isSchool ? (
        <Field label="Jenjang" error={errors.level}>
          {(p) => (
            <Select {...p} value={d.level} onChange={set("level")}>
              <option value="">Pilih jenjang</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Kategori" error={errors.category} hint="Contoh: Laboratorium, Tanah, Kendaraan dinas">
          {(p) => (
            <>
              <Input {...p} list="kategori-saran" value={d.category} onChange={set("category")} />
              <datalist id="kategori-saran">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      )}
      <Field label="Nama" error={errors.name} className="sm:col-span-2">
        {(p) => <Input {...p} required value={d.name} onChange={set("name")} />}
      </Field>
      {isSchool && (
        <Field label="NPSN" error={errors.npsn} hint="8 digit. Dipakai untuk memperbarui data dari Dapodik.">
          {(p) => <Input {...p} inputMode="numeric" maxLength={8} value={d.npsn} onChange={set("npsn")} />}
        </Field>
      )}
      <Field label="Lintang" error={errors.latitude} hint="Antara -90 dan 90">
        {(p) => <Input {...p} inputMode="decimal" required value={d.latitude} onChange={set("latitude")} />}
      </Field>
      <Field label="Bujur" error={errors.longitude} hint="Antara -180 dan 180">
        {(p) => <Input {...p} inputMode="decimal" required value={d.longitude} onChange={set("longitude")} />}
      </Field>
      <Field label="Alamat" error={errors.address} className="sm:col-span-2">
        {(p) => <Input {...p} value={d.address} onChange={set("address")} />}
      </Field>
      <details className="sm:col-span-2" open={Boolean(d.province || d.city || d.district)}>
        <summary className="cursor-pointer text-[13px] font-medium">Wilayah (otomatis dari alamat, isi bila ingin menimpa)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Provinsi" error={errors.province}>
            {(p) => <Input {...p} value={d.province} onChange={set("province")} />}
          </Field>
          <Field label="Kota atau kabupaten" error={errors.city}>
            {(p) => <Input {...p} value={d.city} onChange={set("city")} />}
          </Field>
          <Field label="Kecamatan" error={errors.district}>
            {(p) => <Input {...p} value={d.district} onChange={set("district")} />}
          </Field>
        </div>
      </details>
      {isSchool && (
        <>
          <Field label="Jumlah murid" error={errors.students}>
            {(p) => <Input {...p} inputMode="numeric" value={d.students} onChange={set("students")} />}
          </Field>
          <Field label="Jumlah guru" error={errors.teachers}>
            {(p) => <Input {...p} inputMode="numeric" value={d.teachers} onChange={set("teachers")} />}
          </Field>
        </>
      )}
      <Field label="Tahun berdiri" error={errors.foundedYear}>
        {(p) => <Input {...p} inputMode="numeric" value={d.foundedYear} onChange={set("foundedYear")} />}
      </Field>
      {isSchool && (
        <Field label="Kategori tambahan" error={errors.category} hint="Opsional, mis. Negeri atau Swasta">
          {(p) => <Input {...p} value={d.category} onChange={set("category")} />}
        </Field>
      )}
      <Field label="Keterangan" error={errors.description} className="sm:col-span-2">
        {(p) => <Textarea {...p} value={d.description} onChange={set("description")} />}
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">
          Gambar ({existing.length + queued.length} dari {MAX_IMAGES})
        </legend>
        <div className="flex flex-wrap gap-2">
          {existing.map((im) => (
            <figure key={im.id} className="relative size-20 overflow-hidden rounded-control border border-line">
              <img src={api.images.url(im.id, "thumb")} alt="Gambar lokasi" className="size-full object-cover" />
              <IconButton icon="close" label="Hapus gambar ini" className="absolute right-0.5 top-0.5 size-7 bg-surface/90" onClick={() => void removeExisting(im.id)} />
            </figure>
          ))}
          {queued.map((im, i) => (
            <figure key={im.preview} className="relative size-20 overflow-hidden rounded-control border-2 border-accent">
              <img src={im.preview} alt="Gambar yang akan diunggah" className="size-full object-cover" />
              <IconButton icon="close" label="Batalkan gambar ini" className="absolute right-0.5 top-0.5 size-7 bg-surface/90" onClick={() => setQueued((q) => q.filter((_, j) => j !== i))} />
            </figure>
          ))}
          {existing.length + queued.length < MAX_IMAGES && (
            <>
              <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" aria-label="Pilih gambar" onChange={(e) => void addFiles(e.target.files)} />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={preparing}
                className="grid size-20 place-items-center rounded-control border-2 border-dashed border-line text-ink-2 hover:bg-surface-2"
              >
                {preparing ? <Spinner /> : <span className="flex flex-col items-center text-[12px]"><Icon name="image" size={20} />Tambah</span>}
              </button>
            </>
          )}
        </div>
        <p className="mt-1.5 text-[13px] text-ink-2">Gambar dikecilkan di peramban sebelum diunggah dan data lokasi kamera (EXIF) dibuang.</p>
      </fieldset>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">Data tambahan</legend>
        <div className="flex flex-col gap-2">
          {attrs.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Nama kolom ${i + 1}`} placeholder="Nama kolom" value={k} onChange={(e) => setAttrs((a) => a.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
              <Input aria-label={`Nilai ${i + 1}`} placeholder="Nilai" value={v} onChange={(e) => setAttrs((a) => a.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
              <Button aria-label={`Hapus kolom ${i + 1}`} variant="ghost" icon="close" onClick={() => setAttrs((a) => a.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button variant="ghost" icon="plus" onClick={() => setAttrs((a) => [...a, ["", ""]])}>
              Tambah kolom
            </Button>
          </div>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {progress && (
          <p role="status" className="mr-auto text-[13px] text-ink-2">
            {progress}
          </p>
        )}
        <Button onClick={onClose} disabled={busy}>
          Batal
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

/** Mencari titik lintang dan bujur dari nama tempat lewat server (Google Places). Hasil dipilih untuk mengisi form. */
function PlaceSearch({ onPick }: { onPick: (p: PlaceResult) => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; items: PlaceResult[]; message?: string }>({ status: "idle", items: [] });

  async function search() {
    if (q.trim().length < 3) return;
    setState({ status: "busy", items: [] });
    try {
      const r = await api.places.search(q.trim());
      setState({ status: "done", items: r.items });
    } catch (e) {
      setState({ status: "error", items: [], message: e instanceof Error ? e.message : "Pencarian gagal." });
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-2 p-3 sm:col-span-2">
      <label htmlFor="cari-tempat" className="text-[13px] font-medium">
        Cari titik dari nama tempat
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="cari-tempat"
          placeholder="Mis. SDN Menteng 01 Jakarta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <Button icon="search" busy={state.status === "busy"} disabled={q.trim().length < 3} onClick={() => void search()}>
          Cari
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {state.message}
        </p>
      )}
      {state.status === "done" && state.items.length === 0 && <p className="mt-2 text-[13px] text-ink-2">Tidak ada tempat yang cocok. Coba tambahkan nama kota.</p>}
      {state.items.length > 0 && (
        <ul className="mt-2 flex flex-col">
          {state.items.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => { onPick(p); setState({ status: "idle", items: [] }); }} className="w-full rounded-control px-2 py-1.5 text-left hover:bg-surface">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-[13px] text-ink-2">
                  {p.address ?? "Alamat tidak tersedia"} · <span className="num">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
