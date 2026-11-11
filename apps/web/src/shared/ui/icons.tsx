import type { SVGProps } from "react";

/** Ikon SVG sendiri, hanya yang dipakai. Semua dekoratif (aria-hidden), nama diberikan oleh tombol atau teks di sekitarnya. */
const PATHS = {
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9 15.5-4.2-4.2",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4",
  trash: "M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12M10 11v5m4-5v5",
  download: "M12 4v11m-4-4 4 4 4-4M5 19h14",
  upload: "M12 16V5m-4 4 4-4 4 4M5 19h14",
  map: "M9 5 4 7v12l5-2 6 2 5-2V5l-5 2-6-2Zm0 0v12m6-10v12",
  table: "M4 6h16v12H4V6Zm0 4.5h16M4 14.5h16M9.5 6v12",
  report: "M6 4h9l3 3v13H6V4Zm9 0v3h3M9 12h6M9 16h6M9 9h2",
  users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8c0-3 2.2-5 5-5s5 2 5 5m1-8a2.5 2.5 0 1 0 0-5m2.5 8c1.9.4 3.5 2 3.5 4",
  filter: "M4 6h16M7 12h10M10 18h4",
  route: "M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 16h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h3",
  circle: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-8h8",
  polygon: "M6 6.5 18 5l2 9-8 5-8-4 2-8.5Z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5Z",
  logout: "M10 5H5v14h5m4-4 4-3-4-3m4 3H9",
  check: "m5 12.5 4.5 4.5L19 7.5",
  alert: "M12 4 3 19h18L12 4Zm0 5.5v4m0 3h.01",
  chevron: "m7 10 5 5 5-5",
  chevronRight: "m10 7 5 5-5 5",
  menu: "M4 7h16M4 12h16M4 17h16",
  locate: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 3v3m0 12v3M3 12h3m12 0h3",
  expand: "M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5",
  school: "M4 19h16M6 19V9l6-4 6 4v10M10 19v-5h4v5M12 5V3",
  tool: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5L16 12l-3-1-1-3 2.5-2.5Z",
  box: "M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 9L4 7.5M12 12l8-4.5M12 12v9",
  student: "M12 4 3 8.5 12 13l9-4.5L12 4Zm-6 6.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5",
  image: "M5 5h14v14H5V5Zm0 11 4-4 3 3 3-3 4 4M9 9.5h.01",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l3 2",
  undo: "M9 8 4 12l5 4m-5-4h10a5 5 0 0 1 0 10h-3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
