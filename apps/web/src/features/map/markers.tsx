import { KIND_LABEL, type ClusterFeature } from "@peta/domain";
import { KindBadge } from "../locations/kind.tsx";
import { formatCompact } from "../../shared/lib/format.ts";
import { cn } from "../../shared/lib/cn.ts";

/** Gelembung cluster: angka adalah isi utamanya. Ukuran naik perlahan mengikuti jumlah. */
export function ClusterBubble({ count }: { count: number }) {
  const size = Math.round(34 + Math.min(26, Math.log10(count) * 9));
  return (
    <div
      className="num grid place-items-center rounded-full border-2 border-white bg-navy text-[13px] font-semibold text-accent shadow-float"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {formatCompact(count)}
    </div>
  );
}

export function PointMarker({ feature, selected, label }: { feature: ClusterFeature; selected: boolean; label?: boolean }) {
  return (
    <div className="flex flex-col items-center" title={`${KIND_LABEL[feature.kind ?? "sekolah"]}: ${feature.name ?? ""}`}>
      <div className={cn("rounded-full transition-transform duration-150", selected ? "scale-125 ring-4 ring-accent" : "hover:scale-110")}>
        <KindBadge kind={feature.kind ?? "sekolah"} size={label ? 24 : 30} className="border-2 border-white shadow-float" />
      </div>
      {label && feature.name && (
        <span className="mt-0.5 max-w-40 truncate rounded-md bg-surface px-1.5 py-0.5 text-[12px] font-medium leading-tight text-ink shadow-[0_1px_3px_rgb(11_31_75/0.3)]">{feature.name}</span>
      )}
    </div>
  );
}
