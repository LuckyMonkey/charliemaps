const CONFIGURED_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || "";
const CONFIGURED_PORT = (import.meta.env.VITE_API_PORT as string | undefined)?.trim() || "";
let resolvedBase = "";

function candidateBases() {
  if (typeof window === "undefined") {
    return [CONFIGURED_BASE || "http://localhost:8080"];
  }

  const { protocol, hostname } = window.location;
  const candidates: string[] = [];
  const push = (value: string) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    push(`${protocol}//${hostname}:${CONFIGURED_PORT || "8081"}`);
    push(`${protocol}//${hostname}:8080`);
  }

  push(CONFIGURED_BASE);
  push(`${protocol}//${hostname}:${CONFIGURED_PORT || "8080"}`);
  push("http://localhost:8080");

  return candidates.filter(Boolean);
}

export async function apiGet<T>(path: string): Promise<T> {
  const candidates = resolvedBase ? [resolvedBase, ...candidateBases()] : candidateBases();
  let lastError: Error | null = null;

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}${path}`);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      resolvedBase = base;
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error("API request failed");
}

export function apiBase() {
  return resolvedBase || candidateBases()[0];
}
