import { useEffect, useRef } from "react";
import { startBenchDriver } from "./driver";
import type { BenchAppApi } from "./types";

/**
 * Mounted by App only in TERAX_BENCH builds. It hands the live tab actions to the scenario driver
 * (which runs once, after the first render) and renders nothing.
 */
export default function BenchBridge(props: BenchAppApi) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    void startBenchDriver(() => latest.current);
  }, []);
  return null;
}
