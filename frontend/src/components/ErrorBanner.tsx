import { usePlanStore } from "../stores/plan";
import { colors } from "../theme";

interface ErrorBannerProps {
  message: string;
  code?: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, code, onRetry }: ErrorBannerProps) {
  const setError = usePlanStore((s) => s.setError);

  return (
    <div style={styles.banner}>
      <div style={styles.content}>
        <div style={styles.iconWrap}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div style={styles.textGroup}>
          <span style={styles.message}>{message}</span>
          {code && <span style={styles.code}>{code}</span>}
        </div>
      </div>
      <div style={styles.actions}>
        {onRetry && (
          <button style={styles.retryBtn} onClick={onRetry}>
            Retry
          </button>
        )}
        <button style={styles.dismissBtn} onClick={() => setError(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    background: colors.dangerBg,
    borderBottom: `1px solid ${colors.dangerBorder}`,
    padding: "12px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    animation: "slideDown 0.3s ease-out",
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: `${colors.danger}15`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  message: {
    color: colors.danger,
    fontWeight: 600,
    fontSize: 14,
    lineHeight: 1.4,
  },
  code: {
    color: colors.text.muted,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    background: colors.surface.muted,
    padding: "2px 8px",
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  actions: { display: "flex", gap: 8, flexShrink: 0 },
  retryBtn: {
    background: colors.primary,
    color: colors.primaryForeground,
    border: "none",
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  dismissBtn: {
    background: "transparent",
    color: colors.text.muted,
    border: `1px solid ${colors.border.default}`,
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
};
