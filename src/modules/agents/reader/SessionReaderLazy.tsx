import { lazy, Suspense } from "react";
import type { SessionReaderProps } from "./SessionReader";

// The Reader pulls Streamdown and the code highlighter: keep it out of startup.
const SessionReaderInner = lazy(() => import("./SessionReader"));

export function SessionReader(props: SessionReaderProps) {
  return (
    <Suspense
      fallback={<div className="absolute inset-0 z-[6] bg-background" />}
    >
      <SessionReaderInner {...props} />
    </Suspense>
  );
}
