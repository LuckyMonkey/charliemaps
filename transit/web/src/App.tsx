import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Basemap, Layer, Line, Network, Station } from './data';
import { BASE, loadBasemap, loadNetwork, project } from './data';
import type { Hit, Trace, Vehicle, View } from './MapView';
import { MapView, sliceTrack } from './MapView';

// How it works (owner, 2026-11-15):
//  map -> click a line -> the map folds into that line's vertical diagram (stations morph into place)
//  -> click a station -> "start here" / "go here", or a bus stop next to it -> back to the map
//  -> the same for B -> the itinerary from the timetable, right now -> only then the live check.
//  Ctrl+K anywhere: type a station, stop or route, Enter picks it.

const MODE_LABEL: Record<string, string> = {
  subway: 'Subway', mattapan: 'Mattapan Trolley', silver: 'Silver Line', rail: 'Commuter Rail', ferry: 'Ferry', bus: 'Bus', shuttle: 'Shuttle bus',
};
const LAYERS: [Layer, string, string][] = [
  ['subway', '🚇', 'Subway'], ['rail', '🚆', 'Commuter Rail'], ['bus', '🚌', 'Bus'], ['ferry', '⛴️', 'Ferry'], ['live', '📡', 'Live'],
];
const FACILITY = new Set(['STATION_ISSUE', 'ACCESS_ISSUE', 'FACILITY_ISSUE', 'ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'PARKING_ISSUE', 'PARKING_CLOSURE', 'BIKE_ISSUE', 'AMBER_ALERT', 'POLICY_CHANGE', 'STOP_MOVE', 'STOP_MOVED', 'SUMMARY']);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const lineLabel = (l: { short: string; name: string; mode: string }) => (l.mode === 'bus' ? `${l.short || l.name}` : l.mode === 'silver' ? `${l.short} ${l.name}` : l.name);
const miniLabel = (l: { short: string; name: string }) => l.short || l.name.replace(/ Line$/, '').replace(/^Green Line /, 'GL ');
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const untilNow = (t: number) => { const m = Math.round((t * 1000 - Date.now()) / 60000); return m <= 0 ? 'now' : m < 60 ? `${m} min` : clock(t); };

type Pick = { id: string; name: string; kind: 'station' | 'stop' };
type Sel = { line: string | null; branch: number; station: string | null; a: Pick | null; b: Pick | null };
type Arrival = { route: string; to: string; time: number; platform: string; status: string };
type AlertItem = { id: string; effect: string; severity: number; header: string; description: string; timeframe: string; url: string };
type MiniLine = { id: string; short: string; name: string; color: string; mode: string };
type StationInfo = {
  id: string; name: string; municipality: string; accessible: boolean; kind: 'station' | 'stop'; lines: MiniLine[];
  nearby: { id: string; name: string; meters: number; lines: MiniLine[] }[];
  arrivals: { asOf: number | null; live: boolean; arrivals: Arrival[] };
  alerts: { alerts: AlertItem[] };
};
type Place = { id: string; name: string; lat: number; lon: number };
type RideLeg = { kind: 'ride'; route: string; routeName: string; short: string; mode: string; color: string; text: string; trip: string; headsign: string; from: Place; to: Place; dep: number; arr: number; stops: Place[] };
type Leg = RideLeg | { kind: 'walk'; from: Place; to: Place; dep: number; arr: number; seconds: number };
type Itinerary = { dep: number; arr: number; duration: number; transfers: number; legs: Leg[] };
type LiveLeg = { instead: { trip: string; dep: number; arr: number | null; vehicle: string | null } | null; trip: string; status: string; depDelta: number | null; arrDelta: number | null; depPredicted: number | null; arrPredicted: number | null;
  vehicle: { label: string; station: string | null; status: string } | null; alerts: { id: string; header: string; severity: number; effect: string }[] };

// ---- URL ----------------------------------------------------------------------------------------
const pickParam = (p: Pick | null) => (p ? `${p.kind === 'stop' ? 's' : 'p'}:${p.id}` : '');
function readUrl(net: Network | null): { sel: Sel; view: View | undefined } {
  const q = new URLSearchParams(location.search);
  const at = (q.get('at') ?? '').split(',').map(Number);
  const pick = (v: string | null): Pick | null => {
    if (!v) return null;
    const id = v.replace(/^[sp]:/, '');
    const st = net?.stationById.get(id);
    return { id, name: st?.name ?? id, kind: v.startsWith('s:') || st?.rank === 4 ? 'stop' : 'station' };
  };
  return {
    sel: { line: q.get('line'), branch: Number(q.get('branch') ?? 0) || 0, station: q.get('station'), a: pick(q.get('a')), b: pick(q.get('b')) },
    view: at.length === 3 && at.every(Number.isFinite) ? { cx: at[0], cy: at[1], scale: at[2] } : undefined,
  };
}
function writeUrl(sel: Sel, view: View | null, push: boolean) {
  const q = new URLSearchParams();
  if (sel.a) q.set('a', pickParam(sel.a));
  if (sel.b) q.set('b', pickParam(sel.b));
  if (sel.line) q.set('line', sel.line);
  if (sel.line && sel.branch) q.set('branch', String(sel.branch));
  if (sel.station) q.set('station', sel.station);
  if (view) q.set('at', `${Math.round(view.cx)},${Math.round(view.cy)},${view.scale.toPrecision(3)}`);
  const url = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
  if (url === `${location.pathname}${location.search}`) return;
  (push ? history.pushState : history.replaceState).call(history, null, '', url);
}

function useJson<T>(url: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) { setData(null); return; }
    let alive = true;
    setData(null); setFailed(false);
    const go = () => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => { if (alive) { setData(d); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    void go();
    const t = refreshMs ? window.setInterval(go, refreshMs) : 0;
    return () => { alive = false; clearInterval(t); };
  }, [url, refreshMs]);
  return { data, failed };
}

// ---- the app ----------------------------------------------------------------------------------------
export default function App() {
  const [net, setNet] = useState<Network | null>(null);
  const [base, setBase] = useState<Basemap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ line: null, branch: 0, station: null, a: null, b: null });
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(['subway', 'rail', 'ferry', 'bus', 'live']));
  const big = false;
  const [vehicles, setVehicles] = useState<{ live: boolean; asOf: number | null; list: Vehicle[] }>({ live: false, asOf: null, list: [] });
  const [alerted, setAlerted] = useState<Record<string, number>>({});
  const [tip, setTip] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [morph, setMorph] = useState<{ line: string; origins: Record<number, [number, number]> } | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [followId, setFollowId] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const mapRef = useRef<MapView | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const initial = useRef<{ view: View | undefined } | null>(null);

  useEffect(() => {
    loadNetwork().then(n => {
      const u = readUrl(n);
      initial.current = { view: u.view };
      viewRef.current = u.view ?? null;
      setSel(u.sel);
      setNet(n);
    }).catch(e => setError(e instanceof Error ? e.message : 'The map could not load.'));
    loadBasemap().then(setBase);
  }, []);

  const line = net && sel.line ? net.lineById.get(sel.line) ?? null : null;
  const station = net && sel.station ? net.stationById.get(sel.station) ?? null : null;

  const update = useCallback((next: Partial<Sel>, push = true) => {
    setSel(prev => {
      const merged = { ...prev, ...next };
      if (next.line !== undefined && next.line !== prev.line && next.branch === undefined) merged.branch = 0;
      writeUrl(merged, viewRef.current, push);
      return merged;
    });
  }, []);

  /** Open a line: fly to it, then fold the map into its vertical diagram. */
  const openLine = useCallback((id: string) => {
    const m = mapRef.current;
    const l = net?.lineById.get(id);
    if (!m || !l || !net) { update({ line: id, station: null }); return; }
    const capture = () => {
      const origins: Record<number, [number, number]> = {};
      for (const si of l.stationSet) origins[si] = m.screenOf(net.stations[si]);
      setMorph({ line: id, origins });
      update({ line: id, station: null });
    };
    m.selectedLine = l; m.invalidate();
    if (reducedMotion()) { capture(); return; }
    m.fit(l.bbox, true, l.mode === 'bus' ? 0.5 : 0.25);
    window.setTimeout(capture, 240);
  }, [net, update]);

  /** A or B chosen: back to the map; with both, the plan. */
  const pick = useCallback((p: Pick) => {
    const cur = selRef.current;
    if (cur.a?.id === p.id && !cur.b) { update({ line: null, station: null }); return; } // same place twice
    const next: Partial<Sel> = { line: null, station: null };
    if (!cur.a) next.a = p; else next.b = p;
    update(next);
    const st = net?.stationById.get(p.id);
    const m = mapRef.current;
    if (st && m && !next.b) m.flyTo({ cx: st.sx, cy: st.sy, scale: Math.max(m.view.scale, 0.06) });
  }, [net, update]);

  const choose = useCallback((r: { type: string; id: string; name: string }) => {
    if (r.type === 'route') openLine(r.id);
    else pick({ id: r.id, name: r.name, kind: r.type === 'stop' ? 'stop' : 'station' });
  }, [openLine, pick]);

  // the map
  useEffect(() => {
    if (!net || !canvasRef.current) return;
    const m = new MapView(canvasRef.current, net, {
      onPick: hit => {
        if (!hit) { update({ station: null }); return; }
        if (hit.kind === 'station') update({ station: hit.station.id });
        else if (hit.kind === 'line') openLine(hit.line.id);
        else if (hit.kind === 'vehicle') { setFollowId(hit.vehicle.id); setFollowing(true); update({ station: null }); }
      },
      onHover: (hit, x, y) => setTip(hit ? { hit, x, y } : null),
      onView: view => { viewRef.current = view; writeUrl(selRef.current, view, false); },
    }, initial.current?.view);
    mapRef.current = m;
    (window as unknown as { charlieMap: MapView }).charlieMap = m;
    if (!initial.current?.view) {
      const st = selRef.current.station ? net.stationById.get(selRef.current.station) : null;
      if (st) m.flyTo({ cx: st.sx, cy: st.sy, scale: st.rank === 4 ? 0.9 : 0.12 }, false);
    }
    return () => { m.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  useEffect(() => { mapRef.current?.setBasemap(base); }, [base, net]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !net) return;
    m.selectedLine = line;
    m.selectedStation = station;
    const pins: { label: 'A' | 'B'; x: number; y: number }[] = [];
    for (const [k, p] of [['A', sel.a], ['B', sel.b]] as const) {
      const st = p ? net.stationById.get(p.id) : null;
      if (st) pins.push({ label: k, x: st.sx, y: st.sy });
    }
    m.pins = pins;
    m.invalidate();
  }, [line, station, sel.a, sel.b, net]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.layers = layers; m.big = big; m.invalidateStatic();
  }, [layers, big, net]);
  useEffect(() => { const m = mapRef.current; if (m) { m.traces = traces; m.invalidate(); } }, [traces]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.setVehicles(vehicles.list, vehicles.live);
  }, [vehicles, net]);
  // Follow the chosen train or bus: the camera glides with it on every update (drag the map to pause).
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.selectedVehicle = followId;
    m.invalidate();
    if (!followId || !following) return;
    const v = vehicles.list.find(x => x.id === followId);
    if (v && !m.interacting) m.flyTo({ cx: v.x, cy: v.y, scale: Math.max(m.view.scale, 0.09) }, true, 1200);
  }, [vehicles, followId, following]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const pause = () => setFollowing(false);
    c.addEventListener('pointerdown', pause);
    c.addEventListener('wheel', pause, { passive: true });
    return () => { c.removeEventListener('pointerdown', pause); c.removeEventListener('wheel', pause); };
  }, [net]);

  useEffect(() => {
    const onPop = () => { setMorph(null); setSel(readUrl(net).sel); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [net]);

  // live vehicles over one SSE stream (the server polls MBTA; browsers never do)
  useEffect(() => {
    if (!net) return;
    let es: EventSource | null = null;
    let poll = 0;
    let failures = 0;
    const apply = (snap: { live: boolean; asOf: number | null; vehicles: Omit<Vehicle, 'x' | 'y'>[] }) => setVehicles({
      live: snap.live, asOf: snap.asOf,
      list: snap.vehicles.map(v => { const [x, y] = project(net, v.lat, v.lon); return { ...v, x, y }; }),
    });
    const startPolling = () => {
      const tick = () => fetch(`${BASE}api/vehicles`).then(r => (r.ok ? r.json() : null)).then(s => s && apply(s)).catch(() => undefined);
      void tick();
      poll = window.setInterval(tick, 20_000);
    };
    if ('EventSource' in window) {
      es = new EventSource(`${BASE}api/events`);
      es.addEventListener('vehicles', e => { failures = 0; apply(JSON.parse((e as MessageEvent).data)); });
      es.addEventListener('alerts', e => setAlerted(JSON.parse((e as MessageEvent).data).alerted ?? {}));
      es.onerror = () => { failures++; if (failures > 3 && es) { es.close(); es = null; startPolling(); } };
    } else startPolling();
    fetch(`${BASE}api/lines`).then(r => (r.ok ? r.json() : null))
      .then(d => d && setAlerted(Object.fromEntries(d.lines.filter((l: { alert: number }) => l.alert).map((l: { id: string; alert: number }) => [l.id, l.alert]))))
      .catch(() => undefined);
    return () => { es?.close(); clearInterval(poll); };
  }, [net]);

  const toggleLayer = useCallback((layer: Layer) => setLayers(prev => {
    const next = new Set(prev);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  }), []);
  const fitBox = useCallback((box: [number, number, number, number]) => mapRef.current?.fit(box, true, 0.4), []);

  const planning = !!(sel.a && sel.b);
  const lineOpen = !!line;

  if (error) return <div className="cm-empty card"><p>{error}</p></div>;

  return <>
    <canvas ref={canvasRef} className={`cm-canvas${lineOpen ? ' folded' : ''}`} tabIndex={0}
      aria-label="MBTA map. Drag or use the arrow keys to move, the wheel or plus and minus to zoom. Ctrl+K to find a place." />
    {!net && <div className="cm-loading muted">Loading the MBTA map…</div>}
    {net && <>
      <BarSearch onChoose={choose} next={sel.a ? 'B' : 'A'} />
      {line && <LineStage key={line.id} net={net} line={line} branch={sel.branch} sel={sel} vehicles={vehicles} alerted={alerted}
        origins={morph?.line === line.id ? morph.origins : null}
        mapPos={st => (mapRef.current ? mapRef.current.screenOf(st) : null)}
        onBranch={b => update({ branch: b }, false)}
        onClose={() => { setMorph(null); update({ line: null, station: null }); }}
        onPick={p => { setMorph(null); pick(p); }} />}
      {!lineOpen && <aside className={`card cm-panel${panelOpen ? '' : ' closed'}${big ? ' big' : ''}`} aria-label="Charlie Maps">
        <div className="cm-panel-top">
          <button className="link cm-grip" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} aria-label={panelOpen ? 'Hide the panel' : 'Show the panel'}><span /></button>
          <TripBar sel={sel} onClear={k => update(k === 'a' ? { a: sel.b, b: null } : { b: null })} onSwap={() => update({ a: sel.b, b: sel.a })} onReset={() => { setTraces([]); update({ a: null, b: null }); }} />
        </div>
        {panelOpen && <div className="cm-panel-body">
          {followId
            ? <VehiclePanel net={net} id={followId} following={following} onFollow={() => setFollowing(true)}
                onLine={id => { setFollowId(null); openLine(id); }} onClose={() => setFollowId(null)} />
            : planning
            ? <PlanView net={net} a={sel.a as Pick} b={sel.b as Pick} onTraces={setTraces} fit={fitBox} />
            : station
              ? <StationChooser net={net} station={station} sel={sel} onPick={pick} onLine={openLine} onClose={() => update({ station: null })} onCancel={() => update({ station: null })} />
              : <>
                <Layers layers={layers} toggle={toggleLayer} />
                <LineList net={net} alerted={alerted} onLine={openLine} />
              </>}
        </div>}
      </aside>}
      {!lineOpen && <div className="cm-zoom" role="group" aria-label="Zoom">
        <button className="btn small" onClick={() => mapRef.current?.zoomAt(1.6)} aria-label="Zoom in" title="Zoom in">＋</button>
        <button className="btn small" onClick={() => mapRef.current?.zoomAt(1 / 1.6)} aria-label="Zoom out" title="Zoom out">－</button>
        <button className="btn small" onClick={() => mapRef.current?.fitCore()} aria-label="Fit the subway" title="Fit the subway">⤢</button>
        <button className="btn small" onClick={() => mapRef.current?.fitAll()} aria-label="Show the whole region" title="Whole region">🗺️</button>
        <NearMe net={net} onFound={(s, x, y) => { update({ station: s.id }); mapRef.current?.flyTo({ cx: x, cy: y, scale: 0.5 }); }} />
      </div>}
      {!lineOpen && <Status net={net} vehicles={vehicles} live={layers.has('live')} />}
      {tip && !lineOpen && <Tooltip tip={tip} net={net} />}
    </>}
  </>;
}

// ---- the bar search (the house fsearch box, in the app bar) -------------------------------------------
type Result = { type: 'station' | 'stop' | 'route'; id: string; name: string; detail: string; mode: string; lines: MiniLine[];
  next?: { route: string; short: string; color: string; mode: string; to: string; time: number }[] };

/** Coloured dots for a result: one per line colour that calls there (yellow for buses). */
function Dots({ r }: { r: Result }) {
  const colors = r.type === 'route'
    ? [r.mode === 'bus' ? '#FFC72C' : (r.lines[0]?.color ?? '#7C878E')]
    : [...new Set(r.lines.filter(l => l.mode !== 'bus').map(l => l.color)), ...(r.lines.some(l => l.mode === 'bus') ? ['#FFC72C'] : [])];
  return <span className="cm-dots" aria-hidden="true">{colors.slice(0, 5).map(c => <span key={c} className="cm-d" style={{ background: c }} />)}</span>;
}

function BarSearch({ onChoose, next }: { onChoose: (r: Result) => void; next: 'A' | 'B' }) {
  const host = document.getElementById('cm-bar-search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`${BASE}api/search?q=${encodeURIComponent(term)}&limit=10`, { signal: ctl.signal })
        .then(r => r.json()).then(d => { setResults(d.results ?? []); setActive(0); }).catch(() => undefined);
    }, 90);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const go = (r: Result) => { onChoose(r); setQ(''); setResults([]); setOpen(false); input.current?.blur(); };
  if (!host) return null;
  return createPortal(<form className="fsearch cm-fsearch" role="search" onSubmit={e => { e.preventDefault(); if (results[active]) go(results[active]); }}>
    <span className="fsearch-icon" aria-hidden="true">🔍</span>
    <input ref={input} type="search" value={q} placeholder={`Find a station, stop or route (picks ${next})`} aria-label="Find a station, stop or route"
      autoComplete="off" role="combobox" aria-expanded={open && results.length > 0} aria-autocomplete="list"
      onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      onChange={e => { setQ(e.target.value); setOpen(true); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === 'Escape') { setQ(''); input.current?.blur(); }
      }} />
    <kbd className="fsearch-key">Ctrl+K</kbd>
    {open && q.trim() && <ul className="fsearch-list" role="listbox">
      <li className="fsearch-group"><div className="fsearch-app"><b>Charlie Maps</b> <i>›</i> {results.length ? 'Enter picks the first' : 'Nothing here yet'}</div>
        <ul>{results.map((r, i) => <li key={r.type + r.id} role="option" aria-selected={i === active}>
          <a href="#" className={i === active ? 'on' : ''} onMouseDown={e => { e.preventDefault(); go(r); }}>
            <span className="fsearch-title"><Dots r={r} /> {r.name}</span>
            <span className="fsearch-type">{r.type === 'route' ? 'open line' : `pick ${next}`}</span>
            {r.next && r.next.length > 0
              ? <span className="fsearch-detail cm-next">{r.next.map((a, k) => <span key={k}><span className="cm-d" style={{ background: a.mode === 'bus' ? '#FFC72C' : a.color }} />{a.short} → {a.to || '…'} <b>{untilNow(a.time)}</b></span>)}</span>
              : <span className="fsearch-detail">{r.detail}{r.lines.length && r.type !== 'route' ? ` · ${r.lines.slice(0, 8).map(miniLabel).join(', ')}` : ''}</span>}
          </a>
        </li>)}</ul>
      </li>
      <li className="fsearch-group"><div className="fsearch-app"><b>fridge.run</b></div>
        <ul><li><a href={`https://go.fridge.run/search?s=${encodeURIComponent(q.trim())}`}><span className="fsearch-title">Search everything for “{q.trim()}”</span><span className="fsearch-type">→</span></a></li></ul>
      </li>
    </ul>}
  </form>, host);
}

// ---- A -> B -------------------------------------------------------------------------------------------
function TripBar({ sel, onClear, onSwap, onReset }: { sel: Sel; onClear: (k: 'a' | 'b') => void; onSwap: () => void; onReset: () => void }) {
  // One field at a time: first "from", then "to"; once both are set, one line with Swap and Start over.
  if (sel.a && sel.b) return <div className="cm-trip both">
    <div className="cm-trip-line"><span className="cm-pin a">A</span><span className="cm-slot-name">{sel.a.name}</span>
      <span className="cm-arrow">→</span><span className="cm-pin b">B</span><span className="cm-slot-name">{sel.b.name}</span></div>
    <div className="cm-trip-tools">
      <button className="btn small" onClick={onSwap}>⇅ Swap</button>
      <button className="btn small" onClick={() => onClear('b')}>Change B</button>
      <button className="btn small" onClick={onReset}>✕ Start over</button>
    </div>
  </div>;
  if (sel.a) return <div className="cm-trip">
    <div className="cm-trip-done"><span className="cm-pin a">A</span><span className="cm-slot-name">{sel.a.name}</span></div>
    <div className="cm-slot next"><span className="cm-pin b">B</span><span className="cm-slot-hint">Where to? Open a line, tap a station, or search.</span></div>
    <div className="cm-trip-tools"><button className="btn small" onClick={onReset}>✕ Cancel</button></div>
  </div>;
  return <div className="cm-trip">
    <div className="cm-slot next"><span className="cm-pin a">A</span><span className="cm-slot-hint">Where from? Open a line, tap a station, or search.</span></div>
  </div>;
}

const Layers = memo(function Layers({ layers, toggle }: { layers: Set<Layer>; toggle: (l: Layer) => void }) {
  return <div className="cm-layers" role="group" aria-label="Show on the map">
    {LAYERS.map(([key, emoji, label]) => <button key={key} className={`link cm-toggle${layers.has(key) ? ' on' : ''}`} aria-pressed={layers.has(key)} onClick={() => toggle(key)}>{emoji} {label}</button>)}
  </div>;
});

const LineList = memo(function LineList({ net, alerted, onLine }: { net: Network; alerted: Record<string, number>; onLine: (id: string) => void }) {
  const [showBus, setShowBus] = useState(false);
  const groups: [string, Line[]][] = [
    ['Subway', net.lines.filter(l => l.mode === 'subway' || l.mode === 'mattapan')],
    ['Silver Line', net.lines.filter(l => l.mode === 'silver')],
    ['Commuter Rail', net.lines.filter(l => l.mode === 'rail')],
    ['Ferry', net.lines.filter(l => l.mode === 'ferry')],
  ];
  const buses = net.lines.filter(l => l.mode === 'bus');
  return <div className="cm-lines">
    {groups.map(([title, list]) => list.length ? <section key={title}>
      <h3 className="cm-h">{title}</h3>
      <ul>{list.map(l => <li key={l.id}><button className="link cm-line" onClick={() => onLine(l.id)}>
        <span className="cm-swatch" style={{ background: l.color }} />
        <span className="cm-line-name">{l.mode === 'silver' ? <><b>{l.short}</b> {l.name}</> : l.name}</span>
        {alerted[l.id] ? <span className="cm-alert-badge" title="Service alert">⚠️</span> : null}
      </button></li>)}</ul>
    </section> : null)}
    <section>
      <h3 className="cm-h">Bus <small>{buses.length} routes</small></h3>
      {showBus ? <div className="cm-busgrid">{buses.map(l => <button key={l.id} className={`link cm-bus${l.frequent ? ' frequent' : ''}`} title={l.name} onClick={() => onLine(l.id)}>{l.short || l.id}{alerted[l.id] ? ' ⚠️' : ''}</button>)}</div>
        : <button className="btn small" onClick={() => setShowBus(true)}>Show all {buses.length} bus routes</button>}
    </section>
    <p className="cm-hint muted">Click a line to open it, then a station to start there. Ctrl+K finds any station, stop or route.</p>
  </div>;
});

// ---- the line, straightened ---------------------------------------------------------------------------
function LineStage({ net, line, branch, sel, vehicles, alerted, origins, mapPos, onBranch, onClose, onPick }: {
  net: Network; line: Line; branch: number; sel: Sel; vehicles: { live: boolean; list: Vehicle[] }; alerted: Record<string, number>;
  origins: Record<number, [number, number]> | null; mapPos: (st: Station) => [number, number] | null;
  onBranch: (b: number) => void; onClose: () => void; onPick: (p: Pick) => void;
}) {
  const tabs = line.patterns.map((p, i) => ({ p, i })).filter(({ p }) => p.typical && (line.mode === 'bus' || p.dir === 0));
  const choices = tabs.length ? tabs : line.patterns.map((p, i) => ({ p, i }));
  const current = choices.find(c => c.i === branch) ?? choices[0];
  const pattern = current.p;
  const [open, setOpen] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLOListElement | null>(null);
  const dots = useRef(new Map<number, HTMLElement>());
  const { data: info } = useJson<{ alerts: { alerts: AlertItem[] } }>(`${BASE}api/lines/${encodeURIComponent(line.id)}`, 60_000);
  const service = (info?.alerts.alerts ?? []).filter(a => !FACILITY.has(a.effect) && a.severity >= 3);
  const here = vehicles.list.filter(v => v.route === line.id);

  // The morph: every station dot starts where it was on the map and slides into the straight line.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!origins || reducedMotion()) { el.classList.add('in'); return; }
    const box = el.getBoundingClientRect();
    for (const [si, dot] of dots.current) {
      const o = origins[si];
      if (!o) continue;
      const r = dot.getBoundingClientRect();
      dot.style.transition = 'none';
      dot.style.transform = `translate(${o[0] - (r.left + r.width / 2 - box.left)}px, ${o[1] - (r.top + r.height / 2 - box.top)}px)`;
    }
    void el.offsetHeight;
    requestAnimationFrame(() => {
      el.classList.add('in');
      for (const dot of dots.current.values()) { dot.style.transition = ''; dot.style.transform = ''; }
    });
  }, [origins]);

  const leave = (then: () => void) => {
    const el = root.current;
    if (!el || reducedMotion()) { then(); return; }
    const box = el.getBoundingClientRect();
    setLeaving(true);
    for (const [si, dot] of dots.current) {
      const p = mapPos(net.stations[si]);
      if (!p) continue;
      const r = dot.getBoundingClientRect();
      dot.style.transform = `translate(${p[0] - (r.left + r.width / 2 - box.left)}px, ${p[1] - (r.top + r.height / 2 - box.top)}px)`;
    }
    el.classList.remove('in');
    window.setTimeout(then, 300);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (open !== null) setOpen(null); else leave(onClose); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return <div ref={root} className={`cm-linestage${leaving ? ' leaving' : ''}`} style={{ '--line': line.color } as React.CSSProperties} role="dialog" aria-label={`${line.name}, straightened`}>
    <header className="cm-ls-head">
      <button className="btn small cm-ls-close" onClick={() => leave(onClose)} aria-label="Close the line, back to the map">✕ Close</button>
      <nav className="cm-crumbs" aria-label="Where you are">
        <a href="?" onClick={e => { e.preventDefault(); leave(onClose); }}>🗺️ Map</a> › <span>{lineLabel(line)}</span>
      </nav>
      <h2 className="cm-title"><span className="cm-bullet" style={{ background: line.color, color: line.text }}>{line.short || line.name.split(' ')[0]}</span> {line.name}</h2>
      <p className="cm-sub muted">{MODE_LABEL[line.mode]}{line.frequent ? ' · frequent service' : ''}
        {vehicles.live ? ` · ${here.length} ${line.mode === 'bus' ? 'buses' : line.mode === 'ferry' ? 'boats' : 'trains'} running now` : ''}
        {alerted[line.id] ? ' · ⚠️ service alert' : ''}</p>
      <p className="cm-sub">Pick a station to {sel.a ? <>end at (<b>B</b>)</> : <>start from (<b>A</b>)</>}.</p>
      {choices.length > 1 && <div className="tabs cm-tabs" role="tablist" aria-label="Branches">
        {choices.map(({ p, i }) => <a key={p.id} role="tab" href="#" aria-current={i === current.i ? 'page' : undefined} aria-selected={i === current.i}
          onClick={e => { e.preventDefault(); setOpen(null); onBranch(i); }}>{line.mode === 'bus' ? `to ${p.to || p.name}` : p.name}</a>)}
      </div>}
      {service.length > 0 && <Alerts alerts={service} />}
    </header>
    <ol ref={stripRef} className="cm-ls-strip" aria-label={`${pattern.name}, stops in order`}>
      <LiveOnLine net={net} line={line} stops={pattern.stops} dir={pattern.dir} vehicles={here} rows={dots} strip={stripRef} />
      {pattern.stops.map((si, k) => {
        const s = net.stations[si];
        const others = s.lines.map(li => net.lines[li]).filter(l => l !== line && l.mode !== 'bus');
        const buses = s.lines.map(li => net.lines[li]).filter(l => l !== line && l.mode === 'bus');
        const isA = sel.a?.id === s.id, isB = sel.b?.id === s.id;
        return <li key={`${s.id}${k}`} className={`${s.transfer ? 'transfer' : ''}${open === k ? ' open' : ''}`}>
          <button className="link cm-ls-row" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
            <span className="cm-ls-dot" ref={el => { if (el) dots.current.set(si, el); else dots.current.delete(si); }} aria-hidden="true" />
            <span className="cm-ls-name">{s.name}
              {isA && <span className="cm-pin a">A</span>}{isB && <span className="cm-pin b">B</span>}</span>
            <span className="cm-conn">
              {others.slice(0, 6).map(l => <span key={l.id} className="cm-mini" style={{ background: l.color, color: l.text }} title={l.name}>{miniLabel(l)}</span>)}
              {buses.length > 0 && <span className="cm-mini bus" title={buses.map(b => b.short).join(', ')}>🚌 {buses.length}</span>}
            </span>
          </button>
          {open === k && <div className="cm-ls-choose">
            <StationChooser net={net} station={s} sel={sel} onPick={p => leave(() => onPick(p))} onCancel={() => setOpen(null)} compact />
          </div>}
        </li>;
      })}
    </ol>
  </div>;
}

/** A station: start or end here, or at a bus stop next to it; departures below. */
function StationChooser({ net, station, sel, onPick, onLine, onClose, onCancel, compact }: {
  net: Network; station: Station; sel: Sel; onPick: (p: Pick) => void; onLine?: (id: string) => void; onClose?: () => void; onCancel?: () => void; compact?: boolean;
}) {
  const { data, failed } = useJson<StationInfo>(`${BASE}api/stations/${encodeURIComponent(station.id)}`, 30_000);
  const target = sel.a && sel.a.id !== station.id ? 'B' : 'A';
  const kind: 'station' | 'stop' = station.rank === 4 ? 'stop' : 'station';
  const rapid = station.lines.map(li => net.lines[li]).filter(l => l.mode !== 'bus');
  const busesHere = station.lines.map(li => net.lines[li]).filter(l => l.mode === 'bus');
  const groups = useMemo(() => {
    const out = new Map<string, Arrival[]>();
    for (const a of data?.arrivals.arrivals ?? []) {
      const k = `${a.route}|${a.to}`;
      const list = out.get(k) ?? [];
      if (list.length < 3) list.push(a);
      out.set(k, list);
    }
    return [...out.entries()].sort((a, b) => a[1][0].time - b[1][0].time).slice(0, compact ? 6 : 12);
  }, [data, compact]);
  const serviceAlerts = (data?.alerts.alerts ?? []).filter(a => !FACILITY.has(a.effect) && a.severity >= 3);

  return <div className="cm-chooser">
    {!compact && <nav className="cm-crumbs"><a href="?" onClick={e => { e.preventDefault(); onClose?.(); }}>Lines</a> › <span>{station.name}</span></nav>}
    {!compact && <h2 className="cm-title">{kind === 'stop' ? '🚏' : '🚉'} {station.name}</h2>}
    {!compact && <p className="cm-sub muted">{kind === 'stop' ? 'Bus stop' : 'Station'}{station.muni ? ` · ${station.muni}` : ''}</p>}
    <button className="primary cm-pick" onClick={() => onPick({ id: station.id, name: station.name, kind })}>
      {target === 'A' ? 'Start here' : 'Go here'} <span className={`cm-pin ${target.toLowerCase()}`}>{target}</span>
    </button>
    {onCancel && <button className="btn small cm-cancel" onClick={onCancel}>✕ Cancel</button>}
    {(busesHere.length > 0 || (data?.nearby.length ?? 0) > 0) && <details className="cm-fold">
      <summary>🚌 Or take a bus {kind === 'stop' ? 'from a stop nearby' : 'from here'} <small>({(busesHere.length ? 1 : 0) + (data?.nearby.length ?? 0)} stops)</small></summary>
      <ul className="cm-nearby">
        {busesHere.length > 0 && kind === 'station' && <li>
          <button className="link cm-near" onClick={() => onPick({ id: station.id, name: `${station.name} (bus)`, kind: 'station' })}>
            <span className="cm-near-name">🚏 {station.name}: its own bus stops</span>
            <span className="cm-near-lines">{busesHere.slice(0, 10).map(l => <span key={l.id} className="cm-mini bus">{l.short}</span>)}</span>
          </button>
        </li>}
        {data?.nearby.slice(0, 8).map(n => <li key={n.id}>
          <button className="link cm-near" onClick={() => onPick({ id: n.id, name: n.name, kind: 'stop' })}>
            <span className="cm-near-name">🚏 {n.name} <small>{n.meters} m</small></span>
            <span className="cm-near-lines">{n.lines.slice(0, 8).map(l => <span key={l.id} className={`cm-mini${l.mode === 'bus' ? ' bus' : ''}`} style={l.mode === 'bus' ? undefined : { background: l.color, color: '#fff' }}>{miniLabel(l)}</span>)}</span>
          </button>
        </li>)}
      </ul>
    </details>}
    {!compact && rapid.length > 0 && onLine && <div className="cm-serves">
      {rapid.map(l => <button key={l.id} className="link cm-pill" style={{ background: l.color, color: l.text }} onClick={() => onLine(l.id)}>{lineLabel(l)}</button>)}
    </div>}
    {serviceAlerts.length > 0 && <Alerts alerts={serviceAlerts} />}
    <h3 className="cm-h">Next departures {data?.arrivals.asOf ? <small>live, {clock(data.arrivals.asOf)}</small> : null}</h3>
    {!data && !failed && <p className="muted">Loading…</p>}
    {failed && <p className="notice warn">Departures are unavailable right now.</p>}
    {data && !data.arrivals.live && <p className="notice warn">The live feed is stale; no times shown.</p>}
    {data && data.arrivals.live && groups.length === 0 && <p className="muted">No departures predicted right now.</p>}
    {groups.length > 0 && <ul className="cm-deps">{groups.map(([k, list]) => {
      const l = net.lineById.get(list[0].route);
      return <li key={k}>
        <span className={`cm-mini${!l || l.mode === 'bus' ? ' bus' : ''}`} style={l && l.mode !== 'bus' ? { background: l.color, color: l.text } : undefined}>{l ? miniLabel(l) : list[0].route}</span>
        <span className="cm-dep-to">{list[0].to || '—'}</span>
        <span className="cm-dep-times">{list.map((a, i) => <span key={i} className={a.status !== 'predicted' ? 'off' : ''}>{a.status === 'cancelled' ? 'cancelled' : untilNow(a.time)}</span>)}</span>
      </li>;
    })}</ul>}
  </div>;
}

// ---- the itinerary ------------------------------------------------------------------------------------
function PlanView({ net, a, b, onTraces, fit }: { net: Network; a: Pick; b: Pick; onTraces: (t: Trace[]) => void; fit: (box: [number, number, number, number]) => void }) {
  const [stamp, setStamp] = useState(() => Math.floor(Date.now() / 1000));
  const url = `${BASE}api/plan?from=${encodeURIComponent(a.id)}&to=${encodeURIComponent(b.id)}&at=${stamp}`;
  const { data, failed } = useJson<{ itineraries: Itinerary[]; error?: string }>(url);
  const [choice, setChoice] = useState(0);
  const [live, setLive] = useState<{ live: boolean; asOf: number | null; legs: LiveLeg[] } | null>(null);
  const its = data?.itineraries ?? [];
  const it = its.length ? its[Math.min(choice, its.length - 1)] : null;
  useEffect(() => setChoice(0), [url]);

  // draw it on the map, on the real track
  useEffect(() => {
    if (!it) { onTraces([]); return; }
    const traces: Trace[] = [];
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (pts: Float32Array) => { for (let i = 0; i < pts.length; i += 2) { box[0] = Math.min(box[0], pts[i]); box[2] = Math.max(box[2], pts[i]); box[1] = Math.min(box[1], pts[i + 1]); box[3] = Math.max(box[3], pts[i + 1]); } };
    for (const leg of it.legs) {
      const [ax, ay] = project(net, leg.from.lat, leg.from.lon);
      const [bx, by] = project(net, leg.to.lat, leg.to.lon);
      let pts: Float32Array | null = null;
      if (leg.kind === 'ride') {
        const l = net.lineById.get(leg.route);
        if (l) pts = sliceTrack(l, ax, ay, bx, by);
        if (!pts) pts = new Float32Array(leg.stops.flatMap(s => project(net, s.lat, s.lon)));
      } else pts = new Float32Array([ax, ay, bx, by]);
      grow(pts);
      traces.push({ color: leg.kind === 'ride' ? (leg.mode === 'bus' ? '#e0a800' : leg.color) : '#1d1d1f', walk: leg.kind === 'walk', pts });
    }
    onTraces(traces);
    if (Number.isFinite(box[0])) fit(box);
    return () => onTraces([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it]);

  // only now: ask the realtime feed about these exact trips
  useEffect(() => {
    setLive(null);
    if (!it) return;
    const rides = it.legs.filter((l): l is RideLeg => l.kind === 'ride');
    if (!rides.length) return;
    const q = rides.map(l => [l.trip, l.from.id, l.to.id, l.dep, l.arr, l.route].join('|')).join(',');
    let alive = true;
    const check = () => fetch(`${BASE}api/plan/live?legs=${encodeURIComponent(q)}`).then(r => r.json()).then(d => { if (alive) setLive(d); }).catch(() => undefined);
    void check();
    const t = window.setInterval(check, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [it]);

  const delta = (s: number | null) => (s === null ? null : Math.abs(s) < 60 ? 'on time' : s > 0 ? `${Math.round(s / 60)} min late` : `${Math.round(-s / 60)} min early`);
  let rideNo = -1;
  return <div className="cm-plan">
    <h2 className="cm-title">🧭 {a.name} → {b.name}</h2>
    <p className="cm-sub muted">From the timetable, leaving {stamp > Date.now() / 1000 - 90 ? 'now' : `at ${clock(stamp)}`}.
      {' '}<button className="link" onClick={() => setStamp(Math.floor(Date.now() / 1000))}>Refresh</button></p>
    {!data && !failed && <p className="muted">Planning…</p>}
    {(failed || data?.error) && <p className="notice warn">No route found{data?.error === 'unknown_place' ? ': one of the places is not in the timetable' : ' in the next few hours'}.</p>}
    {data && !data.error && its.length === 0 && <p className="notice warn">No trip in the next few hours.</p>}
    {its.length > 1 && <div className="tabs cm-tabs" role="tablist" aria-label="Options">
      {its.map((o, i) => <a key={i} href="#" role="tab" aria-current={i === choice ? 'page' : undefined} aria-selected={i === choice}
        onClick={e => { e.preventDefault(); setChoice(i); }}>{clock(o.dep)} → {clock(o.arr)}</a>)}
    </div>}
    {it && <>
      <p className="cm-summary"><b>{mins(it.duration)}</b> · arrive {clock(it.arr)} · {it.transfers === 0 ? 'no changes' : `${it.transfers} change${it.transfers > 1 ? 's' : ''}`}</p>
      <ol className="cm-legs">
        {it.legs.map((leg, i) => {
          if (leg.kind === 'walk') return <li key={i} className="walk"><span className="cm-leg-ico">🚶</span>
            <div><b>Walk {mins(leg.seconds)}</b> to {leg.to.name}</div></li>;
          rideNo++;
          const lv = live?.legs[rideNo];
          const late = lv ? delta(lv.depDelta) : null;
          const busy = leg.mode === 'bus' || leg.mode === 'shuttle';
          return <li key={i} className="ride" style={{ '--line': busy ? '#FFC72C' : leg.color } as React.CSSProperties}>
            <span className={`cm-mini${busy ? ' bus' : ''}`} style={busy ? undefined : { background: leg.color, color: leg.text }}>{leg.short || leg.routeName.replace(/ Line$/, '')}</span>
            <div className="cm-leg-body">
              <div><b>{clock(leg.dep)}</b> {leg.from.name}</div>
              <div className="muted">{MODE_LABEL[leg.mode] ?? ''} towards {leg.headsign || '—'} · {leg.stops.length - 1} stop{leg.stops.length > 2 ? 's' : ''}</div>
              <div><b>{clock(leg.arr)}</b> {leg.to.name}</div>
              <div className="cm-live">
                {!live && <span className="muted">Checking live times…</span>}
                {lv && lv.status === 'predicted' && <span className={`chip${lv.depDelta !== null && lv.depDelta > 120 ? '' : ' live'}`}>{late ?? 'live'}{lv.depPredicted ? ` · leaves ${clock(lv.depPredicted)}` : ''}</span>}
                {lv && lv.status === 'cancelled' && !lv.instead && <span className="notice bad">This trip is cancelled. Pick another option.</span>}
                {lv?.instead && <span className="chip live">{lv.status === 'cancelled' ? 'Replaced: ' : 'Live: '}next one leaves {clock(lv.instead.dep)}{lv.instead.arr ? `, arrives ${clock(lv.instead.arr)}` : ''}</span>}
                {lv && lv.status === 'skipped' && <span className="notice warn">This stop is skipped on this trip.</span>}
                {lv && lv.status === 'no_prediction' && !lv.instead && <span className="chip">No live data yet (scheduled)</span>}
                {lv && lv.status === 'unavailable' && <span className="chip">Live feed stale</span>}
                {lv?.vehicle && <span className="muted"> · vehicle #{lv.vehicle.label}{lv.vehicle.station ? ` near ${net.stationById.get(lv.vehicle.station)?.name ?? ''}` : ''}</span>}
                {lv?.alerts.filter(x => !FACILITY.has(x.effect)).slice(0, 1).map(x => <p key={x.id} className="notice warn cm-leg-alert">{x.header}</p>)}
              </div>
            </div>
          </li>;
        })}
      </ol>
      {live && <p className="cm-source muted">Live check{live.asOf ? `, ${clock(live.asOf)}` : ''}: MBTA predictions for these exact trips. The plan itself is the published timetable.</p>}
    </>}
  </div>;
}

function Alerts({ alerts }: { alerts: AlertItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = alerts.slice(0, 3);
  return <ul className="cm-alerts">
    {shown.map(a => <li key={a.id} className={`notice ${a.severity >= 7 ? 'bad' : 'warn'}`}>
      <button className="link cm-alert-h" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>{a.header}</button>
      {open === a.id && <div className="cm-alert-b">
        {a.timeframe && <p><b>{a.timeframe}</b></p>}
        {a.description && <p>{a.description}</p>}
        {a.url && /^https:\/\//.test(a.url) && <p><a href={a.url} target="_blank" rel="noreferrer">More from the MBTA</a></p>}
      </div>}
    </li>)}
    {alerts.length > shown.length && <li className="muted">+ {alerts.length - shown.length} more</li>}
  </ul>;
}

function Tooltip({ tip, net }: { tip: { hit: Hit; x: number; y: number }; net: Network }) {
  const { hit, x, y } = tip;
  if (!hit) return null;
  let body: React.ReactNode = null;
  if (hit.kind === 'station') {
    const ls = hit.station.lines.map(li => net.lines[li]);
    const rapid = ls.filter(l => l.mode !== 'bus');
    const bus = ls.filter(l => l.mode === 'bus');
    body = <><b>{hit.station.name}</b><span className="cm-tip-lines">
      {rapid.map(l => <span key={l.id} className="cm-mini" style={{ background: l.color, color: l.text }}>{miniLabel(l)}</span>)}
      {bus.length > 0 && <span className="cm-mini bus">🚌 {bus.slice(0, 8).map(b => b.short).join(' ')}{bus.length > 8 ? ' …' : ''}</span>}
    </span></>;
  } else if (hit.kind === 'line') {
    body = <><span className="cm-swatch" style={{ background: hit.line.color }} /> <b>{lineLabel(hit.line)}</b> <small>click to open</small></>;
  } else {
    const v = hit.vehicle;
    const l = net.lineById.get(v.route);
    const at = v.station ? net.stationById.get(v.station)?.name : null;
    const verb = v.status === 'STOPPED_AT' ? 'At' : v.status === 'INCOMING_AT' ? 'Arriving at' : 'Next stop';
    body = <><b>{l ? lineLabel(l) : v.route}</b> <small>#{v.label}</small>{at && <span className="cm-tip-sub">{verb} {at}</span>}<span className="cm-tip-sub">seen {clock(v.ts)}</span></>;
  }
  return <div className="cm-tip" style={{ left: x + 14, top: y + 14 }} role="status">{body}</div>;
}

function Status({ net, vehicles, live }: { net: Network; vehicles: { live: boolean; asOf: number | null; list: Vehicle[] }; live: boolean }) {
  return <div className="cm-status">
    {live && (vehicles.asOf ? (vehicles.live
      ? <span className="chip live">{vehicles.list.length} vehicles · {clock(vehicles.asOf)}</span>
      : <span className="chip">Live feed stale</span>) : <span className="chip">Live feed connecting…</span>)}
    <span className="cm-credit">Schedule: MBTA {net.feed.version.split(',')[0]} · Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</span>
  </div>;
}

function NearMe({ net, onFound }: { net: Network; onFound: (s: Station, x: number, y: number) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle');
  if (!('geolocation' in navigator)) return null;
  return <button className="btn small" aria-label="Nearest station to me" title={state === 'denied' ? 'Location is off' : 'Nearest station to me (your location stays on this device)'}
    disabled={state === 'busy'}
    onClick={() => {
      setState('busy');
      navigator.geolocation.getCurrentPosition(pos => {
        const [x, y] = project(net, pos.coords.latitude, pos.coords.longitude);
        let best: Station | null = null, bd = Infinity;
        for (const s of net.stations) {
          if (s.rank > 3) continue;
          const d = Math.hypot(s.sx - x, s.sy - y);
          if (d < bd) { bd = d; best = s; }
        }
        setState('idle');
        if (best) onFound(best, x, y);
      }, () => setState('denied'), { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
    }}>{state === 'denied' ? '🚫' : '📍'}</button>;
}


// ---- live vehicles beside the straightened line --------------------------------------------------------
/** Trains and buses on this line, drawn left of the rail between the stations they are between. */
function LiveOnLine({ net, line, stops, dir, vehicles, rows, strip }: {
  net: Network; line: Line; stops: number[]; dir: number; vehicles: Vehicle[];
  rows: React.MutableRefObject<Map<number, HTMLElement>>; strip: React.RefObject<HTMLOListElement | null>;
}) {
  const [, relayout] = useState(0);
  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => relayout(n => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [strip]);
  const el = strip.current;
  if (!el) return null;
  const top0 = el.getBoundingClientRect().top;
  const centre = (si: number) => {
    const d = rows.current.get(si);
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return r.top + r.height / 2 - top0;
  };
  const ids = stops.map(si => net.stations[si].id);
  const items = vehicles.map(v => {
    const k = v.station ? ids.indexOf(v.station) : -1;
    if (k < 0) return null;
    const here = centre(stops[k]);
    if (here === null) return null;
    let y = here;
    // between the previous stop and the next one, by where the vehicle actually is
    const towards = v.dir === null || v.dir === dir ? 1 : -1;
    const pk = k - towards;
    if (v.status !== 'STOPPED_AT' && pk >= 0 && pk < stops.length) {
      const a = net.stations[stops[pk]], b = net.stations[stops[k]];
      const prevY = centre(stops[pk]);
      const dx = b.sx - a.sx, dy = b.sy - a.sy, den = dx * dx + dy * dy;
      const t = den ? Math.max(0, Math.min(1, ((v.x - a.sx) * dx + (v.y - a.sy) * dy) / den)) : 0.5;
      if (prevY !== null) y = prevY + (here - prevY) * t;
    }
    return { v, y, up: towards < 0 };
  }).filter(Boolean) as { v: Vehicle; y: number; up: boolean }[];
  return <div className="cm-live-rail" aria-label={`${items.length} vehicles on this line now`}>
    {items.map(({ v, y, up }) => <span key={v.id} className={`cm-live-veh${line.mode === 'bus' ? ' bus' : ''}`}
      style={{ transform: `translateY(${Math.round(y)}px)`, background: line.mode === 'bus' ? '#FFC72C' : line.color }}
      title={`#${v.label} ${v.status === 'STOPPED_AT' ? 'at' : 'to'} ${net.stationById.get(v.station ?? '')?.name ?? ''}`}>{up ? '▲' : '▼'}</span>)}
  </div>;
}

// ---- one vehicle, followed ---------------------------------------------------------------------------
function VehiclePanel({ net, id, following, onFollow, onLine, onClose }: {
  net: Network; id: string; following: boolean; onFollow: () => void; onLine: (id: string) => void; onClose: () => void;
}) {
  const { data, failed } = useJson<{ vehicle: Vehicle; to: string; live: boolean; next: { station: string; time: number; status: string }[] }>(`${BASE}api/vehicles/${encodeURIComponent(id)}`, 15_000);
  const v = data?.vehicle;
  const line = v ? net.lineById.get(v.route) : null;
  const at = v?.station ? net.stationById.get(v.station)?.name : null;
  return <div className="cm-vehicle">
    <div className="cm-row-between">
      <h2 className="cm-title">{line ? <span className="cm-bullet" style={{ background: line.mode === 'bus' ? '#FFC72C' : line.color, color: line.mode === 'bus' ? '#000' : line.text }}>{line.short || line.name.split(' ')[0]}</span> : null}
        {line ? lineLabel(line) : 'Vehicle'} {v ? <small className="muted">#{v.label}</small> : null}</h2>
      <button className="btn small" onClick={onClose}>✕ Close</button>
    </div>
    {failed && <p className="notice warn">This vehicle is not reporting any more.</p>}
    {v && <p className="cm-sub">{data?.to ? <>towards <b>{data.to}</b> · </> : null}{v.status === 'STOPPED_AT' ? 'at' : v.status === 'INCOMING_AT' ? 'arriving at' : 'next stop'} <b>{at ?? '…'}</b></p>}
    <div className="cm-trip-tools left">
      {following ? <span className="chip live">Following</span> : <button className="btn small primary" onClick={onFollow}>Follow</button>}
      {line && <button className="btn small" onClick={() => onLine(line.id)}>Open the line</button>}
    </div>
    {data && data.next.length > 0 && <>
      <h3 className="cm-h">Next stops</h3>
      <ol className="cm-nextstops">{data.next.map((n, i) => <li key={i} className={n.status === 'skipped' ? 'off' : ''}>
        <span className="cm-ns-name">{net.stationById.get(n.station)?.name ?? n.station}</span><b>{untilNow(n.time)}</b></li>)}</ol>
    </>}
    <p className="cm-source muted">Drag the map to look around; Follow brings it back. Positions are the MBTA's, about every 15 seconds.</p>
  </div>;
}
