import { colors } from "../theme";

interface AnimatedLogoProps {
  badge?: "MOCK" | "LIVE" | null;
}

export function AnimatedLogo({ badge }: AnimatedLogoProps) {
  return (
    <div style={styles.container}>
      <span style={styles.logo}>
        Mission<span style={styles.accent}>Swarm</span>
      </span>
      {badge && (
        <span
          style={{
            ...styles.badge,
            ...(badge === "MOCK" ? styles.badgeMock : styles.badgeLive),
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    letterSpacing: "-0.3px",
    color: colors.text.primary,
  },
  accent: {
    color: "#0096c7",
    fontWeight: 500,
  },
  badge: {
    fontSize: 9,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 4,
    letterSpacing: "0.8px",
    textTransform: "uppercase" as const,
  },
  badgeMock: {
    background: colors.badge.mock.bg,
    color: colors.badge.mock.text,
  },
  badgeLive: {
    background: colors.badge.live.bg,
    color: colors.badge.live.text,
  },
};
