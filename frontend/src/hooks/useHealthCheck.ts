import { useEffect, useRef, useState } from "react";
import { getHealth } from "../api";
import { useConfigStore } from "../stores/config";
import type { MissionPhase } from "../types";

interface HealthState {
  status: "ok" | "degraded" | "error";
  phase: MissionPhase | null;
  lastHeartbeat: number | null;
}

/**
 * Polls GET /health every 2 seconds.
 * Returns health state and a flag for the connection indicator.
 * Also syncs mock_mode, provider, and LLM reachability from backend into the config store.
 */
export function useHealthCheck() {
  const [health, setHealth] = useState<HealthState>({
    status: "ok",
    phase: null,
    lastHeartbeat: null,
  });
  const setMockMode = useConfigStore((s) => s.setMockMode);
  const setProvider = useConfigStore((s) => s.setProvider);
  const setLlmStatus = useConfigStore((s) => s.setLlmStatus);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const check = async () => {
      try {
        const res = await getHealth();
        setHealth({
          status: res.status,
          phase: null, // Phase comes from WS messages
          lastHeartbeat: Date.now(),
        });
        if (res.mock_mode !== undefined) {
          setMockMode(res.mock_mode);
        }
        if (res.provider) {
          setProvider(res.provider);
        }
        setLlmStatus(
          res.llm_reachable ?? false,
          res.llm_error ?? null,
          res.llm_model ?? null
        );
      } catch {
        setHealth((prev) => ({ ...prev, status: "error" }));
        setLlmStatus(false, "Backend unreachable", null);
      }
    };

    check();
    intervalRef.current = setInterval(check, 2000);

    return () => clearInterval(intervalRef.current);
  }, [setMockMode, setProvider, setLlmStatus]);

  return health;
}
