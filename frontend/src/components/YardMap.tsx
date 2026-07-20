import { useMemo, useState, useCallback, useRef } from "react";
import type { DAGSpec, RobotState } from "../types";
import { colors } from "../theme";

interface YardMapProps {
  locations?: Record<string, { x: number; y: number }>;
  robots?: RobotState[];
  dag?: DAGSpec | null;
  planned?: boolean;
}

const COLORS = ["#03045e", "#023e8a", "#0077b6", "#0096c7", "#03045e", "#023e8a"];
const SCALE = 38;
const OX = 300;
const OY = 250;
const BASE_W = 600;
const BASE_H = 500;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;

export function YardMap({ locations, robots, dag, planned = true }: YardMapProps) {
  const locs = locations || dag?.locations || {};
  const robotList = robots || [];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const next = e.deltaY < 0 ? z + ZOOM_STEP : z - ZOOM_STEP;
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setCursor("grabbing");
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setCursor("grab");
  }, []);

  const vw = BASE_W / zoom;
  const vh = BASE_H / zoom;
  const vx = (BASE_W - vw) / 2 - pan.x / zoom;
  const vy = (BASE_H - vh) / 2 - pan.y / zoom;

  const [cursor, setCursor] = useState<string>("grab");

  const toSvg = (x: number, y: number) => ({
    cx: OX + x * SCALE,
    cy: OY - y * SCALE,
  });

  return (
    <div
      style={{ ...styles.container, cursor }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg width="100%" height="100%" viewBox={`${vx} ${vy} ${vw} ${vh}`} style={styles.svg}>
        {/* Light grid */}
        {Array.from({ length: 13 }, (_, i) => (
          <g key={`g-${i}`}>
            <line x1={OX + (i - 6) * SCALE} y1={50} x2={OX + (i - 6) * SCALE} y2={450}
              stroke={colors.border.light} strokeWidth={1} />
            <line x1={100} y1={OY + (i - 6) * SCALE} x2={500} y2={OY + (i - 6) * SCALE}
              stroke={colors.border.light} strokeWidth={1} />
          </g>
        ))}

        {/* Axis labels */}
        {Array.from({ length: 7 }, (_, i) => {
          const val = i - 3;
          return (
            <g key={`xl-${i}`}>
              <text x={OX + val * SCALE} y={465} textAnchor="middle" fill={colors.border.default} fontSize={9}>
                {val}
              </text>
              <text x={82} y={OY - val * SCALE + 3} textAnchor="end" fill={colors.border.default} fontSize={9}>
                {val}
              </text>
            </g>
          );
        })}

        {/* Locations */}
        {Object.entries(locs).map(([name, loc]) => {
          const { cx, cy } = toSvg(loc.x, loc.y);
          return (
            <g key={name}>
              <circle cx={cx} cy={cy} r={10} fill={colors.infoBg} stroke={colors.primary} strokeWidth={2} />
              <text x={cx} y={cy + 24} textAnchor="middle" fill={colors.text.secondary} fontSize={10} fontWeight={500}>
                {name.replace(/_/g, " ")}
              </text>
            </g>
          );
        })}

        {/* Robots */}
        {robotList.map((robot, i) => {
          const { cx, cy } = toSvg(robot.x, robot.y);
          const color = COLORS[i % COLORS.length];
          const isActive = robot.status !== "idle" && robot.status !== "error";
          return (
            <g key={robot.id}>
              <polygon
                points={`${cx - 8},${cy + 6} ${cx + 8},${cy + 6} ${cx},${cy - 10}`}
                fill={color}
                opacity={isActive ? 1 : 0.5}
              />
              {isActive && (
                <circle cx={cx} cy={cy} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.3}>
                  <animate attributeName="r" values="14;20;14" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}
              <text x={cx} y={cy + 22} textAnchor="middle" fill={color} fontSize={9} fontWeight={600}>
                {robot.id.replace("robot_", "R")}
              </text>
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(460, 16)">
          <text x={0} y={0} fill={colors.text.secondary} fontSize={10} fontWeight={600}>Robots</text>
          {robotList.map((r, i) => (
            <g key={`leg-${r.id}`} transform={`translate(0, ${14 + i * 14})`}>
              <circle cx={4} cy={0} r={4} fill={COLORS[i % COLORS.length]} />
              <text x={14} y={3} fill={colors.text.muted} fontSize={9}>{r.id}</text>
            </g>
          ))}
        </g>
      </svg>
      <div style={styles.zoomBadge}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: colors.surface.default,
    borderRadius: 8,
    border: `1px solid ${colors.border.default}`,
    overflow: "hidden",
    minHeight: 300,
    position: "relative",
    userSelect: "none",
  },
  svg: { display: "block" },
  zoomBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    background: colors.surface.default,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 600,
    color: colors.text.muted,
    pointerEvents: "none",
  },
};
