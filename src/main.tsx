import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./ErrorBoundary";

// Two routes, no router: /calc is the stripped-down "quick answer" mode, everything
// else is the full calculator. Each is lazy so a visit only ships that route's code.
const App = lazy(() => import("./App").then((m) => ({ default: m.App })));
const SimpleCalc = lazy(() => import("./SimpleCalc").then((m) => ({ default: m.SimpleCalc })));

const isCalc = window.location.pathname.replace(/\/+$/, "").endsWith("/calc");
const Route = isCalc ? SimpleCalc : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <Route />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
