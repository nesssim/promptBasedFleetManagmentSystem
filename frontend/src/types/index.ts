/**
 * TypeScript types mirroring the Python Pydantic models.
 * Single source of truth for the frontend.
 */

export type MissionPhase =
  | "idle"
  | "planning"
  | "plan_ready"
  | "generating"
  | "dag_ready"
  | "launching"
  | "running"
  | "complete"
  | "error";

type WSMessageType =
  | "fleet_status"
  | "spawn_progress"
  | "phase_change"
  | "error"
  | "heartbeat";

/** A robot in the fleet */
export interface RobotSpec {
  id: string;
  type: string;
  home: string;
}

/** A single task in the mission DAG */
export interface TaskSpec {
  id: string;
  type: "navigate" | "charge" | "weigh" | "dock" | "undock";
  location: string;
  depends_on: string[];
  duration_s?: number;
  assigned_to: string;
  action_type?: string;
}

/** Canonical DAG JSON schema */
export interface DAGSpec {
  mission_id: string;
  robot_count: number;
  robots: RobotSpec[];
  tasks: TaskSpec[];
  locations: Record<string, { x: number; y: number }>;
  metadata: Record<string, unknown>;
}

/** Current state of a single robot */
export interface RobotState {
  id: string;
  status: string;
  battery: number;
  x: number;
  y: number;
  current_task: string;
  completed_tasks: number;
  total_tasks: number;
}

/** Framed WebSocket message */
export interface WSMessage {
  type: WSMessageType;
  seq: number;
  timestamp: number;
  payload: Record<string, unknown>;
}
