import { useEffect, useRef, useState, type ReactNode } from "react";

/** Daftar berjendela: hanya baris yang terlihat dirender, sehingga puluhan ribu baris tetap ringan. */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  onEndReached,
  className,
  label,
}: {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => ReactNode;
  onEndReached?: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ top, height }, setView] = useState({ top: 0, height: 600 });
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overscan = 6;
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan);

  useEffect(() => {
    if (end >= items.length - 10) endRef.current?.();
  }, [end, items.length]);

  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      tabIndex={0}
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      className={className}
      style={{ overflowY: "auto", position: "relative" }}
    >
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        {items.slice(start, end).map((item, i) => (
          <div key={start + i} role="listitem" style={{ position: "absolute", top: (start + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
            {render(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
