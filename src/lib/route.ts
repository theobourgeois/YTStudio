/** Minimal routing: the open project lives in the URL as `/p/<projectId>`. */

export function projectIdFromUrl(): string | null {
  const match = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
  return match ? match[1] : null;
}

export function setUrlProject(projectId: string | null, { replace = false } = {}) {
  const path = projectId ? `/p/${projectId}` : "/";
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}
