/**
 * HTTP API client for the MissionSwarm backend.
 * All functions return typed responses or throw on error.
 */

import type { DAGSpec } from "./types";

const BASE = "http://localhost:5000";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export interface PlanResponse {
  session_id: string;
  phase: string;
  plan: Record<string, unknown> | null;
  dag: DAGSpec | null;
  corrections_remaining: number;
}

export interface ConfigResponse {
  session_id: string;
  robot_count: number;
  phase: string;
}

export interface LaunchResponse {
  status: string;
  robot_count: number;
  port: number | null;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  service: string;
  version: string;
}

/** Set the robot count for the session */
export async function postConfig(robotCount: number, sessionId?: string): Promise<ConfigResponse> {
  return request("/config", {
    method: "POST",
    body: JSON.stringify({ robot_count: robotCount, session_id: sessionId || "" }),
  });
}

/** Phase 1: Submit a natural-language mission */
export async function postPlan(
  mission: string,
  sessionId?: string
): Promise<PlanResponse> {
  return request("/plan", {
    method: "POST",
    body: JSON.stringify({ mission, session_id: sessionId || "" }),
  });
}

/** Correct the current plan (max 3 times) */
export async function postCorrect(
  correction: string,
  sessionId?: string
): Promise<PlanResponse> {
  return request("/correct", {
    method: "POST",
    body: JSON.stringify({ correction, session_id: sessionId || "" }),
  });
}

/** Phase 2: Generate the final DAG from the accepted plan */
export async function postGenerate(sessionId?: string): Promise<PlanResponse> {
  return request("/generate", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId || "" }),
  });
}

/** Launch Gazebo with N robots and send the DAG */
export async function postLaunch(sessionId?: string): Promise<LaunchResponse> {
  return request("/launch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": sessionId || "",
    },
    body: JSON.stringify({}),
  });
}

/** Kill all subprocesses and reset session */
export async function postKill(sessionId?: string): Promise<{ status: string; phase: string }> {
  return request("/kill", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": sessionId || "",
    },
    body: JSON.stringify({}),
  });
}

/** Health check */
export async function getHealth(): Promise<HealthResponse> {
  return request("/health");
}
