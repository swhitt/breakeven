import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Fires once when the ref'd element first scrolls within ~200px of the viewport, then stops
 * observing. Used to defer the heavy lazy charts (and the recharts/d3 chunk they share, the
 * single largest asset) off the initial load until the user actually scrolls toward them.
 * Falls back to "visible" when IntersectionObserver is missing so the charts never get stranded.
 */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return [ref, inView];
}
