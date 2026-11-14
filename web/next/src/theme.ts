import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "keyhole:theme";
const subs = new Set<() => void>();

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private window: the choice lasts for this page only */ }
  subs.forEach((f) => f());
}

export function useTheme(): Theme {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getTheme);
}
