export const colors = {
  // ── Primary — 03045e for main CTAs ──
  primary: "#03045e",
  primaryHover: "#023e8a",
  primaryForeground: "#ffffff",

  // ── Secondary — 0096c7 for secondary CTAs ──
  secondary: "#0096c7",
  secondaryHover: "#023e8a",
  secondaryForeground: "#ffffff",

  // ── Semantic: success (green) / danger (red) — kept as-is ──
  success: "#16a34a",
  successBg: "#f0fdf4",
  successBorder: "#bbf7d0",

  danger: "#dc2626",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",

  // ── Warning — 0077b6 ──
  warning: "#0077b6",
  warningBg: "#ffffff",
  warningBorder: "#0077b6",

  // ── Info — 0096c7 ──
  info: "#0096c7",
  infoBg: "#ffffff",
  infoBorder: "#0096c7",

  // ── Text ──
  text: {
    primary: "#09090b",
    secondary: "#3f3f46",
    muted: "#71717a",
    faint: "#a1a1aa",
    inverse: "#fafafa",
  },

  // ── Surfaces & borders ──
  border: {
    default: "#e4e4e7",
    light: "#f4f4f5",
  },

  surface: {
    default: "#ffffff",
    subtle: "#fafafa",
    muted: "#f4f4f5",
  },

  // ── Badge colors ──
  badge: {
    mock: { bg: "#0096c7", text: "#ffffff" },
    live: { bg: "#dcfce7", text: "#166534" },
    offline: { bg: "#fee2e2", text: "#991b1b" },
  },

  // ── Status dot colors ──
  status: {
    connected: "#16a34a",
    disconnected: "#dc2626",
    working: "#0077b6",
    charging: "#16a34a",
    idle: "#0096c7",
    error: "#dc2626",
  },
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.05)",
  md: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)",
  lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
  xl: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const font = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
} as const;
