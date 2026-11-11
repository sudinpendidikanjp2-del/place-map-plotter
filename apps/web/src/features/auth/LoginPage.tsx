import { useState, type FormEvent } from "react";
import { useAuth } from "../../app/auth.tsx";
import { APP_NAME } from "../../app/env.ts";
import { ApiError } from "../../data/api.ts";
import { Button, Field, Input } from "../../shared/ui/primitives.tsx";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tidak dapat masuk saat ini.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <form onSubmit={submit} className="rise w-full max-w-sm rounded-float border border-line bg-surface p-6 shadow-float" noValidate>
        <div className="mb-5 flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-navy text-base font-bold text-accent">
            P
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Masuk</h1>
            <p className="text-ink-2">{APP_NAME}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Email">
            {(p) => <Input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Kata sandi">
            {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {error && (
            <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy} disabled={!email || !password}>
            Masuk
          </Button>
        </div>
        <p className="mt-4 text-[13px] text-ink-2">Akun dibuat oleh admin. Hubungi admin jika Anda belum memilikinya.</p>
      </form>
    </div>
  );
}
