import { useState, type FormEvent } from "react";
import { ROLE_LABEL, USER_ROLES, type UserRole } from "@peta/domain";
import { ApiError, api, type UserRow } from "../../data/api.ts";
import { useAuth } from "../../app/auth.tsx";
import { formatDate } from "../../shared/lib/format.ts";
import { useResource } from "../../shared/lib/hooks.ts";
import { Button, Dialog, ErrorState, Field, Input, Select, SkeletonRows } from "../../shared/ui/primitives.tsx";
import { useToast } from "../../shared/ui/toast.tsx";

export function AdminPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const users = useResource((s) => api.users.list(s), []);
  const [dialog, setDialog] = useState<"new" | UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(u: UserRow, v: Parameters<typeof api.users.update>[1], okText: string) {
    setBusyId(u.id);
    try {
      await api.users.update(u.id, v);
      toast.ok(okText);
      users.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengguna</h1>
          <p className="text-ink-2">Pembaca hanya melihat data. Penyunting menambah, mengubah, menghapus, dan mengimpor. Admin juga mengelola pengguna.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setDialog("new")}>
          Tambah pengguna
        </Button>
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-surface" aria-label="Daftar pengguna">
        {users.status === "loading" && !users.data && <SkeletonRows rows={4} />}
        {users.status === "error" && <ErrorState error={users.error} onRetry={users.reload} />}
        {users.data && (
          <ul>
            {users.data.items.map((u) => {
              const self = u.id === me?.id;
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {u.name}
                      {self && <span className="ml-2 text-[13px] font-normal text-ink-2">(Anda)</span>}
                      {u.disabled && <span className="ml-2 rounded-md bg-danger/10 px-1.5 py-0.5 text-[12px] font-normal text-danger">Nonaktif</span>}
                    </p>
                    <p className="truncate text-[13px] text-ink-2">
                      {u.email} · dibuat {formatDate(u.createdAt)}
                    </p>
                  </div>
                  <Select
                    aria-label={`Peran ${u.name}`}
                    value={u.role}
                    disabled={self || busyId === u.id}
                    onChange={(e) => void patch(u, { role: e.target.value as UserRole }, "Peran diperbarui.")}
                    className="w-36"
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  <Button variant="ghost" onClick={() => setDialog(u)}>
                    Atur sandi
                  </Button>
                  {!self && (
                    <Button variant="ghost" busy={busyId === u.id} onClick={() => void patch(u, { disabled: !u.disabled }, u.disabled ? "Akun diaktifkan." : "Akun dinonaktifkan.")}>
                      {u.disabled ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <UserDialog
        target={dialog}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          users.reload();
        }}
      />
    </div>
  );
}

function UserDialog({ target, onClose, onDone }: { target: "new" | UserRow | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={target !== null} onClose={onClose} title={target === "new" ? "Tambah pengguna" : "Atur kata sandi"}>
      {target !== null && <UserForm key={target === "new" ? "new" : target.id} target={target} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function UserForm({ target, onClose, onDone }: { target: "new" | UserRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const isNew = target === "new";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (isNew) await api.users.create({ email, name, role, password });
      else await api.users.update(target.id, { password });
      toast.ok(isNew ? "Pengguna ditambahkan." : "Kata sandi diperbarui.");
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      else toast.error(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {isNew ? (
        <>
          <Field label="Nama" error={errors.name}>
            {(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(p) => <Input {...p} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Peran" error={errors.role}>
            {(p) => (
              <Select {...p} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : (
        <p>
          Kata sandi baru untuk <span className="font-semibold">{target.name}</span>. Sesi aktifnya akan diakhiri.
        </p>
      )}
      <Field label="Kata sandi" error={errors.password} hint="Minimal 10 karakter.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant="primary" busy={busy}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
