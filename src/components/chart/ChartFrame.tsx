import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

// One source of truth for chart height. The Suspense fallback in App.tsx and every chart's
// inner wrapper must agree on this exact class or the layout jumps when a lazy chart mounts.
export const CHART_HEIGHT_CLASS = "h-72 w-full sm:h-80";

/**
 * The inner chart shell every horizon chart shares: a fixed-height div carrying the
 * screen-reader summary (role="img" + aria-label, since the SVG itself is opaque to AT)
 * wrapped around a ResponsiveContainer. Charts pass their single Recharts root as children.
 */
export function ChartFrame({ ariaLabel, children }: { ariaLabel: string; children: ReactElement }) {
  return (
    <div className={CHART_HEIGHT_CLASS} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** The shared tooltip card: one place for the rounded-surface-with-shadow styling every
 *  custom chart tooltip repeats, so they can't drift apart. */
export function TooltipCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">{children}</div>;
}
