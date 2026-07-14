# promptBasedFleetManagmentSystem

A local web application for multi-robot fleet mission planning and execution. Takes natural-language mission descriptions, generates validated task DAGs via LLM (Claude), launches N robots in Gazebo, and streams live fleet status to a browser dashboard.

## Architecture

```
Browser (React+Zustand) ──HTTP/WS──> FastAPI Backend ──Anthropic──> Claude 3.5 Sonnet
                                        │
                                   ┌────┴────┐
                                   │ ROS 2   │──/fleet_status──> FleetCoordinator
                                   │ Bridge  │                    │
                                   └─────────┘              Gazebo + RViz
```

## Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
python -m uvicorn backend.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Project Structure

```
├── backend/
│   ├── main.py              # FastAPI app, CORS, lifespan
│   ├── config.py            # Pydantic Settings (env vars)
│   ├── session.py           # SessionStore + state machine
│   ├── models/              # Pydantic models (DAGSpec, RobotState, WSMessage)
│   ├── routers/             # HTTP + WebSocket endpoints
│   ├── services/            # Business logic (LLM, DAG validator, Gazebo, ROS bridge)
│   ├── prompts/             # LLM system prompts (Phase 1 & 2)
│   └── data/                # locations.json, missions.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Root with phase-based view routing
│   │   ├── views/           # SetupView, ChatView, DashboardView
│   │   ├── components/      # TopBar, YardMap, RobotCard, EventLog, ErrorBanner
│   │   ├── stores/          # Zustand stores (config, plan, fleet)
│   │   ├── hooks/           # useWebSocket, useHealthCheck
│   │   └── types/           # TypeScript type definitions
│   └── package.json
└── execution.md             # Full execution plan
```

## State Machine

```
IDLE → PLANNING → PLAN_READY → GENERATING → DAG_READY → LAUNCHING → RUNNING → COMPLETE
  │        │           │            │            │           │          │
  └────────┴───────────┴────────────┴────────────┴───────────┴──────────┘
                                    ↕ (any → ERROR → IDLE via /kill)
```

## Key Design Decisions

- **FastAPI** (not Flask) — native async for LLM calls + WebSocket + subprocess
- **PID file tracking** (not pkill -f) — precise cleanup, no side effects
- **Sequential robot spawning** (2s delay) — prevents Gazebo entity spawner deadlock
- **Event-driven fleet status** + 5s heartbeat — fast when active, quiet when idle
- **API key in backend env var only** — never in browser
- **Inline MCP** (no separate server) — 5 pure Python functions in dag_validator.py
