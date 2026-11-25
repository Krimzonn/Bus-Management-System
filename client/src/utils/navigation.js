// Minimal path-based navigation (no router dependency).
//
// The app has two public URLs:
//   "/"       landing page (or the dashboard when signed in)
//   "/login"  existing login page
//
// usePath() re-renders when the path changes through navigate() or the
// browser's back/forward buttons.

import { useSyncExternalStore } from "react";

const NAVIGATE_EVENT = "bm:navigate";

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function subscribe(callback) {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

export function usePath() {
  return useSyncExternalStore(subscribe, currentPath, () => "/");
}

export function navigate(path, { replace = false } = {}) {
  if (currentPath() === path) return;
  if (replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
