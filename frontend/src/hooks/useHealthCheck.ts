import { useEffect, useRef, useState } from "react";
import { getHealth } from "../api";
import type { MissionPhase } from "../types";

interface HealthState {
  status: "ok" | "degraded" | "error";
  phase: MissionPhase | null;
  lastHeartbeat: number | null;
}

/**
 * Polls GET /health every 2 seconds.
 * Returns health state and a flag for the connection indicator.
 */
export function useHealthCheck() {
  const [health, setHealth] = useState<HealthState>({
    status: "ok",
    phase: null,
    lastHeartbeat: null,
  });
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
      } catch {
        setHealth((prev) => ({ ...prev, status: "error" }));
      }
    };

    check();
    intervalRef.current = setInterval(check, 2000);

    return () => clearInterval(intervalRef.current);
  }, []);

  return health;
}
