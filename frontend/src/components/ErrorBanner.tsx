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
    background: "#fff5f5",
    borderBottom: "1px solid #fed7d7",
    padding: "10px 20px",
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
    color: "#e53e3e",
    fontWeight: 600,
    fontSize: 14,
  },
  code: {
    color: "#a0aec0",
    fontSize: 11,
    fontFamily: "monospace",
    background: "#f8f9fa",
    padding: "2px 8px",
    borderRadius: 4,
  },
  actions: { display: "flex", gap: 8 },
  retryBtn: {
    background: "#e53e3e",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
  },
  dismissBtn: {
    background: "transparent",
    color: "#718096",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
  },
};
