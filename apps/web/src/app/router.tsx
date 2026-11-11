import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

interface RouterValue {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const h = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    const u = new URL(to, window.location.origin);
    setLoc({ path: u.pathname, search: u.search });
    window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ path: loc.path, search: new URLSearchParams(loc.search), navigate }), [loc, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("RouterProvider belum dipasang.");
  return v;
}

/** Tautan internal: tetap berupa <a> sungguhan agar klik tengah, salin tautan, dan keyboard bekerja. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
