export type Theme = "system" | "light" | "dark";
export const THEMES: { id: Theme; label: string }[] = [{ id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }];
const KEY = "sr-theme";

export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch { /* ignore */ }
  return "system";
}
// public/theme.js owns the DOM side (it must run before first paint); this only saves the choice and asks it to re-apply.
export function setTheme(t: Theme) {
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* ignore */ }
  (window as unknown as { applyTheme?: () => void }).applyTheme?.();
}
