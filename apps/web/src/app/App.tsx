import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./auth.tsx";
import { RouterProvider, useRouter } from "./router.tsx";
import { ToastProvider } from "../shared/ui/toast.tsx";
import { Button, ErrorState, Spinner } from "../shared/ui/primitives.tsx";
import { AppShell } from "./AppShell.tsx";
import { FilterProvider } from "./filter.tsx";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { MapPage } from "../features/map/MapPage.tsx";
import { DataPage } from "../features/locations/DataPage.tsx";
import { ImportPage } from "../features/import/ImportPage.tsx";
import { AdminPage } from "../features/admin/AdminPage.tsx";

// Pustaka PDF dan grafik hanya dimuat saat layar Laporan dibuka.
const ReportPage = lazy(() => import("../features/report/ReportPage.tsx").then((m) => ({ default: m.ReportPage })));

function Routes() {
  const { path } = useRouter();
  const { can } = useAuth();
  if (path === "/") return <MapPage />;
  if (path === "/data") return <DataPage />;
  if (path === "/impor" && can("editor")) return <ImportPage />;
  if (path === "/laporan")
    return (
      <Suspense fallback={<Centered />}>
        <ReportPage />
      </Suspense>
    );
  if (path === "/admin" && can("admin")) return <AdminPage />;
  return <NotFound />;
}

function Centered() {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-ink-2">
      <Spinner className="size-6" />
    </div>
  );
}

function NotFound() {
  const { navigate } = useRouter();
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div>
        <p className="num text-[40px] font-semibold leading-none">404</p>
        <p className="mt-2 text-ink-2">Halaman ini tidak ada atau Anda tidak memiliki aksesnya.</p>
        <Button className="mt-4" variant="primary" onClick={() => navigate("/")}>
          Kembali ke peta
        </Button>
      </div>
    </div>
  );
}

function Gate() {
  const { state, retry } = useAuth();
  const { path, navigate } = useRouter();
  if (state.status === "loading") return <Centered />;
  if (state.status === "error") return <ErrorState error={new Error(state.message)} onRetry={retry} />;
  if (state.status === "anon") {
    if (path !== "/masuk") queueMicrotask(() => navigate("/masuk", { replace: true }));
    return <LoginPage />;
  }
  if (path === "/masuk") {
    queueMicrotask(() => navigate("/", { replace: true }));
    return null;
  }
  return (
    <FilterProvider>
      <AppShell>
        <Routes />
      </AppShell>
    </FilterProvider>
  );
}

export function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
