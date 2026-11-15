import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type FeedKey = 'trip-updates' | 'vehicle-positions' | 'alerts';
type FeedState = { key: FeedKey; url: string; status: 'fresh' | 'unchanged' | 'error'; updatedAt: string | null; etag?: string; error?: string };

const feedUrls: Record<FeedKey, string> = {
  'trip-updates': 'https://cdn.mbta.com/realtime/TripUpdates_enhanced.json',
  'vehicle-positions': 'https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json',
  alerts: 'https://cdn.mbta.com/realtime/Alerts_enhanced.json',
};
const etags = new Map<FeedKey, string>();
const states = new Map<FeedKey, FeedState>();
let timer: NodeJS.Timeout | undefined;

async function poll(key: FeedKey): Promise<void> {
  const url = feedUrls[key];
  const headers: Record<string, string> = { accept: 'application/json' };
  const prior = etags.get(key);
  if (prior) headers['if-none-match'] = prior;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const now = new Date().toISOString();
    if (response.status === 304) {
      states.set(key, { key, url, status: 'unchanged', updatedAt: states.get(key)?.updatedAt ?? null, etag: prior });
      return;
    }
    if (!response.ok) throw new Error(`MBTA returned ${response.status}`);
    const body = await response.text();
    const etag = response.headers.get('etag') ?? undefined;
    if (etag) etags.set(key, etag);
    states.set(key, { key, url, status: 'fresh', updatedAt: now, etag });
    try {
      await mkdir('/data/realtime', { recursive: true });
      await writeFile(path.join('/data/realtime', `${key}.json`), body, 'utf8');
    } catch (error) {
      // The app can still expose a fresh in-memory watermark when the volume is read-only.
      console.warn(`realtime ${key} snapshot not persisted`, error instanceof Error ? error.message : error);
    }
  } catch (error) {
    states.set(key, { key, url, status: 'error', updatedAt: states.get(key)?.updatedAt ?? null, error: error instanceof Error ? error.message : String(error) });
  }
}

export function realtimeState() {
  return { mode: 'deltas-only', feeds: Array.from(states.values()) };
}

export function startRealtimeCollector(): void {
  if (process.env.MBTA_REALTIME_ENABLED === '0') return;
  const run = () => Promise.all((Object.keys(feedUrls) as FeedKey[]).map(poll)).catch(error => console.error('realtime poll failed', error));
  void run();
  timer = setInterval(() => void run(), 60_000);
}

export function stopRealtimeCollector(): void {
  if (timer) clearInterval(timer);
}
