import { useState } from "react";
import { KIND_LABEL, type Location } from "@peta/domain";
import { Button, IconButton } from "../../shared/ui/primitives.tsx";
import { Icon } from "../../shared/ui/icons.tsx";
import { formatNumber } from "../../shared/lib/format.ts";
import { KindBadge } from "../locations/kind.tsx";

export function DetailCard({
  location,
  canEdit,
  inRoute,
  onClose,
  onEdit,
  onDelete,
  onToggleRoute,
}: {
  location: Location;
  canEdit: boolean;
  inRoute: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleRoute: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const region = [location.district, location.city, location.province].filter(Boolean).join(", ");
  const attrs = Object.entries(location.attributes);
  const isSchool = location.kind === "sekolah";
  return (
    <aside aria-label={`Detail ${location.name}`} className="rise pointer-events-auto flex max-h-[62dvh] w-full flex-col overflow-hidden rounded-float border border-line bg-surface shadow-float md:max-h-[calc(100dvh-9rem)] md:w-96">
      {location.photoUrl && !photoFailed && (
        <img src={location.photoUrl} alt={`Foto ${location.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} className="h-40 w-full shrink-0 object-cover" />
      )}
      <div className="flex items-start gap-3 p-4 pb-2">
        <KindBadge kind={location.kind} size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug">{location.name}</h2>
          <p className="text-[13px] text-ink-2">
            {KIND_LABEL[location.kind]} · {location.category}
            {location.foundedYear ? ` · berdiri ${location.foundedYear}` : ""}
          </p>
        </div>
        <IconButton icon="close" label="Tutup detail" onClick={onClose} />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
        {isSchool && (location.students !== null || location.teachers !== null) && (
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-control bg-surface-2 px-3 py-2">
              <dt className="text-[13px] text-ink-2">Murid</dt>
              <dd className="num text-[28px] font-semibold leading-tight">{formatNumber(location.students)}</dd>
            </div>
            <div className="rounded-control bg-surface-2 px-3 py-2">
              <dt className="text-[13px] text-ink-2">Guru</dt>
              <dd className="num text-[28px] font-semibold leading-tight">{formatNumber(location.teachers)}</dd>
            </div>
          </dl>
        )}
        {(location.address || region) && (
          <p className="flex gap-2 text-ink-2">
            <Icon name="map" size={16} className="mt-0.5 shrink-0" />
            <span>{location.address ?? region}</span>
          </p>
        )}
        {region && location.address && <p className="text-[13px] text-ink-2">Wilayah: {region}</p>}
        <p className="num text-[13px] text-ink-2">
          {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
        </p>
        {location.description && <p>{location.description}</p>}
        {attrs.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {attrs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-2">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant={inRoute ? "primary" : "secondary"} icon="route" onClick={onToggleRoute}>
            {inRoute ? "Keluarkan dari rute" : "Tambah ke rute"}
          </Button>
          {canEdit && (
            <>
              <Button icon="edit" onClick={onEdit}>
                Ubah
              </Button>
              <Button variant="ghost" icon="trash" onClick={onDelete} className="text-danger">
                Hapus
              </Button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
