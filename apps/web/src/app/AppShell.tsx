import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth.tsx";
import { Link, useRouter } from "./router.tsx";
import { APP_NAME } from "./env.ts";
import { Icon, type IconName } from "../shared/ui/icons.tsx";
import { IconButton, Kbd } from "../shared/ui/primitives.tsx";
import { useTheme } from "../shared/lib/theme.ts";
import { cn } from "../shared/lib/cn.ts";
import { CommandSearch } from "../features/search/CommandSearch.tsx";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  show: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const { path } = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const items: NavItem[] = [
    { to: "/", label: "Peta", icon: "map", show: true },
    { to: "/data", label: "Data", icon: "table", show: true },
    { to: "/impor", label: "Impor", icon: "upload", show: can("editor") },
    { to: "/laporan", label: "Laporan", icon: "report", show: true },
    { to: "/sinkronisasi", label: "Sinkronisasi", icon: "clock", show: can("admin") },
    { to: "/admin", label: "Admin", icon: "users", show: can("admin") },
  ];
  const visible = items.filter((i) => i.show);
  const onMap = path === "/";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print fixed inset-x-2 top-2 z-30 flex items-center gap-2 rounded-float border border-line bg-(--float-bg) px-3 py-1.5 shadow-float backdrop-blur-md md:inset-x-4 md:top-3">
        <Link to="/" className="flex items-center gap-2 rounded-control px-1 py-1 font-semibold tracking-tight">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-navy text-[13px] font-bold text-accent">
            P
          </span>
          <span className="hidden whitespace-nowrap xl:inline">{APP_NAME}</span>
        </Link>

        <nav aria-label="Utama" className="ml-2 hidden gap-1 rounded-full bg-surface-2 p-1 md:flex">
          {visible.map((i) => (
            <Link
              key={i.to}
              to={i.to}
              aria-current={path === i.to ? "page" : undefined}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150",
                path === i.to ? "bg-surface text-ink shadow-[0_1px_2px_rgb(11_31_75/0.18)]" : "text-ink-2 hover:text-ink",
              )}
            >
              <Icon name={i.icon} size={16} />
              {i.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="mx-auto hidden min-h-10 w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface px-4 text-left text-ink-2 transition-colors duration-150 hover:bg-surface-2 sm:flex"
        >
          <Icon name="search" size={16} />
          <span className="flex-1 truncate">Cari sekolah, fasilitas, atau aset</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <IconButton icon="search" label="Cari lokasi" className="sm:hidden" onClick={() => setSearchOpen(true)} />
          <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap"} onClick={toggleTheme} />
          <div className="hidden text-right leading-tight lg:block">
            <p className="max-w-32 truncate text-[13px] font-medium">{user?.name}</p>
          </div>
          <IconButton icon="logout" label="Keluar" onClick={() => void logout()} />
        </div>
      </header>

      <main className={cn("flex-1", onMap ? "" : "px-3 pb-24 pt-20 md:px-6 md:pb-10 md:pt-24")}>{children}</main>

      <nav aria-label="Utama (seluler)" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
        {visible.map((i) => (
          <Link
            key={i.to}
            to={i.to}
            aria-current={path === i.to ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", path === i.to ? "text-ink" : "text-ink-2")}
          >
            <span className={cn("grid h-7 w-12 place-items-center rounded-full", path === i.to && "bg-accent text-navy")}>
              <Icon name={i.icon} />
            </span>
            {i.label}
          </Link>
        ))}
      </nav>

      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
