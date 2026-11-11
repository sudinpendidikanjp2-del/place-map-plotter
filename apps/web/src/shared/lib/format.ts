const nf = new Intl.NumberFormat("id-ID");
const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (n: number | null | undefined): string => (n === null || n === undefined ? "-" : nf.format(n));
export const formatCompact = (n: number): string => compact.format(n);

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} menit`;
  const h = Math.floor(min / 60);
  return `${h} jam ${min % 60} menit`;
}
