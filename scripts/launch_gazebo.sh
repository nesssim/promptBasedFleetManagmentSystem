#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# launch_gazebo.sh — Standalone Gazebo launcher for MissionSwarm
#
# Usage (from WSL terminal):
#   ./launch_gazebo.sh              # 3 robots (default)
#   ./launch_gazebo.sh 2            # 2 robots
#   ./launch_gazebo.sh 1            # 1 robot
#   ./launch_gazebo.sh --kill       # Kill all running instances
#
# What it does:
#   1. Sources ROS2 Humble environment
#   2. Kills any stale gzserver / robot_state_publisher instances
#   3. Starts gzserver on port 11345 with empty_world.world
#   4. Waits for Gazebo to be ready (up to 30s)
#   5. Patches the TurtleBot3 SDF for each robot (unique frame namespaces)
#   6. Spawns each robot in Gazebo (2s delay between spawns)
#   7. Starts robot_state_publisher for each robot
#
# Prerequisites:
#   - WSL2 with ROS2 Humble installed
#   - turtlebot3_gazebo package installed
#     (sudo apt install ros-humble-turtlebot3-gazebo)
# ─────────────────────────────────────────────────────────────────────────────
set -eo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
GAZEBO_PORT=11345
SDF_SOURCE="/opt/ros/humble/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf"
WORLD_FILE="/opt/ros/humble/share/gazebo_ros/worlds/empty.world"
SPAWN_TIMEOUT=30          # seconds to wait for gzserver readiness
SPAWN_DELAY=2             # seconds between robot spawns

# Spawn positions matching the backend (up to 6 robots)
declare -a SPAWN_X=(-4.0 -3.0 -4.0 -3.0 -2.0 -2.0)
declare -a SPAWN_Y=( 0.0 -2.0  2.0  2.0  0.0 -2.0)

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'  # No Color

# ── Helpers ─────────────────────────────────────────────────────────────────
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "\n${CYAN}━━━ Step $1: $2 ━━━${NC}"; }

# ── Kill mode ───────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--kill" || "${1:-}" == "-k" ]]; then
    info "Killing all Gazebo / ROS2 processes..."
    pkill -f gzserver 2>/dev/null || true
    pkill -f gzclient 2>/dev/null || true
    pkill -f "robot_state_publisher" 2>/dev/null || true
    pkill -f "spawn_entity" 2>/dev/null || true
    sleep 1
    info "All processes killed."
    exit 0
fi

# ── Parse robot count ──────────────────────────────────────────────────────
ROBOT_COUNT="${1:-3}"
if ! [[ "$ROBOT_COUNT" =~ ^[1-6]$ ]]; then
    error "Robot count must be 1-6, got: $ROBOT_COUNT"
    echo "Usage: $0 [1-6|--kill]"
    exit 1
fi

# ── Source ROS2 ─────────────────────────────────────────────────────────────
step 0 "Sourcing ROS2 Humble"
if [[ -f /opt/ros/humble/setup.bash ]]; then
    source /opt/ros/humble/setup.bash
    info "ROS2 Humble environment loaded"
else
    error "ROS2 Humble not found at /opt/ros/humble/setup.bash"
    exit 1
fi

# Set TurtleBot3 model (required for some launch files)
export TURTLEBOT3_MODEL=burger
export GAZEBO_MODEL_PATH=/opt/ros/humble/share/turtlebot3_gazebo/models

# ── Step 1: Kill stale instances ────────────────────────────────────────────
step 1 "Killing stale Gazebo instances"
pkill -f gzserver 2>/dev/null && warn "Killed old gzserver" || true
pkill -f "robot_state_publisher" 2>/dev/null && warn "Killed old robot_state_publisher" || true
sleep 2
info "Clean slate ready"

# ── Step 2: Verify prerequisites ───────────────────────────────────────────
step 2 "Verifying prerequisites"
if [[ ! -f "$SDF_SOURCE" ]]; then
    error "TurtleBot3 SDF not found at $SDF_SOURCE"
    error "Install turtlebot3_gazebo: sudo apt install ros-humble-turtlebot3-gazebo"
    exit 1
fi
info "SDF model found: $SDF_SOURCE"

if [[ ! -f "$WORLD_FILE" ]]; then
    error "World file not found: $WORLD_FILE"
    exit 1
fi
info "World file found: $WORLD_FILE"

# ── Step 3: Start gzserver ─────────────────────────────────────────────────
step 3 "Starting gzserver on port $GAZEBO_PORT"
gzserver --port=$GAZEBO_PORT \
    -s libgazebo_ros_init.so \
    -s libgazebo_ros_factory.so \
    -s libgazebo_ros_force_system.so \
    "$WORLD_FILE" &
GZSERVER_PID=$!
info "gzserver PID: $GZSERVER_PID"

# ── Step 4: Wait for Gazebo readiness ──────────────────────────────────────
step 4 "Waiting for Gazebo on port $GAZEBO_PORT (timeout: ${SPAWN_TIMEOUT}s)"
ELAPSED=0
while (( ELAPSED < SPAWN_TIMEOUT )); do
    if bash -c "echo >/dev/tcp/127.0.0.1/$GAZEBO_PORT" 2>/dev/null; then
        info "Gazebo is ready! (took ${ELAPSED}s)"
        break
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    # Show progress every 5 seconds
    if (( ELAPSED % 5 == 0 )); then
        echo "  ... waiting ($ELAPSED/${SPAWN_TIMEOUT}s)"
    fi
done

if (( ELAPSED >= SPAWN_TIMEOUT )); then
    error "Gazebo did not start within ${SPAWN_TIMEOUT}s"
    error "Check if another gzserver is running: ps aux | grep gzserver"
    kill $GZSERVER_PID 2>/dev/null || true
    exit 1
fi

# ── Step 5 & 6: Patch SDF and spawn each robot ─────────────────────────────
step 5 "Spawning $ROBOT_COUNT robot(s)"

for i in $(seq 1 $ROBOT_COUNT); do
    IDX=$((i - 1))
    X="${SPAWN_X[$IDX]}"
    Y="${SPAWN_Y[$IDX]}"
    NS="robot_$i"
    ENTITY="burger_$i"
    SDF_PATCHED="/tmp/burger_${i}.sdf"

    echo ""
    info "── Robot $i ($ENTITY) ──"
    info "  Position: ($X, $Y)"
    info "  Namespace: $NS"

    # Patch SDF: rewrite frame names to use robot namespace
    info "  Patching SDF → $SDF_PATCHED"
    sed -e "s|<odometry_frame>.*</odometry_frame>|<odometry_frame>${NS}/odom</odometry_frame>|" \
        -e "s|<robot_base_frame>.*</robot_base_frame>|<robot_base_frame>${NS}/base_footprint</robot_base_frame>|" \
        -e "s|<frameName>.*</frameName>|<frameName>${NS}/base_scan</frameName>|" \
        "$SDF_SOURCE" > "$SDF_PATCHED"

    # Start robot_state_publisher in background
    info "  Starting robot_state_publisher for $NS"
    ros2 run robot_state_publisher robot_state_publisher \
        --ros-args \
        -r __ns:=/$NS \
        -r __node:=${NS}_state_publisher \
        -p frame_prefix:=$NS \
        2>/dev/null &
    RSP_PID=$!
    info "  robot_state_publisher PID: $RSP_PID"

    # Spawn entity in Gazebo
    info "  Spawning $ENTITY at ($X, $Y, 0.0)..."
    ros2 run gazebo_ros spawn_entity.py \
        -file "$SDF_PATCHED" \
        -entity "$ENTITY" \
        -robot_namespace "$NS" \
        -x "$X" -y "$Y" -z 0.0 \
        > /dev/null 2>&1

    if [[ $? -eq 0 ]]; then
        info "  ✓ $ENTITY spawned successfully"
    else
        warn "  ✗ $ENTITY spawn may have failed (check above output)"
    fi

    # Delay between spawns (prevents Gazebo entity spawner deadlock)
    if (( i < ROBOT_COUNT )); then
        info "  Waiting ${SPAWN_DELAY}s before next spawn..."
        sleep $SPAWN_DELAY
    fi
done

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN} Gazebo is running with $ROBOT_COUNT robot(s)${NC}"
echo -e "${GREEN} Port: $GAZEBO_PORT | gzserver PID: $GZSERVER_PID${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Commands:"
echo "  ros2 topic list              # List all ROS2 topics"
echo "  ros2 topic echo /robot_1/cmd_vel  # Send velocity to robot_1"
echo "  gzclient                     # Open Gazebo GUI (optional)"
echo ""
echo "To stop: $0 --kill"
echo "Or:      kill $GZSERVER_PID"

# ── Keep script alive (wait for gzserver) ───────────────────────────────────
# This keeps the terminal attached so you see gzserver output.
# Press Ctrl+C to stop everything cleanly.
cleanup() {
    echo ""
    warn "Shutting down..."
    kill $GUI_PID 2>/dev/null || true
    kill $GZSERVER_PID 2>/dev/null || true
    pkill -f "robot_state_publisher" 2>/dev/null || true
    info "All processes stopped."
}
trap cleanup EXIT INT TERM

info "Holding — press Ctrl+C to stop all processes"

# Start gzclient (Gazebo GUI) in background
info "Starting gzclient (Gazebo GUI)..."
gzclient &
GUI_PID=$!
info "gzclient PID: $GUI_PID"

wait $GZSERVER_PID 2>/dev/null || true
