// One shared collector for the MBTA GTFS-realtime (enhanced JSON) feeds. Browsers never call
// MBTA: they read the compact projections below through /api/* and /api/events.
// Rules (docs/ARCHITECTURE.md): source timestamps are kept, stale data is never "live",
// predictions never overwrite the schedule, nothing is guessed.
import { EventEmitter } from 'node:events';
import { serverIndex } from './schedule.js';

type FeedKey = 'vehicles' | 'trip-updates' | 'alerts';
type FeedState = {
  key: FeedKey; url: string; status: 'starting' | 'fresh' | 'unchanged' | 'error';
  fetchedAt: string | null; feedTime: string | null; etag?: string; error?: string; everyMs: number;
};

const FEEDS: Record<FeedKey, { url: string; everyMs: number }> = {
  vehicles: { url: process.env.MBTA_VEHICLES_URL || 'https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json', everyMs: 15_000 },
  'trip-updates': { url: process.env.MBTA_TRIP_UPDATES_URL || 'https://cdn.mbta.com/realtime/TripUpdates_enhanced.json', everyMs: 30_000 },
  alerts: { url: process.env.MBTA_ALERTS_URL || 'https://cdn.mbta.com/realtime/Alerts_enhanced.json', everyMs: 60_000 },
};
/** A feed older than this (by its own header timestamp) is not live. */
export const STALE_AFTER_S = 180;

export type Vehicle = {
  id: string; label: string; route: string; dir: number | null; trip: string; lat: number; lon: number;
  bearing: number | null; status: string; stop: string | null; station: string | null; ts: number;
  occupancy: string | null;
};
export type Arrival = {
  route: string; dir: number | null; to: string; time: number; kind: 'arrival' | 'departure';
  stop: string; platform: string; vehicle: string | null; trip: string; uncertainty: number | null;
  status: 'predicted' | 'cancelled' | 'skipped';
};
export type Alert = {
  id: string; effect: string; severity: number; lifecycle: string; header: string; description: string;
  timeframe: string; url: string; routes: string[]; stations: string[]; updated: number;
};

const states = new Map<FeedKey, FeedState>();
const timers = new Map<FeedKey, NodeJS.Timeout>();
const failures = new Map<FeedKey, number>();
let vehicles: Vehicle[] = [];
let vehiclesTime = 0;
let arrivalsByStation = new Map<string, Arrival[]>();
/** trip id -> station id -> predicted time (s) and status; for checking a planned trip later. */
let tripPredictions = new Map<string, { cancelled: boolean; vehicle: string | null; route: string; to: string; stops: Map<string, { time: number; status: string }>; order: { station: string; time: number; status: string }[] }>();
let tripTime = 0;
let alerts: Alert[] = [];
let alertsTime = 0;
let stopped = false;
export const bus = new EventEmitter();
bus.setMaxListeners(200);

const nowS = () => Math.floor(Date.now() / 1000);
const text = (t: any): string => (t?.translation?.find((x: any) => x.language === 'en') ?? t?.translation?.[0])?.text ?? '';
const stationOf = (stop: string | undefined | null): string | null => {
  if (!stop) return null;
  const idx = serverIndex();
  return idx?.stopParent[stop] ?? stop;
};

function parseVehicles(body: any) {
  vehiclesTime = Number(body?.header?.timestamp) || 0;
  const out: Vehicle[] = [];
  for (const e of body?.entity ?? []) {
    const v = e.vehicle;
    const p = v?.position;
    if (!v || !p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    const trip = v.trip ?? {};
    if (trip.revenue === false) continue; // deadheads and yard moves are not service
    out.push({
      id: String(v.vehicle?.id ?? e.id), label: String(v.vehicle?.label ?? ''),
      route: String(trip.route_id ?? ''), dir: typeof trip.direction_id === 'number' ? trip.direction_id : null,
      trip: String(trip.trip_id ?? ''), lat: p.latitude, lon: p.longitude,
      bearing: typeof p.bearing === 'number' ? p.bearing : null,
      status: String(v.current_status ?? ''), stop: v.stop_id ?? null, station: stationOf(v.stop_id),
      ts: Number(v.timestamp) || vehiclesTime, occupancy: v.occupancy_status ?? null,
    });
  }
  vehicles = out;
}

function parseTripUpdates(body: any) {
  tripTime = Number(body?.header?.timestamp) || 0;
  const idx = serverIndex();
  const by = new Map<string, Arrival[]>();
  const trips: typeof tripPredictions = new Map();
  const floor = nowS() - 30;
  for (const e of body?.entity ?? []) {
    const tu = e.trip_update;
    if (!tu) continue;
    const trip = tu.trip ?? {};
    if (trip.revenue === false) continue;
    const route = String(trip.route_id ?? '');
    const dir = typeof trip.direction_id === 'number' ? trip.direction_id : null;
    const to = (trip.route_pattern_id && idx?.patternHeadsign[trip.route_pattern_id])
      || idx?.directionDestination[`${route}|${dir}`] || '';
    const cancelled = trip.schedule_relationship === 'CANCELED';
    const updates: any[] = tu.stop_time_update ?? [];
    const tstops = new Map<string, { time: number; status: string }>();
    const order: { station: string; time: number; status: string }[] = [];
    trips.set(String(trip.trip_id ?? ''), { cancelled, vehicle: tu.vehicle?.label ?? null, route, to, stops: tstops, order });
    for (const u of updates) {
      const st = stationOf(u.stop_id);
      const t = Number((u.departure ?? u.arrival)?.time);
      const ta = Number((u.arrival ?? u.departure)?.time);
      if (st && (ta || t)) order.push({ station: st, time: ta || t, status: u.schedule_relationship === 'SKIPPED' ? 'skipped' : 'predicted' });
      if (st) tstops.set(st, { time: t || ta || 0, status: u.schedule_relationship === 'SKIPPED' ? 'skipped' : 'predicted' });
      if (st && ta) tstops.set(`${st}#arr`, { time: ta, status: u.schedule_relationship === 'SKIPPED' ? 'skipped' : 'predicted' });
    }
    updates.forEach((u, i) => {
      const last = i === updates.length - 1;
      // At the last stop a train arrives; elsewhere people care when it leaves.
      const ev = last ? (u.arrival ?? u.departure) : (u.departure ?? u.arrival);
      const time = Number(ev?.time);
      if (!time || time < floor || last) return; // terminating calls are not boardable
      const station = stationOf(u.stop_id);
      if (!station) return;
      const list = by.get(station) ?? [];
      list.push({
        route, dir, to, time, kind: u.departure ? 'departure' : 'arrival', stop: String(u.stop_id),
        platform: idx?.platform[u.stop_id] ?? '', vehicle: tu.vehicle?.label ?? null, trip: String(trip.trip_id ?? ''),
        uncertainty: typeof ev?.uncertainty === 'number' ? ev.uncertainty : null,
        status: cancelled ? 'cancelled' : u.schedule_relationship === 'SKIPPED' ? 'skipped' : 'predicted',
      });
      by.set(station, list);
    });
  }
  for (const list of by.values()) list.sort((a, b) => a.time - b.time);
  arrivalsByStation = by;
  tripPredictions = trips;
}

function parseAlerts(body: any) {
  alertsTime = Number(body?.header?.timestamp) || 0;
  const now = nowS();
  const out: Alert[] = [];
  for (const e of body?.entity ?? []) {
    const a = e.alert;
    if (!a) continue;
    const periods: any[] = a.active_period ?? [];
    const active = !periods.length || periods.some(p => (!p.start || p.start <= now) && (!p.end || p.end >= now));
    if (!active) continue;
    const routes = new Set<string>();
    const stations = new Set<string>();
    for (const ie of a.informed_entity ?? []) {
      if (ie.route_id) routes.add(String(ie.route_id));
      const st = stationOf(ie.stop_id);
      if (st) stations.add(st);
    }
    out.push({
      id: String(e.id), effect: String(a.effect_detail ?? a.effect ?? ''), severity: Number(a.severity) || 0,
      lifecycle: String(a.alert_lifecycle ?? ''), header: text(a.header_text), description: text(a.description_text),
      timeframe: text(a.timeframe_text), url: text(a.url), routes: [...routes], stations: [...stations],
      updated: Number(a.last_modified_timestamp) || 0,
    });
  }
  out.sort((x, y) => y.severity - x.severity || y.updated - x.updated);
  alerts = out;
}

const PARSE: Record<FeedKey, (body: any) => void> = { vehicles: parseVehicles, 'trip-updates': parseTripUpdates, alerts: parseAlerts };

async function poll(key: FeedKey): Promise<void> {
  const { url, everyMs } = FEEDS[key];
  const prior = states.get(key);
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'charlie-maps (fridge.run)' };
  if (prior?.etag) headers['if-none-match'] = prior.etag;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const fetchedAt = new Date().toISOString();
    if (response.status === 304) {
      states.set(key, { ...(prior as FeedState), status: 'unchanged', fetchedAt, error: undefined });
    } else {
      if (!response.ok) throw new Error(`MBTA returned ${response.status}`);
      const body: any = await response.json();
      PARSE[key](body);
      const ts = Number(body?.header?.timestamp);
      states.set(key, {
        key, url, everyMs, status: 'fresh', fetchedAt, feedTime: ts ? new Date(ts * 1000).toISOString() : null,
        etag: response.headers.get('etag') ?? undefined,
      });
      bus.emit('update', key);
    }
    failures.set(key, 0);
  } catch (error) {
    failures.set(key, (failures.get(key) ?? 0) + 1);
    states.set(key, {
      key, url, everyMs, status: 'error', fetchedAt: prior?.fetchedAt ?? null, feedTime: prior?.feedTime ?? null,
      etag: prior?.etag, error: error instanceof Error ? error.message : String(error),
    });
  }
}

function schedule(key: FeedKey) {
  if (stopped) return;
  const base = FEEDS[key].everyMs;
  const fails = failures.get(key) ?? 0;
  // Exponential backoff with jitter on errors, capped at 5 minutes.
  const wait = fails ? Math.min(300_000, base * 2 ** fails) * (0.75 + Math.random() * 0.5) : base;
  timers.set(key, setTimeout(async () => { await poll(key); schedule(key); }, wait));
}

export function startRealtimeCollector(): void {
  if (process.env.MBTA_REALTIME_ENABLED === '0') return;
  for (const key of Object.keys(FEEDS) as FeedKey[]) {
    states.set(key, { key, url: FEEDS[key].url, everyMs: FEEDS[key].everyMs, status: 'starting', fetchedAt: null, feedTime: null });
    void poll(key).then(() => schedule(key));
  }
}

export function stopRealtimeCollector(): void {
  stopped = true;
  for (const t of timers.values()) clearTimeout(t);
}

const fresh = (t: number) => t > 0 && nowS() - t <= STALE_AFTER_S;

export function realtimeState() {
  return { mode: 'deltas-only', staleAfterSeconds: STALE_AFTER_S, feeds: Array.from(states.values()) };
}

export function vehicleSnapshot(route?: string) {
  const list = route ? vehicles.filter(v => v.route === route) : vehicles;
  return { asOf: vehiclesTime || null, live: fresh(vehiclesTime), count: list.length, vehicles: list };
}

export function arrivalsAt(station: string, limit = 24) {
  const now = nowS() - 30;
  const list = (arrivalsByStation.get(station) ?? []).filter(a => a.time >= now).slice(0, limit);
  return { asOf: tripTime || null, live: fresh(tripTime), station, arrivals: list };
}

export function alertsFor(opts: { route?: string; station?: string }) {
  let list = alerts;
  if (opts.route) list = list.filter(a => a.routes.includes(opts.route as string));
  if (opts.station) list = list.filter(a => a.stations.includes(opts.station as string));
  return { asOf: alertsTime || null, live: fresh(alertsTime), alerts: list };
}

/** Routes with at least one active alert that disrupts service (for the line list badges). */
export function alertedRoutes() {
  const quiet = new Set(['STATION_ISSUE', 'ACCESS_ISSUE', 'FACILITY_ISSUE', 'ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'PARKING_ISSUE', 'POLICY_CHANGE', 'SUMMARY', 'STOP_MOVE', 'STOP_MOVED']);
  const out: Record<string, number> = {};
  for (const a of alerts) {
    if (quiet.has(a.effect) || a.lifecycle === 'UPCOMING') continue;
    for (const r of a.routes) out[r] = Math.max(out[r] ?? 0, a.severity);
  }
  return out;
}

/**
 * Realtime check of a planned journey: for each ride leg (trip, board station, alight station, scheduled times)
 * the MBTA prediction, if any. delta = predicted - scheduled (s). No prediction is "no data", never "on time".
 */
export function legDeltas(legs: { trip: string; from: string; to: string; dep: number; arr: number; route: string }[]) {
  const live = fresh(tripTime);
  return {
    asOf: tripTime || null, live,
    legs: legs.map(l => {
      const p = tripPredictions.get(l.trip);
      const v = vehicles.find(x => x.trip === l.trip) ?? null;
      const dep = p?.stops.get(l.from);
      const arr = p?.stops.get(`${l.to}#arr`) ?? p?.stops.get(l.to);
      const status = !live ? 'unavailable' : p?.cancelled ? 'cancelled' : dep?.status === 'skipped' ? 'skipped' : (dep || arr) ? 'predicted' : 'no_prediction';
      // The planned trip has no live data or is cancelled (MBTA often swaps scheduled subway trips for
      // ADDED ones): offer the next predicted vehicle of the same route from the same stop that also
      // calls at the leg's destination.
      let instead: { trip: string; dep: number; arr: number | null; vehicle: string | null } | null = null;
      if (live && status !== 'predicted') {
        const now = nowS();
        for (const a of arrivalsByStation.get(l.from) ?? []) {
          if (a.route !== l.route || a.time < now || a.status !== 'predicted' || a.trip === l.trip) continue;
          const tp = tripPredictions.get(a.trip);
          const end = tp?.stops.get(`${l.to}#arr`) ?? tp?.stops.get(l.to);
          if (!end || end.time <= a.time) continue;
          instead = { trip: a.trip, dep: a.time, arr: end.time, vehicle: a.vehicle };
          break;
        }
      }
      return {
        instead,
        trip: l.trip, status,
        depPredicted: dep?.time ?? null, arrPredicted: arr?.time ?? null,
        depDelta: dep?.time ? dep.time - l.dep : null, arrDelta: arr?.time ? arr.time - l.arr : null,
        vehicle: v ? { label: v.label, lat: v.lat, lon: v.lon, status: v.status, station: v.station, ts: v.ts } : null,
        alerts: alerts.filter(a => a.routes.includes(l.route) && (a.stations.length === 0 || a.stations.includes(l.from) || a.stations.includes(l.to)))
          .slice(0, 3).map(a => ({ id: a.id, header: a.header, severity: a.severity, effect: a.effect })),
      };
    }),
  };
}

/** One vehicle: where it is and its next stops (MBTA predictions for its trip), for "follow this train". */
export function vehicleDetail(id: string) {
  const v = vehicles.find(x => x.id === id || x.label === id);
  if (!v) return null;
  const p = tripPredictions.get(v.trip);
  const now = nowS() - 30;
  return {
    asOf: vehiclesTime || null, live: fresh(vehiclesTime), vehicle: v,
    to: p?.to || serverIndex()?.directionDestination[`${v.route}|${v.dir}`] || '',
    next: (p?.order ?? []).filter(s => s.time >= now).slice(0, 12),
  };
}

/** Next departures at a station, one per route + destination (for search results). */
export function nextByRoute(station: string, groups = 4) {
  if (!fresh(tripTime)) return [];
  const out: { route: string; to: string; time: number }[] = [];
  const seen = new Set<string>();
  for (const a of arrivalsByStation.get(station) ?? []) {
    if (a.time < nowS() - 30 || a.status !== 'predicted') continue;
    const k = `${a.route}|${a.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ route: a.route, to: a.to, time: a.time });
    if (out.length >= groups) break;
  }
  return out;
}
