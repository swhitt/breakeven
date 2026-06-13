import { useEffect, useState } from "react";

type Mode = "light" | "dark";

const META_LIGHT = "#faf9f5";
const META_DARK = "#131210";

// The inline script in index.html has already set the class before paint;
// read it back so React state matches the rendered DOM (no hydration flash).
function getInitial(): Mode {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

export function useTheme() {
  const [mode, setMode] = useState<Mode>(getInitial);

  useEffect(() => {
    const dark = mode === "dark";
    document.documentElement.classList.toggle("dark", dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? META_DARK : META_LIGHT);
  }, [mode]);

  // Persist only on an explicit choice so system preference is still followed
  // until the user actually picks a side.
  const toggle = () =>
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* storage may be unavailable; ignore */
      }
      return next;
    });

  return { mode, toggle };
}

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink transition-colors hover:bg-surface"
    >
      {dark ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path
            strokeLinecap="round"
            d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"
          />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
