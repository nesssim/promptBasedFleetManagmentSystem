/**
 * HTTP API client for the MissionSwarm backend.
 * All functions return typed responses or throw on error.
 */

import type { DAGSpec } from "./types";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

/** Default timeout (30s for health checks, extended per-call for LLM endpoints). */
const DEFAULT_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 180_000; // 3 minutes — local LLMs can be slow

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const isLlmEndpoint = ["/plan", "/correct", "/generate"].some((p) => url.startsWith(p));
  const timeoutMs = isLlmEndpoint ? LLM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const method = options?.method?.toUpperCase() || "GET";
  const isGet = method === "GET";

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: isGet
      ? { ...options?.headers }
      : { "Content-Type": "application/json", ...options?.headers },
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
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
  mock?: boolean;
}

export interface SessionRestore {
  session_id: string;
  phase: string;
  robot_count: number;
}

export interface ConfigResponse {
  session_id: string;
  robot_count: number;
  phase: string;
  mock: boolean;
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
  mock_mode?: boolean;
  provider?: string;
  llm_reachable?: boolean;
  llm_error?: string | null;
  llm_model?: string | null;
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

/** Restore session on page reload */
export async function getSession(sessionId: string): Promise<SessionRestore> {
  return request(`/session/${sessionId}`);
}

/** Health check */
export async function getHealth(): Promise<HealthResponse> {
  return request("/health");
}

// ── Persistence / History ──

export interface SessionSummary {
  session_id: string;
  phase: string;
  robot_count: number;
  created_at: string;
  mock?: boolean;
}

export interface FullSessionData {
  meta: Record<string, unknown>;
  chat: { role: string; content: string; timestamp: number }[];
  plan: Record<string, unknown> | null;
  decisions: { decision: string; timestamp: number }[];
  errors: { error: string; timestamp: number }[];
}

export interface PrefsResponse {
  default_robot_count: number;
}

export interface RestoreResponse {
  session_id: string;
  phase: string;
  robot_count: number;
  plan: Record<string, unknown> | null;
  dag: Record<string, unknown> | null;
  mock: boolean;
}

/** List all persisted sessions */
export async function getSessions(): Promise<{ sessions: SessionSummary[] }> {
  return request("/sessions");
}

/** Get full session detail (chat, plan, decisions, errors) */
export async function getSessionDetail(sessionId: string): Promise<FullSessionData> {
  return request(`/sessions/${sessionId}`);
}

/** Restore a session's workflow into a new session */
export async function restoreSession(sessionId: string): Promise<RestoreResponse> {
  return request(`/sessions/${sessionId}/restore`, { method: "POST" });
}

/** A named location with x/y coordinates */
export interface LocationDef {
  x: number;
  y: number;
}

export interface LocationsData {
  locations: Record<string, LocationDef>;
}

/** Get the yard map */
export async function getLocations(): Promise<LocationsData> {
  return request("/locations");
}

/** Replace the yard map */
export async function updateLocations(data: LocationsData): Promise<LocationsData> {
  return request("/locations", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Check environment availability for launch */
export interface EnvCheckResult {
  ros2_available: boolean;
  gazebo_available: boolean;
  turtlebot3_available: boolean;
  details: string[];
}

export async function getEnvCheck(): Promise<EnvCheckResult> {
  return request("/system/env-check");
}

/** Get persistent user preferences */
export async function getPrefs(): Promise<PrefsResponse> {
  return request("/config/prefs");
}

/** Update persistent user preferences */
export async function updatePrefs(data: PrefsResponse): Promise<PrefsResponse> {
  return request("/config/prefs", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
