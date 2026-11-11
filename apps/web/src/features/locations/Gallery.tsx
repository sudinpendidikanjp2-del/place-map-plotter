import { useEffect, useState } from "react";
import type { LocationImage } from "@peta/domain";
import { api } from "../../data/api.ts";
import { Dialog, IconButton } from "../../shared/ui/primitives.tsx";

/** Deretan thumbnail yang membuka tampilan besar. Panah kiri dan kanan berpindah gambar. */
export function Gallery({ images, name }: { images: LocationImage[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, images.length]);
  if (images.length === 0) return null;
  const current = open === null ? null : images[open];
  return (
    <>
      <ul className="flex gap-1 overflow-x-auto" aria-label={`Gambar ${name}`}>
        {images.map((im, i) => (
          <li key={im.id} className="shrink-0">
            <button type="button" onClick={() => setOpen(i)} aria-label={`Buka gambar ${i + 1} dari ${images.length}`} className="block overflow-hidden rounded-control">
              <img src={api.images.url(im.id, "thumb")} alt={im.caption ?? `Gambar ${i + 1} ${name}`} loading="lazy" className="h-24 w-32 object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={`${name} (${(open ?? 0) + 1} dari ${images.length})`} wide>
        {current && (
          <div className="flex flex-col gap-3">
            <img src={api.images.url(current.id, "full")} alt={current.caption ?? `Gambar ${name}`} className="max-h-[65dvh] w-full rounded-control bg-surface-2 object-contain" />
            {current.caption && <p className="text-ink-2">{current.caption}</p>}
            {images.length > 1 && (
              <div className="flex justify-between">
                <IconButton icon="chevronLeft" label="Gambar sebelumnya" onClick={() => setOpen((open! - 1 + images.length) % images.length)} />
                <IconButton icon="chevronRight" label="Gambar berikutnya" onClick={() => setOpen((open! + 1) % images.length)} />
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
