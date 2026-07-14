# Execution Plan — promptBasedFleetManagmentSystem

> **Mission**: Build a local web app (FastAPI + React) that takes natural-language missions, generates validated task DAGs via LLM (Claude), launches N robots in Gazebo, and streams live fleet status to a browser dashboard.

---

## High-Level Architecture

```
Browser (React+Zustand) ──HTTP/WS──> FastAPI Backend ──Anthropic API──> Claude 3.5 Sonnet
                                        │
                                   ┌────┴────┐
                                   │ ROS 2   │
                                   │ Bridge  │──/fleet_status──> FleetCoordinator (ROS 2)
                                   │ (thread)│                    │
                                   └─────────┘              Gazebo + RViz
```

## Phases

| Phase | What | Est. Time |
|-------|------|-----------|
| **0 — Foundation** | Pydantic models, TypeScript types, data files, `.env`, scaffolding | 2h |
| **1 — Backend Infra** | FastAPI app, SessionState, ProcessManager, GazeboLauncher, basic routers | 8h |
| **2 — LLM Integration** | dag_validator.py, LLM service (AsyncAnthropic), prompts, plan/correct/generate routers | 8h |
| **3 — ROS 2 Bridge** | Background rclpy thread, /fleet_status→WS, /launch endpoint, DAG adapter | 6h |
| **4 — Frontend** | React+Vite+Zustand scaffold, 4 views, 6 components, hooks, API wiring | 15h |
| **5 — Testing** | Unit, integration, E2E, error paths, all 4 weekly scenarios | 8h |

**Total: ~50h** (can be 2-track parallel: backend + frontend after Phase 0)

---

## File Map

```
promptBasedFleetManagmentSystem/
├── execution.md                  ← This file
├── .gitignore
├── backend/
│   ├── main.py                   # FastAPI app, CORS, lifespan
│   ├── config.py                 # Pydantic Settings (env vars)
│   ├── session.py                # SessionStore + state machine guards
│   ├── models/
│   │   ├── __init__.py           # MissionPhase enum
│   │   ├── plan.py               # DAGSpec, RobotSpec, TaskSpec, Location
│   │   └── robot.py              # RobotState, FleetStatus, WSMessage
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── config.py             # POST /config
│   │   ├── plan.py               # POST /plan, /correct, /generate
│   │   ├── launch.py             # POST /launch, /kill
│   │   ├── status.py             # WS /status, GET /robots
│   │   └── health.py             # GET /health, /history, /history/{id}/replay
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm.py                # AsyncAnthropic client, 2-phase prompts, retry
│   │   ├── dag_validator.py      # 2 LLM tools + 3 backend utils
│   │   ├── gazebo.py             # GazeboLauncher (async subprocess, spawn)
│   │   ├── ros_bridge.py         # rclpy background thread → asyncio.Queue
│   │   └── process_manager.py    # PID tracking, kill_all, port negotiation
│   ├── prompts/
│   │   ├── phase1_analyst.txt    # Phase 1 system prompt
│   │   └── phase2_dag.txt        # Phase 2 system prompt
│   ├── data/
│   │   ├── locations.json        # Yard coordinates
│   │   └── missions.json         # Append-only history
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api.ts
│       ├── types/index.ts
│       ├── stores/
│       │   ├── config.ts
│       │   ├── plan.ts
│       │   └── fleet.ts
│       ├── views/
│       │   ├── SetupView.tsx
│       │   ├── ChatView.tsx
│       │   └── DashboardView.tsx
│       ├── components/
│       │   ├── TopBar.tsx
│       │   ├── YardMap.tsx
│       │   ├── RobotCard.tsx
│       │   ├── EventLog.tsx
│       │   └── ErrorBanner.tsx
│       └── hooks/
│           ├── useWebSocket.ts
│           └── useHealthCheck.ts
└── README.md
```

---

## Dependency DAG

```
Phase0 ──> Phase1 ──> Phase2 ──> Phase3 ──> Phase5
  │                                      │
  └──> Phase4 ───────────────────────────┘
```
Phase 4 (frontend) can start in parallel with Phase 1/2 once Phase 0 types are defined.

---

## Key Contracts

### DAG JSON Schema (canonical interface between LLM ↔ validator ↔ FleetCoordinator)
```json
{
  "mission_id": "uuid",
  "robot_count": 3,
  "robots": [{"id": "robot_1", "type": "burger", "home": "dock_1"}],
  "tasks": [{"id": "t1", "type": "navigate", "location": "zone_A",
             "depends_on": [], "duration_s": 30, "assigned_to": "robot_1"}],
  "locations": {"zone_A": {"x": 2.0, "y": -3.0}},
  "metadata": {}
}
```

### State Machine (backend-owned)
```
IDLE → PLANNING → PLAN_READY → GENERATING → DAG_READY → LAUNCHING → RUNNING → COMPLETE
  │        │           │            │            │           │          │
  └────────┴───────────┴────────────┴────────────┴───────────┴──────────┘
                                    ↕ (any → ERROR → IDLE via /kill)
```

### WebSocket Framing
```json
{"type": "fleet_status", "seq": 42, "timestamp": 1689300000.5,
 "payload": {"robots": [...], "tasks": {...}, "phase": "RUNNING"}}
```
Message types: `fleet_status`, `spawn_progress`, `phase_change`, `error`, `heartbeat`

---

## Verification Gates

| # | Phase | Check | Pass Condition |
|---|-------|-------|---------------|
| G1 | 0 | Models compile | `python -c "from backend.models import DAGSpec"` OK |
| G2 | 1a | FastAPI starts | `uvicorn backend.main:app` → GET /health 200 |
| G3 | 1b | State guards work | Wrong-phase requests return 409 |
| G4 | 1c | Process cleanup | kill_all() → process dead + port free |
| G5 | 2a | Validator passes 4 weeks | create_task_dag() on week1-4 JSON returns valid |
| G6 | 2b | LLM tool loop | Mock → tool_use → tool_result → ≤5 turns |
| G7 | 3a | ROS bridge receives | /fleet_status → asyncio.Queue populated |
| G8 | 3c | WS streams to browser | Framed messages with seq increments |
| G9 | 4 | All views render | No console errors with mock data |
| G10 | 5 | E2E flow | Full click-through: Setup→Chat→Launch→Dashboard→Kill |

---

## Contingencies

| Failure | Detection | Recovery |
|---------|-----------|----------|
| LLM timeout (>60s) | asyncio.TimeoutError | HTTP 504, session stays, retry |
| LLM invalid API key | Anthropic 401 | HTTP 502, "LLM_KEY_INVALID" error |
| Gazebo no-start | Port poll timeout (30s) | Error banner, Kill All, retry |
| Port conflict | socket test on [11345-11347] | Try next port, error if all busy |
| Robot spawn failure | spawn_entity error | Continue others, flag partial fail |
| WS disconnect | browser onclose | Auto-reconnect 2s, seq sync |
| Duplicate launch | idempotency key | 200 cached or 409 conflict |

---

## Build Order (Recommended)

```
Day 1:  Phase 0 (all) + Phase 1a (FastAPI scaffold)
Day 2:  Phase 1b-1e (session, ProcessManager, Gazebo, routers)
Day 3:  Phase 2a-2b (dag_validator, LLM service)
         + Phase 4a-4b (frontend scaffold, types) [parallel]
Day 4:  Phase 2c-2e (prompts, plan routers)
         + Phase 4c-4e (hooks, SetupView, ChatView) [parallel]
Day 5:  Phase 3a-3d (ROS bridge, /launch, WS, adapter)
         + Phase 4f-4j (Dashboard, components, stores, API) [parallel]
Day 6:  Phase 5a-5f (all testing)
Day 7:  Polish, edge cases, README
```
