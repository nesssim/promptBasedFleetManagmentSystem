import { usePlanStore } from "../stores/plan";

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
        <span style={styles.message}>{message}</span>
        {code && <span style={styles.code}>{code}</span>}
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
    background: "#fef2f2",
    borderLeft: "4px solid #dc2626",
    padding: "10px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  message: {
    color: "#dc2626",
    fontWeight: 600,
    fontSize: 14,
  },
  code: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
    background: "#f1f5f9",
    padding: "2px 8px",
    borderRadius: 4,
  },
  actions: { display: "flex", gap: 8 },
  retryBtn: {
    background: "transparent",
    color: "#dc2626",
    border: "1px solid #dc2626",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  dismissBtn: {
    background: "transparent",
    color: "#64748b",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
};
