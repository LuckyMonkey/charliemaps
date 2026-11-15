import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Basemap, Layer, Line, Network, Station } from './data';
import { BASE, loadBasemap, loadNetwork, project } from './data';
import type { Hit, Vehicle, View } from './MapView';
import { MapView } from './MapView';

// ---- small helpers ----------------------------------------------------------------------------------
const MODE_LABEL: Record<string, string> = {
  subway: 'Subway', mattapan: 'Mattapan Trolley', silver: 'Silver Line', rail: 'Commuter Rail', ferry: 'Ferry', bus: 'Bus',
};
const LAYERS: [Layer, string, string][] = [
  ['subway', '🚇', 'Subway'], ['rail', '🚆', 'Commuter Rail'], ['bus', '🚌', 'Bus'], ['ferry', '⛴️', 'Ferry'], ['live', '📡', 'Live'],
];
const lineLabel = (l: { short: string; name: string; mode: string }) =>
  l.mode === 'bus' ? `${l.short || l.name}` : l.mode === 'silver' ? `${l.short} ${l.name}` : l.name;
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const minutes = (t: number) => {
  const m = Math.round((t * 1000 - Date.now()) / 60000);
  return m <= 0 ? 'now' : m < 60 ? `${m} min` : clock(t);
};

type StationInfo = {
  id: string; name: string; municipality: string; accessible: boolean;
  arrivals: { asOf: number | null; live: boolean; arrivals: Arrival[] };
  alerts: { live: boolean; alerts: AlertItem[] };
};
type Arrival = { route: string; dir: number | null; to: string; time: number; platform: string; status: string; vehicle: string | null; uncertainty: number | null };
type AlertItem = { id: string; effect: string; severity: number; header: string; description: string; timeframe: string; url: string; lifecycle: string };

const FACILITY = new Set(['STATION_ISSUE', 'ACCESS_ISSUE', 'FACILITY_ISSUE', 'ELEVATOR_CLOSURE', 'ESCALATOR_CLOSURE', 'PARKING_ISSUE', 'PARKING_CLOSURE', 'BIKE_ISSUE', 'AMBER_ALERT', 'POLICY_CHANGE', 'STOP_MOVE', 'STOP_MOVED', 'SUMMARY']);

type Selection = { line: string | null; station: string | null; pattern: number };

function readUrl(): { sel: Selection; view: View | undefined } {
  const q = new URLSearchParams(location.search);
  const at = (q.get('at') ?? '').split(',').map(Number);
  return {
    sel: { line: q.get('line'), station: q.get('station'), pattern: Number(q.get('branch') ?? 0) || 0 },
    view: at.length === 3 && at.every(Number.isFinite) ? { cx: at[0], cy: at[1], scale: at[2] } : undefined,
  };
}
function writeUrl(sel: Selection, view: View | null, push: boolean) {
  const q = new URLSearchParams();
  if (sel.line) q.set('line', sel.line);
  if (sel.line && sel.pattern) q.set('branch', String(sel.pattern));
  if (sel.station) q.set('station', sel.station);
  if (view) q.set('at', `${Math.round(view.cx)},${Math.round(view.cy)},${view.scale.toPrecision(3)}`);
  const url = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
  if (url === `${location.pathname}${location.search}`) return;
  (push ? history.pushState : history.replaceState).call(history, null, '', url);
}

// ---- the app ----------------------------------------------------------------------------------------
export default function App() {
  const [net, setNet] = useState<Network | null>(null);
  const [base, setBase] = useState<Basemap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(readUrl, []);
  const [sel, setSel] = useState<Selection>(initial.sel);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(['subway', 'rail', 'ferry', 'bus', 'live']));
  const [big, setBig] = useState(false);
  const [vehicles, setVehicles] = useState<{ live: boolean; asOf: number | null; list: Vehicle[] }>({ live: false, asOf: null, list: [] });
  const [alerted, setAlerted] = useState<Record<string, number>>({});
  const [tip, setTip] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const mapRef = useRef<MapView | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(initial.view ?? null);
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => {
    loadNetwork().then(setNet).catch(e => setError(e instanceof Error ? e.message : 'The map could not load.'));
    loadBasemap().then(setBase);
  }, []);

  const line = net && sel.line ? net.lineById.get(sel.line) ?? null : null;
  const station = net && sel.station ? net.stationById.get(sel.station) ?? null : null;

  const select = useCallback((next: Partial<Selection>, opts: { fit?: boolean } = {}) => {
    setSel(prev => {
      const merged = { ...prev, ...next };
      if (next.line !== undefined && next.line !== prev.line && next.pattern === undefined) merged.pattern = 0;
      writeUrl(merged, viewRef.current, true);
      return merged;
    });
    if (opts.fit && net && mapRef.current) {
      const m = mapRef.current;
      if (next.station) {
        const st = net.stationById.get(next.station);
        if (st) m.flyTo({ cx: st.sx, cy: st.sy, scale: Math.max(m.view.scale, st.rank === 4 ? 0.9 : 0.12) });
      } else if (next.line) {
        const l = net.lineById.get(next.line);
        if (l) m.fit(l.bbox, true, l.mode === 'bus' ? 0.5 : 0.25);
      }
    }
  }, [net]);

  // Create the map once the data is here.
  useEffect(() => {
    if (!net || !canvasRef.current) return;
    const m = new MapView(canvasRef.current, net, {
      onPick: hit => {
        if (!hit) { select({ station: null }); return; }
        if (hit.kind === 'station') select({ station: hit.station.id });
        else if (hit.kind === 'line') select({ line: hit.line.id, station: null }, { fit: false });
        else if (hit.kind === 'vehicle') select({ line: hit.vehicle.route, station: hit.vehicle.station && net.stationById.has(hit.vehicle.station) ? hit.vehicle.station : null });
      },
      onHover: (hit, x, y) => setTip(hit ? { hit, x, y } : null),
      onView: view => { viewRef.current = view; writeUrl(selRef.current, view, false); },
    }, initial.view);
    mapRef.current = m;
    (window as unknown as { charlieMap: MapView }).charlieMap = m; // for the console and perf checks
    // Deep link without a camera: frame the selection.
    if (!initial.view) {
      const s = initial.sel.station ? net.stationById.get(initial.sel.station) : null;
      const l = initial.sel.line ? net.lineById.get(initial.sel.line) : null;
      if (s) m.flyTo({ cx: s.sx, cy: s.sy, scale: s.rank === 4 ? 0.9 : 0.12 }, false);
      else if (l) m.fit(l.bbox, false, 0.25);
    }
    return () => { m.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  useEffect(() => { mapRef.current?.setBasemap(base); }, [base, net]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.selectedLine = line;
    m.selectedStation = station;
    if (line) {
      const branches = line.patterns.map((p, i) => ({ p, i })).filter(({ p }) => p.typical && p.dir === 0);
      const pick = branches.find(b => b.i === sel.pattern) ?? branches[0] ?? { p: line.patterns[0] };
      // Rail lines share stations both ways; label the whole line. Buses: one side of the street.
      m.labelStops = line.mode === 'bus' ? new Set(pick.p.stops) : null;
    } else m.labelStops = null;
    m.layers = layers;
    m.big = big;
    m.invalidateStatic();
  }, [line, station, layers, big, net, sel.pattern]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.vehicles = vehicles.list;
    m.vehiclesLive = vehicles.live;
    m.invalidate();
  }, [vehicles, net]);

  // Back/forward restores the selection.
  useEffect(() => {
    const onPop = () => setSel(readUrl().sel);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Live vehicles: one server-sent event stream (the server polls MBTA, never the browser).
  useEffect(() => {
    if (!net) return;
    let es: EventSource | null = null;
    let poll = 0;
    let failures = 0;
    const apply = (snap: { live: boolean; asOf: number | null; vehicles: Omit<Vehicle, 'x' | 'y'>[] }) => {
      setVehicles({
        live: snap.live, asOf: snap.asOf,
        list: snap.vehicles.map(v => { const [x, y] = project(net, v.lat, v.lon); return { ...v, x, y }; }),
      });
    };
    const startPolling = () => {
      const tick = () => fetch(`${BASE}api/vehicles`).then(r => r.ok ? r.json() : null).then(s => s && apply(s)).catch(() => undefined);
      void tick();
      poll = window.setInterval(tick, 20_000);
    };
    if ('EventSource' in window) {
      es = new EventSource(`${BASE}api/events`);
      es.addEventListener('vehicles', e => { failures = 0; apply(JSON.parse((e as MessageEvent).data)); });
      es.addEventListener('alerts', e => setAlerted(JSON.parse((e as MessageEvent).data).alerted ?? {}));
      es.onerror = () => {
        failures++;
        if (failures > 3 && es) { es.close(); es = null; startPolling(); }
      };
    } else startPolling();
    fetch(`${BASE}api/lines`).then(r => r.ok ? r.json() : null)
      .then(d => d && setAlerted(Object.fromEntries(d.lines.filter((l: { alert: number }) => l.alert).map((l: { id: string; alert: number }) => [l.id, l.alert]))))
      .catch(() => undefined);
    return () => { es?.close(); clearInterval(poll); };
  }, [net]);

  const toggleLayer = (layer: Layer) => setLayers(prev => {
    const next = new Set(prev);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  });

  if (error) return <div className="cm-empty card"><img src="https://go.fridge.run/assets/art/fridge-explode.jpg" alt="" width="120" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /><p>{error}</p></div>;

  return <>
    <canvas ref={canvasRef} className="cm-canvas" tabIndex={0}
      aria-label="MBTA map. Drag or use the arrow keys to move, the wheel or plus and minus to zoom. Pick lines and stations in the panel." />
    {!net && <div className="cm-loading muted">Loading the MBTA map…</div>}
    {net && <>
      <Panel net={net} sel={sel} line={line} station={station} layers={layers} big={big} alerted={alerted} vehicles={vehicles}
        open={panelOpen} setOpen={setPanelOpen} select={select} toggleLayer={toggleLayer} setBig={setBig} />
      <div className="cm-zoom" role="group" aria-label="Zoom">
        <button className="btn small" onClick={() => mapRef.current?.zoomAt(1.6)} aria-label="Zoom in" title="Zoom in">＋</button>
        <button className="btn small" onClick={() => mapRef.current?.zoomAt(1 / 1.6)} aria-label="Zoom out" title="Zoom out">－</button>
        <button className="btn small" onClick={() => (line ? mapRef.current?.fit(line.bbox, true, 0.25) : mapRef.current?.fitCore())} aria-label="Fit the map" title="Fit the map">⤢</button>
        <button className="btn small" onClick={() => mapRef.current?.fitAll()} aria-label="Show the whole region" title="Whole region">🗺️</button>
        <NearMe net={net} onFound={(s, x, y) => { select({ station: s.id }); mapRef.current?.flyTo({ cx: x, cy: y, scale: 0.5 }); }} />
      </div>
      <Status net={net} vehicles={vehicles} live={layers.has('live')} />
      {tip && <Tooltip tip={tip} net={net} />}
    </>}
  </>;
}

// ---- floating panel ---------------------------------------------------------------------------------
function Panel(props: {
  net: Network; sel: Selection; line: Line | null; station: Station | null; layers: Set<Layer>; big: boolean;
  alerted: Record<string, number>; vehicles: { live: boolean; list: Vehicle[] };
  open: boolean; setOpen: (v: boolean) => void;
  select: (s: Partial<Selection>, o?: { fit?: boolean }) => void; toggleLayer: (l: Layer) => void; setBig: (v: boolean) => void;
}) {
  const { net, line, station, select, open } = props;
  const [query, setQuery] = useState('');
  const crumbs = <nav className="cm-crumbs" aria-label="Where you are">
    <a href="?" onClick={e => { e.preventDefault(); select({ line: null, station: null }); }}>Lines</a>
    {line && <> › <a href={`?line=${encodeURIComponent(line.id)}`} onClick={e => { e.preventDefault(); select({ station: null }); }}>{lineLabel(line)}</a></>}
    {station && <> › <span>{station.name}</span></>}
  </nav>;

  return <aside className={`card cm-panel${open ? '' : ' closed'}${props.big ? ' big' : ''}`} aria-label="Charlie Maps">
    <div className="cm-panel-top">
      <button className="link cm-grip" onClick={() => props.setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide the panel' : 'Show the panel'}><span /></button>
      <Search net={net} query={query} setQuery={setQuery} onPick={(kind, id) => {
        setQuery('');
        props.setOpen(true);
        if (kind === 'line') select({ line: id, station: null }, { fit: true });
        else select({ station: id }, { fit: true });
      }} />
    </div>
    {open && <div className="cm-panel-body">
      <div className="cm-layers" role="group" aria-label="Show on the map">
        {LAYERS.map(([key, emoji, label]) => <button key={key} className={`link cm-toggle${props.layers.has(key) ? ' on' : ''}`}
          aria-pressed={props.layers.has(key)} onClick={() => props.toggleLayer(key)}>{emoji} {label}</button>)}
        <button className={`link cm-toggle${props.big ? ' on' : ''}`} aria-pressed={props.big} onClick={() => props.setBig(!props.big)} title="Bigger type and lines, for reading from across the room">🔎 Big</button>
      </div>
      {(line || station) && crumbs}
      {station ? <StationView net={net} station={station} line={line} select={select} />
        : line ? <LineView net={net} line={line} sel={props.sel} alerted={props.alerted} vehicles={props.vehicles} select={select} />
          : <LineList net={net} alerted={props.alerted} select={select} />}
    </div>}
  </aside>;
}

function Search({ net, query, setQuery, onPick }: { net: Network; query: string; setQuery: (q: string) => void; onPick: (kind: 'line' | 'station', id: string) => void }) {
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    const lines = net.lines.filter(l => l.short.toLowerCase() === q || l.name.toLowerCase().includes(q) || l.short.toLowerCase().startsWith(q))
      .sort((a, b) => Number(b.short.toLowerCase() === q) - Number(a.short.toLowerCase() === q) || a.index - b.index)
      .slice(0, 6).map(l => ({ kind: 'line' as const, id: l.id, label: lineLabel(l), sub: MODE_LABEL[l.mode], color: l.color }));
    const stations = q.length < 2 ? [] : net.stations.filter(s => s.name.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank || Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 10).map(s => ({ kind: 'station' as const, id: s.id, label: s.name, sub: s.rank === 4 ? `Bus stop · ${s.muni}` : s.muni, color: '' }));
    return [...lines, ...stations];
  }, [net, query]);
  useEffect(() => setActive(0), [query]);
  return <div className="cm-search">
    <input type="search" value={query} placeholder="🔎 Find a station, stop or route" aria-label="Find a station, stop or route"
      onChange={e => setQuery(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === 'Enter' && results[active]) onPick(results[active].kind, results[active].id);
        else if (e.key === 'Escape') setQuery('');
      }} />
    {results.length > 0 && <ul className="cm-results" role="listbox">
      {results.map((r, i) => <li key={`${r.kind}${r.id}`} role="option" aria-selected={i === active}>
        <button onClick={() => onPick(r.kind, r.id)} className={i === active ? 'link active' : 'link'}>
          {r.kind === 'line' ? <span className="cm-swatch" style={{ background: r.color }} /> : <span className="cm-dot" />}
          <span className="cm-r-label">{r.label}</span><small>{r.sub}</small>
        </button>
      </li>)}
    </ul>}
  </div>;
}

function LineList({ net, alerted, select }: { net: Network; alerted: Record<string, number>; select: (s: Partial<Selection>, o?: { fit?: boolean }) => void }) {
  const [showBus, setShowBus] = useState(false);
  const groups: [string, Line[]][] = [
    ['Subway', net.lines.filter(l => l.mode === 'subway' || l.mode === 'mattapan')],
    ['Silver Line', net.lines.filter(l => l.mode === 'silver')],
    ['Commuter Rail', net.lines.filter(l => l.mode === 'rail')],
    ['Ferry', net.lines.filter(l => l.mode === 'ferry')],
  ];
  const buses = net.lines.filter(l => l.mode === 'bus');
  const row = (l: Line) => <li key={l.id}>
    <button className="link cm-line" onClick={() => select({ line: l.id, station: null }, { fit: true })}>
      <span className="cm-swatch" style={{ background: l.color }} />
      <span className="cm-line-name">{l.mode === 'silver' ? <><b>{l.short}</b> {l.name}</> : l.name}</span>
      {alerted[l.id] ? <span className="cm-alert-badge" title="Service alert">⚠️</span> : null}
    </button>
  </li>;
  return <div className="cm-lines">
    {groups.map(([title, list]) => list.length ? <section key={title}>
      <h3 className="cm-h">{title}</h3>
      <ul>{list.map(row)}</ul>
    </section> : null)}
    <section>
      <h3 className="cm-h">Bus <small>{buses.length} routes</small></h3>
      {showBus ? <div className="cm-busgrid">
        {buses.map(l => <button key={l.id} className={`link cm-bus${l.frequent ? ' frequent' : ''}`} title={l.name}
          onClick={() => select({ line: l.id, station: null }, { fit: true })}>{l.short || l.id}{alerted[l.id] ? ' ⚠️' : ''}</button>)}
      </div> : <button className="btn small" onClick={() => setShowBus(true)}>Show all {buses.length} bus routes</button>}
    </section>
    <p className="cm-hint muted">Drag to move, scroll or pinch to zoom. Tap a line or a station.</p>
  </div>;
}

function useJson<T>(url: string | null, refreshMs = 0, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) { setData(null); return; }
    let alive = true;
    setData(null); setFailed(false);
    const go = () => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => { if (alive) { setData(d); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    void go();
    const t = refreshMs ? window.setInterval(go, refreshMs) : 0;
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshMs, ...deps]);
  return { data, failed };
}

function LineView({ net, line, sel, alerted, vehicles, select }: {
  net: Network; line: Line; sel: Selection; alerted: Record<string, number>; vehicles: { live: boolean; list: Vehicle[] };
  select: (s: Partial<Selection>, o?: { fit?: boolean }) => void;
}) {
  const { data } = useJson<{ alerts: { alerts: AlertItem[] } }>(`${BASE}api/lines/${encodeURIComponent(line.id)}`, 60_000, [alerted[line.id]]);
  // Branch tabs: the typical patterns in direction 0 (Red: Ashmont / Braintree; CR branches), else all.
  const tabs = line.patterns.map((p, i) => ({ p, i })).filter(({ p }) => p.typical && p.dir === 0);
  const choices = tabs.length ? tabs : line.patterns.map((p, i) => ({ p, i }));
  const current = choices.find(c => c.i === sel.pattern) ?? choices[0];
  const pattern = current.p;
  const here = vehicles.list.filter(v => v.route === line.id);
  // The line view shows service alerts; escalators and elevators belong to their station.
  const service = (data?.alerts.alerts ?? []).filter(a => !FACILITY.has(a.effect) && a.severity >= 3);
  const atStation = new Map<string, Vehicle[]>();
  for (const v of here) if (v.station) atStation.set(v.station, [...(atStation.get(v.station) ?? []), v]);

  return <div className="cm-line-view" style={{ '--line': line.color } as React.CSSProperties}>
    <h2 className="cm-title"><span className="cm-bullet" style={{ background: line.color, color: line.text }}>{line.short || line.name.split(' ')[0]}</span> {line.name}</h2>
    <p className="cm-sub muted">{MODE_LABEL[line.mode]}{line.frequent ? ' · frequent service' : ''} · {line.dirs.filter(Boolean).join(' / ')}</p>
    <p className="cm-sub">{vehicles.live ? <span className="chip live">{here.length} {line.mode === 'bus' ? 'buses' : line.mode === 'ferry' ? 'boats' : 'trains'} running now</span> : <span className="chip">Live positions unavailable</span>}</p>
    {choices.length > 1 && <div className="tabs cm-tabs" role="tablist" aria-label="Branches">
      {choices.map(({ p, i }) => <a key={p.id} role="tab" href="#" aria-current={i === current.i ? 'page' : undefined} aria-selected={i === current.i}
        onClick={e => { e.preventDefault(); select({ pattern: i }); }}>{p.name}</a>)}
    </div>}
    {service.length ? <Alerts alerts={service} /> : null}
    <ol className="cm-strip" aria-label={`${pattern.name}, stops in order`}>
      {pattern.stops.map((si, k) => {
        const s = net.stations[si];
        const others = s.lines.map(li => net.lines[li]).filter(l => l !== line && l.mode !== 'bus');
        const buses = s.lines.map(li => net.lines[li]).filter(l => l !== line && l.mode === 'bus');
        const live = atStation.get(s.id);
        return <li key={`${s.id}${k}`} className={s.transfer ? 'transfer' : ''}>
          <button className="link" onClick={() => select({ station: s.id }, { fit: true })}>
            <span className="cm-stop-dot" aria-hidden="true" />
            <span className="cm-stop-name">{s.name}{s.acc ? <span className="cm-acc" title="Accessible"> ♿</span> : null}</span>
            {live && <span className="cm-here" title="A vehicle is at or near this stop now">●</span>}
            <span className="cm-conn">
              {others.slice(0, 6).map(l => <span key={l.id} className="cm-mini" style={{ background: l.color, color: l.text }} title={l.name}>{l.short || l.name.replace(/ Line$/, '').replace(/^Green Line /, 'GL ')}</span>)}
              {buses.length > 0 && <span className="cm-mini bus" title={buses.map(b => b.short).join(', ')}>🚌 {buses.length}</span>}
            </span>
          </button>
        </li>;
      })}
    </ol>
  </div>;
}

function StationView({ net, station, line, select }: { net: Network; station: Station; line: Line | null; select: (s: Partial<Selection>, o?: { fit?: boolean }) => void }) {
  const { data, failed } = useJson<StationInfo>(`${BASE}api/stations/${encodeURIComponent(station.id)}`, 30_000);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 15_000); return () => clearInterval(t); }, []);
  const lines = station.lines.map(li => net.lines[li]);
  const rapid = lines.filter(l => l.mode !== 'bus');
  const buses = lines.filter(l => l.mode === 'bus');
  // Group departures by route + destination, three times each.
  const groups = useMemo(() => {
    const out = new Map<string, Arrival[]>();
    for (const a of data?.arrivals.arrivals ?? []) {
      const k = `${a.route}|${a.to}`;
      const list = out.get(k) ?? [];
      if (list.length < 3) list.push(a);
      out.set(k, list);
    }
    return [...out.entries()].sort((a, b) => a[1][0].time - b[1][0].time);
  }, [data]);

  return <div className="cm-station-view">
    <h2 className="cm-title">{station.rank === 4 ? '🚏' : '🚉'} {station.name}</h2>
    <p className="cm-sub muted">{station.rank === 4 ? 'Bus stop' : 'Station'}{station.muni ? ` · ${station.muni}` : ''}{station.acc ? ' · ♿ accessible' : ''}</p>
    <div className="cm-serves">
      {rapid.map(l => <button key={l.id} className="link cm-pill" style={{ background: l.color, color: l.text }} onClick={() => select({ line: l.id }, { fit: true })}>{lineLabel(l)}</button>)}
      {buses.map(l => <button key={l.id} className="link cm-pill bus" onClick={() => select({ line: l.id }, { fit: true })} title={l.name}>{l.short}</button>)}
    </div>
    {data ? <StationAlerts alerts={data.alerts.alerts} /> : null}
    <h3 className="cm-h">Departures {data?.arrivals.asOf ? <small>as of {clock(data.arrivals.asOf)}</small> : null}</h3>
    {!data && !failed && <p className="muted">Loading departures…</p>}
    {failed && <p className="notice warn">Departures are unavailable right now.</p>}
    {data && !data.arrivals.live && <p className="notice warn">The live feed is stale, so no times are shown. The map keeps the schedule.</p>}
    {data && data.arrivals.live && groups.length === 0 && <p className="muted">No departures predicted in the next while.</p>}
    {data && data.arrivals.live && groups.length > 0 && <ul className="cm-deps">
      {groups.map(([k, list]) => {
        const l = net.lineById.get(list[0].route);
        return <li key={k}>
          <span className="cm-mini" style={{ background: l?.mode === 'bus' ? '#FFC72C' : l?.color ?? '#7C878E', color: l?.mode === 'bus' ? '#000' : l?.text ?? '#fff' }}>{l ? (l.short || l.name.replace(/ Line$/, '')) : list[0].route}</span>
          <span className="cm-dep-to">{list[0].to || 'Inbound'}{list[0].platform ? <small> · {list[0].platform}</small> : null}</span>
          <span className="cm-dep-times">{list.map((a, i) => <span key={i} className={a.status !== 'predicted' ? 'off' : ''} title={a.status !== 'predicted' ? a.status : clock(a.time)}>{a.status === 'cancelled' ? 'cancelled' : a.status === 'skipped' ? 'skips' : minutes(a.time)}</span>)}</span>
        </li>;
      })}
    </ul>}
    {line && !line.stationSet.has(station.index) && <p className="muted">Not on the {lineLabel(line)}.</p>}
    <p className="cm-source muted">Live times are MBTA predictions; the map is the published schedule.</p>
  </div>;
}

function StationAlerts({ alerts }: { alerts: AlertItem[] }) {
  const [more, setMore] = useState(false);
  const service = alerts.filter(a => !FACILITY.has(a.effect) && a.severity >= 3);
  const notices = alerts.filter(a => !service.includes(a));
  return <>
    {service.length > 0 && <Alerts alerts={service} />}
    {notices.length > 0 && (more ? <Alerts alerts={notices} />
      : <button className="link cm-notices" onClick={() => setMore(true)}>🛗 {notices.length} station {notices.length === 1 ? 'notice' : 'notices'} (elevators, escalators, facilities)</button>)}
  </>;
}

function Alerts({ alerts }: { alerts: AlertItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = alerts.slice(0, 4);
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
      {rapid.map(l => <span key={l.id} className="cm-mini" style={{ background: l.color, color: l.text }}>{l.short || l.name.replace(/ Line$/, '')}</span>)}
      {bus.length > 0 && <span className="cm-mini bus">🚌 {bus.slice(0, 8).map(b => b.short).join(' ')}{bus.length > 8 ? ' …' : ''}</span>}
    </span></>;
  } else if (hit.kind === 'line') {
    body = <><span className="cm-swatch" style={{ background: hit.line.color }} /> <b>{lineLabel(hit.line)}</b> <small>{hit.line.mode === 'bus' ? hit.line.name : MODE_LABEL[hit.line.mode]}</small></>;
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
  const v = net.feed.version.split(',')[0];
  return <div className="cm-status">
    {live && (vehicles.asOf ? (vehicles.live
      ? <span className="chip live" title={`Vehicle positions from the MBTA, ${clock(vehicles.asOf)}`}>{vehicles.list.length} vehicles · {clock(vehicles.asOf)}</span>
      : <span className="chip" title="The realtime feed is older than 3 minutes">Live feed stale</span>)
      : <span className="chip">Live feed connecting…</span>)}
    <span className="cm-credit">Schedule: MBTA {v} · Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</span>
  </div>;
}

function NearMe({ net, onFound }: { net: Network; onFound: (s: Station, x: number, y: number) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle');
  if (!('geolocation' in navigator)) return null;
  return <button className="btn small" aria-label="Find the nearest station to me" title={state === 'denied' ? 'Location is off' : 'Nearest station to me (your location stays on this device)'}
    disabled={state === 'busy'}
    onClick={() => {
      setState('busy');
      navigator.geolocation.getCurrentPosition(pos => {
        const [x, y] = project(net, pos.coords.latitude, pos.coords.longitude);
        // nearest rapid transit / rail station, computed here; nothing is sent anywhere
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
