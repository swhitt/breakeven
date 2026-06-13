import { Component, type ReactNode } from "react";

/**
 * Keeps a render throw (e.g. a malformed weekly data refresh or a Recharts
 * crash on a degenerate dataset) from blanking the whole page.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      this.props.fallback ?? (
        <div className="mx-auto max-w-md p-8 text-center text-sm text-muted">
          Something broke rendering this. Try reloading the page.
        </div>
      )
    );
  }
}
