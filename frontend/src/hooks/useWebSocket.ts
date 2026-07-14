import { useEffect, useRef, useCallback } from "react";
import { useFleetStore } from "../stores/fleet";
import type { WSMessage } from "../types";

/**
 * WebSocket hook with auto-reconnect, rAF batching, and seq tracking.
 *
 * - Connects to WS /status endpoint
 * - Batches updates via requestAnimationFrame (prevents React re-render storm)
 * - Auto-reconnects on disconnect with 2s backoff
 * - Tracks last seq for state sync on reconnect
 */
export function useWebSocket(url: string = "ws://localhost:5000/status") {
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<WSMessage[]>([]);
  const rafIdRef = useRef<number>(0);
  const setConnected = useFleetStore((s) => s.setConnected);
  const setRobots = useFleetStore((s) => s.setRobots);
  const setStats = useFleetStore((s) => s.setStats);

  const processBatch = useCallback(() => {
    const batch = pendingRef.current;
    pendingRef.current = [];
    rafIdRef.current = 0;

    // Use the latest message for full state
    const latest = batch[batch.length - 1];
    if (!latest) return;

    if (latest.type === "fleet_status" && latest.payload) {
      const p = latest.payload as Record<string, unknown>;
      if (p.robots) setRobots(p.robots as any);
      if (typeof p.tasks_completed === "number" && typeof p.tasks_total === "number") {
        setStats(
          p.tasks_completed as number,
          p.tasks_total as number,
          (p.mission_time_s as number) || 0
        );
      }
    }
  }, [setRobots, setStats]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // On reconnect, send last seq for state sync
      if (seqRef.current > 0) {
        ws.send(JSON.stringify({ type: "sync", last_seq: seqRef.current }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        seqRef.current = msg.seq;
        pendingRef.current.push(msg);

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(processBatch);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2s
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, setConnected, processBatch]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      cancelAnimationFrame(rafIdRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
