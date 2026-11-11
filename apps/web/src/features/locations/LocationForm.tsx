import { useState, type FormEvent } from "react";
import { KIND_LABEL, LOCATION_KINDS, validateLocationInput, type FieldErrors, type Location, type LocationInput } from "@peta/domain";
import { ApiError, api } from "../../data/api.ts";
import { Button, Dialog, Field, Input, Select, Textarea } from "../../shared/ui/primitives.tsx";
import { useToast } from "../../shared/ui/toast.tsx";

type Draft = Record<"kind" | "name" | "category" | "latitude" | "longitude" | "address" | "description" | "foundedYear" | "photoUrl" | "students" | "teachers", string>;

function toDraft(l: Location | null, at?: { lat: number; lng: number }): Draft {
  return {
    kind: l?.kind ?? "sekolah",
    name: l?.name ?? "",
    category: l?.category ?? "",
    latitude: l ? String(l.latitude) : at ? at.lat.toFixed(6) : "",
    longitude: l ? String(l.longitude) : at ? at.lng.toFixed(6) : "",
    address: l?.address ?? "",
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
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((s) => ({ ...s, [k]: e.target.value }));

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
      toast.ok(location ? "Perubahan disimpan." : "Lokasi ditambahkan.");
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details as FieldErrors);
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  const isSchool = d.kind === "sekolah";
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
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
      <Field label="Kategori" error={errors.category} hint="Contoh: SD, SMP, Laboratorium, Tanah">
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
      <Field label="Nama" error={errors.name} className="sm:col-span-2">
        {(p) => <Input {...p} required value={d.name} onChange={set("name")} />}
      </Field>
      <Field label="Lintang" error={errors.latitude} hint="Antara -90 dan 90">
        {(p) => <Input {...p} inputMode="decimal" required value={d.latitude} onChange={set("latitude")} />}
      </Field>
      <Field label="Bujur" error={errors.longitude} hint="Antara -180 dan 180">
        {(p) => <Input {...p} inputMode="decimal" required value={d.longitude} onChange={set("longitude")} />}
      </Field>
      <Field label="Alamat" error={errors.address} hint="Sertakan Kec., Kota/Kabupaten, dan provinsi agar bisa difilter per wilayah." className="sm:col-span-2">
        {(p) => <Input {...p} value={d.address} onChange={set("address")} />}
      </Field>
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
      <Field label="Tautan foto" error={errors.photoUrl}>
        {(p) => <Input {...p} type="url" placeholder="https://" value={d.photoUrl} onChange={set("photoUrl")} />}
      </Field>
      <Field label="Keterangan" error={errors.description} className="sm:col-span-2">
        {(p) => <Textarea {...p} value={d.description} onChange={set("description")} />}
      </Field>

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

      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" busy={busy}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
