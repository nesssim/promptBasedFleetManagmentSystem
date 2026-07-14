import { useMemo } from "react";
import type { DAGSpec, RobotState } from "../types";

interface YardMapProps {
  locations?: Record<string, { x: number; y: number }>;
  robots?: RobotState[];
  dag?: DAGSpec | null;
  planned?: boolean;
}

const COLORS = ["#4f8ef7", "#23a45d", "#e88d3b", "#a855f7", "#ec4899", "#14b8a6"];
const SCALE = 38;
const OX = 300;
const OY = 250;

export function YardMap({ locations, robots, dag, planned = true }: YardMapProps) {
  const locs = locations || dag?.locations || {};
  const robotList = robots || [];

  const toSvg = (x: number, y: number) => ({
    cx: OX + x * SCALE,
    cy: OY - y * SCALE,
  });

  return (
    <div style={styles.container}>
      <svg width="100%" height="100%" viewBox="0 0 600 500" style={styles.svg}>
        {/* Light grid */}
        {Array.from({ length: 13 }, (_, i) => (
          <g key={`g-${i}`}>
            <line x1={OX + (i - 6) * SCALE} y1={50} x2={OX + (i - 6) * SCALE} y2={450}
              stroke="#edf2f7" strokeWidth={1} />
            <line x1={100} y1={OY + (i - 6) * SCALE} x2={500} y2={OY + (i - 6) * SCALE}
              stroke="#edf2f7" strokeWidth={1} />
          </g>
        ))}

        {/* Axis labels */}
        {Array.from({ length: 7 }, (_, i) => {
          const val = i - 3;
          return (
            <g key={`xl-${i}`}>
              <text x={OX + val * SCALE} y={465} textAnchor="middle" fill="#cbd5e0" fontSize={9}>
                {val}
              </text>
              <text x={82} y={OY - val * SCALE + 3} textAnchor="end" fill="#cbd5e0" fontSize={9}>
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
              <circle cx={cx} cy={cy} r={10} fill="#ebf4ff" stroke="#4f8ef7" strokeWidth={2} />
              <text x={cx} y={cy + 24} textAnchor="middle" fill="#4a5568" fontSize={10} fontWeight={500}>
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
          <text x={0} y={0} fill="#4a5568" fontSize={10} fontWeight={600}>Robots</text>
          {robotList.map((r, i) => (
            <g key={`leg-${r.id}`} transform={`translate(0, ${14 + i * 14})`}>
              <circle cx={4} cy={0} r={4} fill={COLORS[i % COLORS.length]} />
              <text x={14} y={3} fill="#718096" fontSize={9}>{r.id}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: "#ffffff",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    minHeight: 300,
  },
  svg: { display: "block" },
};
