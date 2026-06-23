export const lightColors = {
  primary: "#2563EB",
  primaryLight: "#DBEAFE",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#1E293B",
  textSecondary: "#64748B",
  border: "#E2E8F0",
  error: "#EF4444",
  success: "#22C55E",
  overlay: "rgba(0,0,0,0.4)",
  overlayBg: "rgba(255,255,255,0.93)",
  extractOkBg: "#DCFCE7",
  extractOkText: "#166534",
  extractWarnBg: "#FEF9C3",
  extractWarnText: "#92400E",
};

export const darkColors = {
  primary: "#3B82F6",
  primaryLight: "#1E3A5F",
  background: "#0F172A",
  surface: "#1E293B",
  text: "#F1F5F9",
  textSecondary: "#94A3B8",
  border: "#334155",
  error: "#F87171",
  success: "#4ADE80",
  overlay: "rgba(0,0,0,0.6)",
  overlayBg: "rgba(15,23,42,0.95)",
  extractOkBg: "#14532D",
  extractOkText: "#86EFAC",
  extractWarnBg: "#422006",
  extractWarnText: "#FDE68A",
};

// Backward-compat export used by modules that haven't adopted useTheme yet
export const colors = lightColors;
