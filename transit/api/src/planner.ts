// Journey planner: earliest arrival over the published timetable (Connection Scan Algorithm),
// at station level, with transfer slack and footpaths. Schedule only: realtime deltas are a
// separate, later call (/api/plan/live), so a plan never silently mixes predictions into the
// timetable (docs/ARCHITECTURE.md rule 3 and 8). Data: schedule.json (tools/build-schedule.py),
// an in-memory derived index; GTFS remains the source.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './schedule.js';

type Raw = {
  stations: [string, string, number, number, number, number][];
  routes: Record<string, [string, string, string, string, string]>;
  services: Record<string, [string, string, string, string[], string[]]>;
  patterns: number[][];
  headsigns: string[];
  trips: { id: string[]; route: string[]; service: string[]; pattern: number[]; headsign: number[]; start: number[] };
  times: number[];
  walks: [number, number, number][];
};

const TZ = 'America/New_York';
const CHANGE_SLACK = 90;          // seconds to change vehicles inside a station
const MAX_HOURS = 6;              // search horizon

let raw: Raw | null = null;
let stationIndex = new Map<string, number>();
let tripTimeStart: Int32Array = new Int32Array(0); // offset into raw.times per trip
let walksFrom: [number, number][][] = [];
let tripIndex = new Map<string, number>();

function load() {
  if (raw) return raw;
  const file = path.join(dataDir, 'schedule.json');
  raw = JSON.parse(readFileSync(file, 'utf8')) as Raw;
  stationIndex = new Map(raw.stations.map((s, i) => [s[0], i]));
  tripTimeStart = new Int32Array(raw.trips.id.length + 1);
  let o = 0;
  raw.trips.pattern.forEach((p, i) => { tripTimeStart[i] = o; o += raw!.patterns[p].length - 1; });
  tripTimeStart[raw.trips.id.length] = o;
  walksFrom = raw.stations.map(() => []);
  for (const [a, b, t] of raw.walks) walksFrom[a].push([b, t]);
  tripIndex = new Map(raw.trips.id.map((id, i) => [id, i]));
  return raw;
}

export function plannerReady() {
  try { load(); return true; } catch { return false; }
}

// ---- service days -------------------------------------------------------------------------------
type Day = { date: string; midnight: number; weekday: number };

/** The local date, its midnight (epoch s; GTFS "noon minus 12h") and weekday 0=Mon, for an instant. */
function localDay(epochS: number, shiftDays = 0): Day {
  const d = new Date((epochS + shiftDays * 86400) * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const date = `${parts.year}${parts.month}${parts.day}`;
  const secOfDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  // noon minus 12 h, so DST days still line up with GTFS times
  const noon = epochS + shiftDays * 86400 - secOfDay + 12 * 3600;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { date, midnight: noon - 12 * 3600, weekday };
}

function activeServices(day: Day): Set<string> {
  const r = load();
  const out = new Set<string>();
  for (const [sid, [days, start, end, added, removed]] of Object.entries(r.services)) {
    if (added.includes(day.date)) { out.add(sid); continue; }
    if (removed.includes(day.date)) continue;
    if (day.date >= start && day.date <= end && days[day.weekday] === '1') out.add(sid);
  }
  return out;
}

// ---- connections for a service day (cached) ---------------------------------------------------------
type Conns = { day: Day; dep: Int32Array; arr: Int32Array; from: Int32Array; to: Int32Array; trip: Int32Array; seq: Int16Array; n: number };
let cached: Conns | null = null;

function connectionsFor(day: Day): Conns {
  if (cached && cached.day.date === day.date) return cached;
  const r = load();
  const today = activeServices(day);
  const yesterday = activeServices(localDay(day.midnight + 12 * 3600, -1));
  const list: number[] = []; // flat: dep, arr, from, to, trip, seq
  const T = r.trips;
  for (let t = 0; t < T.id.length; t++) {
    const onToday = today.has(T.service[t]);
    const onYesterday = yesterday.has(T.service[t]) && T.start[t] >= 20 * 3600;
    if (!onToday && !onYesterday) continue;
    const stops = r.patterns[T.pattern[t]];
    for (const shift of [onToday ? 0 : null, onYesterday ? -86400 : null]) {
      if (shift === null) continue;
      let time = T.start[t] + shift;
      for (let k = 0; k + 1 < stops.length; k++) {
        const next = time + r.times[tripTimeStart[t] + k];
        if (next >= 0 || shift === 0) list.push(time, next, stops[k], stops[k + 1], t, k);
        time = next;
      }
    }
  }
  const n = list.length / 6;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => list[a * 6] - list[b * 6] || list[a * 6 + 1] - list[b * 6 + 1]);
  const c: Conns = {
    day, n, dep: new Int32Array(n), arr: new Int32Array(n), from: new Int32Array(n), to: new Int32Array(n), trip: new Int32Array(n), seq: new Int16Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = order[i] * 6;
    c.dep[i] = list[o]; c.arr[i] = list[o + 1]; c.from[i] = list[o + 2]; c.to[i] = list[o + 3]; c.trip[i] = list[o + 4]; c.seq[i] = list[o + 5];
  }
  cached = c;
  return c;
}

// ---- the scan -------------------------------------------------------------------------------------
export type Leg =
  | { kind: 'ride'; route: string; routeName: string; short: string; mode: string; color: string; text: string; trip: string; headsign: string;
      from: Place; to: Place; dep: number; arr: number; stops: Place[] }
  | { kind: 'walk'; from: Place; to: Place; dep: number; arr: number; seconds: number };
export type Place = { id: string; name: string; lat: number; lon: number };
export type Itinerary = { dep: number; arr: number; duration: number; transfers: number; legs: Leg[] };

const place = (i: number): Place => { const s = load().stations[i]; return { id: s[0], name: s[1], lat: s[4], lon: s[5] }; };

function scan(c: Conns, origins: number[], targets: Set<number>, startS: number) {
  const r = load();
  const N = r.stations.length;
  const arrive = new Int32Array(N).fill(2 ** 30);   // earliest arrival
  const ready = new Int32Array(N).fill(2 ** 30);    // earliest time a NEW vehicle can be boarded
  const how = new Int32Array(N).fill(-1);           // connection index that got us here, or -2 walk, -3 origin
  const walkFrom = new Int32Array(N).fill(-1);
  const walkSecs = new Int32Array(N).fill(0);
  const boarded = new Int32Array(r.trips.id.length).fill(-1); // connection where the trip was boarded
  const relaxWalks = (s: number, t: number) => {
    for (const [to, secs] of walksFrom[s]) {
      const at = t + secs;
      if (at < arrive[to]) { arrive[to] = at; ready[to] = at; how[to] = -2; walkFrom[to] = s; walkSecs[to] = secs; }
    }
  };
  for (const o of origins) { arrive[o] = startS; ready[o] = startS; how[o] = -3; }
  for (const o of origins) relaxWalks(o, startS);
  let best = 2 ** 30;
  for (const tgt of targets) best = Math.min(best, arrive[tgt]);
  const horizon = startS + MAX_HOURS * 3600;
  // first connection departing at or after start
  let lo = 0, hi = c.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.dep[mid] < startS) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < c.n; i++) {
    const dep = c.dep[i];
    if (dep > best || dep > horizon) break;
    const t = c.trip[i];
    if (boarded[t] < 0) {
      if (ready[c.from[i]] > dep) continue;
      boarded[t] = i;
    }
    const to = c.to[i];
    if (c.arr[i] < arrive[to]) {
      arrive[to] = c.arr[i];
      ready[to] = c.arr[i] + CHANGE_SLACK;
      how[to] = i;
      relaxWalks(to, c.arr[i]);
      if (targets.has(to)) best = Math.min(best, c.arr[i]);
      for (const [w] of walksFrom[to]) if (targets.has(w)) best = Math.min(best, arrive[w]);
    }
  }
  let target = -1;
  for (const tgt of targets) if (arrive[tgt] < 2 ** 30 && (target < 0 || arrive[tgt] < arrive[target])) target = tgt;
  if (target < 0) return null;
  // walk back
  const legs: Leg[] = [];
  let s = target;
  let guard = 0;
  while (how[s] !== -3 && guard++ < 64) {
    if (how[s] === -2) {
      const from = walkFrom[s];
      legs.push({ kind: 'walk', from: place(from), to: place(s), dep: arrive[s] - walkSecs[s], arr: arrive[s], seconds: walkSecs[s] });
      s = from;
      continue;
    }
    const exit = how[s];
    const trip = c.trip[exit];
    const enter = boarded[trip];
    const stops: Place[] = [];
    // the stations ridden through, in order
    const pat = r.patterns[r.trips.pattern[trip]];
    for (let k = c.seq[enter]; k <= c.seq[exit] + 1; k++) stops.push(place(pat[k]));
    const route = r.trips.route[trip];
    const ri = r.routes[route] ?? [route, '', 'other', '#7C878E', '#FFFFFF'];
    legs.push({
      kind: 'ride', route, routeName: ri[0], short: ri[1], mode: ri[2], color: ri[3], text: ri[4], trip: r.trips.id[trip],
      headsign: r.headsigns[r.trips.headsign[trip]], from: place(c.from[enter]), to: place(s), dep: c.dep[enter], arr: c.arr[exit], stops,
    });
    s = c.from[enter];
  }
  legs.reverse();
  // Drop walking at either end of the trip when it leads nowhere new.
  const toEpoch = (x: number) => c.day.midnight + x;
  for (const l of legs) { l.dep = toEpoch(l.dep); l.arr = toEpoch(l.arr); }
  const rides = legs.filter(l => l.kind === 'ride');
  if (!rides.length && !legs.length) return null;
  const first = legs[0], last = legs[legs.length - 1];
  return {
    dep: first.dep, arr: last.arr, duration: last.arr - first.dep, transfers: Math.max(0, rides.length - 1), legs,
  } as Itinerary;
}

/** A station or stop id (parent or child) -> station indices to start/end at. */
function resolve(id: string, stopParent: Record<string, string>): number[] {
  load();
  const own = stationIndex.get(id) ?? stationIndex.get(stopParent[id] ?? '');
  return own === undefined ? [] : [own];
}

export function plan(fromId: string, toId: string, atEpochS: number, stopParent: Record<string, string>, count = 3) {
  const from = resolve(fromId, stopParent);
  const to = resolve(toId, stopParent);
  if (!from.length || !to.length) return { error: 'unknown_place' as const };
  if (from[0] === to[0]) return { error: 'same_place' as const };
  const out: Itinerary[] = [];
  const targets = new Set(to);
  let start = atEpochS;
  for (let k = 0; k < count + 2 && out.length < count; k++) {
    // Service day of the departure; before 3 a.m. the previous day's late trips are included.
    const day = localDay(start);
    const c = connectionsFor(day);
    const it = scan(c, from, targets, start - day.midnight);
    if (!it) break;
    const firstRide = it.legs.find(l => l.kind === 'ride');
    if (!out.some(o => o.dep === it.dep && o.arr === it.arr)) out.push(it);
    start = (firstRide ? firstRide.dep : it.dep) + 60;
  }
  return { from: place(from[0]), to: place(to[0]), at: atEpochS, source: 'schedule' as const, itineraries: out };
}

export function tripKnown(tripId: string) { load(); return tripIndex.has(tripId); }
