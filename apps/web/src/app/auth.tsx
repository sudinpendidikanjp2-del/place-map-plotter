import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { roleAtLeast, type UserRole } from "@peta/domain";
import { ApiError, api, setUnauthorizedHandler, type SessionUser } from "../data/api.ts";

type State = { status: "loading" } | { status: "anon" } | { status: "error"; message: string } | { status: "user"; user: SessionUser };

interface AuthValue {
  state: State;
  user: SessionUser | null;
  can: (min: UserRole) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: "loading" });
    api.me(ctl.signal).then(
      (r) => setState({ status: "user", user: r.user }),
      (e: unknown) => {
        if (ctl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) setState({ status: "anon" });
        else setState({ status: "error", message: e instanceof Error ? e.message : "Gagal memeriksa sesi." });
      },
    );
    return () => ctl.abort();
  }, [nonce]);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: "anon" }));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    setState({ status: "user", user: r.user });
  }, []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setState({ status: "anon" });
  }, []);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AuthValue>(() => {
    const user = state.status === "user" ? state.user : null;
    return { state, user, can: (min) => (user ? roleAtLeast(user.role, min) : false), login, logout, retry };
  }, [state, login, logout, retry]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider belum dipasang.");
  return v;
}
