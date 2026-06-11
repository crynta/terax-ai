const STORAGE_KEY = "terax-artifact-compare-recent-routes";
const MAX_RECENT_ROUTES = 5;
const DEFAULT_COMPARE_ROUTE = "http://localhost:5173/";

export function loadArtifactCompareRecentRoutes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string =>
      isValidCompareRoute(value),
    );
  } catch {
    return [];
  }
}

export function defaultArtifactCompareRoute(): string {
  return loadArtifactCompareRecentRoutes()[0] ?? DEFAULT_COMPARE_ROUTE;
}

export function rememberArtifactCompareRoute(route: string): string[] {
  const normalized = normalizeCompareRoute(route);
  if (!normalized) return loadArtifactCompareRecentRoutes();
  const next = [
    normalized,
    ...loadArtifactCompareRecentRoutes().filter(
      (entry) => entry !== normalized,
    ),
  ].slice(0, MAX_RECENT_ROUTES);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function normalizeCompareRoute(route: string): string | null {
  const trimmed = route.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidCompareRoute(route: string): boolean {
  return normalizeCompareRoute(route) !== null;
}
