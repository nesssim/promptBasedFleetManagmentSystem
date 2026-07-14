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
 * Also syncs mock_mode from backend into the config store.
 */
export function useHealthCheck() {
  const [health, setHealth] = useState<HealthState>({
    status: "ok",
    phase: null,
    lastHeartbeat: null,
  });
  const setMockMode = useConfigStore((s) => s.setMockMode);
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
      } catch {
        setHealth((prev) => ({ ...prev, status: "error" }));
      }
    };

    check();
    intervalRef.current = setInterval(check, 2000);

    return () => clearInterval(intervalRef.current);
  }, [setMockMode]);

  return health;
}
