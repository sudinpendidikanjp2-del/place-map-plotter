import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => !document.documentElement.dataset.theme && setTheme(current());
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("tema", next);
    } catch {
      /* penyimpanan tidak tersedia, tema tetap berlaku untuk sesi ini */
    }
    setTheme(next);
  }, []);
  return [theme, toggle];
}
