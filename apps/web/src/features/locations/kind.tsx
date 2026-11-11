import { KIND_LABEL, type LocationKind } from "@peta/domain";
import { Icon, type IconName } from "../../shared/ui/icons.tsx";
import { cn } from "../../shared/lib/cn.ts";

export const KIND_ICON: Record<LocationKind, IconName> = { sekolah: "school", fasilitas: "tool", aset: "box" };

/** Penanda jenis: dibedakan oleh bentuk dan isi, tidak hanya warna. */
export function KindBadge({ kind, size = 28, className }: { kind: LocationKind; size?: number; className?: string }) {
  const style: Record<LocationKind, string> = {
    sekolah: "rounded-full bg-navy text-white",
    fasilitas: "rounded-full border-2 border-navy bg-white text-navy",
    aset: "rounded-lg bg-accent text-navy",
  };
  return (
    <span
      role="img"
      aria-label={KIND_LABEL[kind]}
      className={cn("inline-grid shrink-0 place-items-center", style[kind], className)}
      style={{ width: size, height: size }}
    >
      <Icon name={KIND_ICON[kind]} size={Math.round(size * 0.58)} />
    </span>
  );
}
