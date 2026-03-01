const BASE = (import.meta.env.VITE_API_BASE as string) || "http://localhost:8080";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export function apiBase() {
  return BASE;
}
