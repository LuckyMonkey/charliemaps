import React, { useEffect, useMemo, useState } from 'react';
import { demoConnections, demoLines, demoTripMinutes, pointOnLine, type DemoLine, type DemoStop } from './demoNetwork';

type Tip = { x: number; y: number; line: DemoLine; stop: DemoStop };
type Status = 'checking' | 'ready' | 'offline';
const linePath = (line: DemoLine) => line.stops.map((s, i) => (i ? 'L' : 'M') + s.x + ' ' + s.y).join(' ');

function Track({ line, d, focus = false }: { line: DemoLine; d: string; focus?: boolean }) {
  const stroke = focus ? 29 : line.mode === 'commuter' ? 14 : line.mode === 'bus' ? 22 : 18;
  return (
    <g aria-hidden="true">
      {line.mode === 'bus' && <path d={d} fill="none" stroke="#24282d" strokeWidth={stroke + 7} strokeLinejoin="round" strokeLinecap="round" />}
      {line.mode === 'commuter' && <path d={d} fill="none" stroke="#24282d" strokeWidth={stroke+8} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={d} fill="none" stroke={line.color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
      {line.mode === 'bus' && <path d={d} fill="none" stroke="white" strokeWidth="3" strokeDasharray="12 13" strokeLinecap="round" />}
      {line.mode === 'commuter' && <path d={d} fill="none" stroke="white" strokeOpacity=".8" strokeWidth="2" strokeDasharray="5 9" />}
      {line.mode === 'tram' && <path d={d} fill="none" stroke="white" strokeOpacity=".45" strokeWidth="2" />}
    </g>
  );
}
function Vehicle({ x, y, color, text = 'DEMO' }: { x: number; y: number; color: string; text?: string }) {
  return <g transform={`translate(${x} ${y})`} aria-label="Sample vehicle, not live">
    <rect x="-29" y="-20" width="58" height="40" rx="10" fill="#fff" stroke="#141c24" strokeWidth="4" />
    <rect x="-20" y="-12" width="40" height="13" rx="4" fill={color} />
    <circle cx="-13" cy="11" r="3" fill="#141c24" /><circle cx="13" cy="11" r="3" fill="#141c24" />
    <text x="0" y="-28" textAnchor="middle" className="vehicle-tag">{text}</text>
  </g>;
}
const modeLabel = (line: DemoLine) => line.mode === 'commuter' ? 'PURPLE' : line.mode === 'bus' ? 'BUS' : 'SUBWAY';

export default function App() {
  const [lineId, setLineId] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [fiveFoot, setFiveFoot] = useState(false);
  const [status, setStatus] = useState<Status>('checking');
  const [search, setSearch] = useState('');
  const [locationStatus, setLocationStatus] = useState('Location off');
  const [originId, setOriginId] = useState('suffolk');

  const line = useMemo(() => demoLines.find(l => l.id === lineId) || null, [lineId]);
  const station = line?.stops.find(s => s.id === stationId) ?? null;
  const connected = station ? demoConnections(station.id) : [];
  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return demoLines.flatMap(l => l.stops.filter(s => s.name.toLowerCase().includes(q)).map(s => ({line:l,stop:s}))).slice(0,6);
  }, [search]);

  useEffect(() => {
    fetch('/api/health', { signal: AbortSignal.timeout(6000) })
      .then(r => setStatus(r.ok ? 'ready' : 'offline'))
      .catch(() => setStatus('offline'));
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (stationId) setStationId(null); else { setLineId(null); setTip(null); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [stationId]);

  const overview = () => { setLineId(null); setStationId(null); setTip(null); };
  const focus = (l: DemoLine, s?: DemoStop) => {
    setLineId(l.id); setStationId(s?.id ?? null); setTip(null); setSearch('');
  };
  const showTip = (e: React.MouseEvent<SVGGElement>, l: DemoLine, s: DemoStop) =>
    setTip({x: e.clientX, y: e.clientY, line: l, stop: s});
  const locate = () => {
    if (!navigator.geolocation) { setLocationStatus('Geolocation unavailable'); return; }
    setLocationStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      position => {
        // Location is never sent anywhere. Nearest-stop and routing require real graph data.
        void position.coords.latitude;
        setLocationStatus('Location permitted · routing not connected yet');
      },
      () => setLocationStatus('Location unavailable or denied'),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 }
    );
  };
  const demoETA = (l: DemoLine, s: DemoStop) => {
    const localOrigin = l.stops.some(x => x.id === originId) ? originId : l.stops[0].id;
    return demoTripMinutes(l, localOrigin, s.id);
  };
  const focusHeight = line ? line.stops.length * 112 + 75 : 100;
  const focusTrack = line ? `M 205 72 L 205 ${line.stops.length * 112 - 36}` : '';

  return <div className={fiveFoot ? 'app five-foot' : 'app'}>
    <header className="topbar">
      <button className="brand" onClick={overview} aria-label="Charlie Maps network overview">
        <span className="brand-icon">C<span>↗</span></span>
        <span><strong>CHARLIE MAPS</strong><small>BOSTON, UNFOLDED.</small></span>
      </button>
      <div className="header-actions">
        <span className="badge demo">● DEMO DATA</span>
        <span className={status === 'ready' ? 'badge graph-ready' : 'badge graph-idle'}>
          GRAPH {status === 'ready' ? 'ONLINE' : status === 'offline' ? 'OFFLINE' : 'CHECKING'}
        </span>
        <button className={fiveFoot ? 'chip selected' : 'chip'} onClick={() => setFiveFoot(v => !v)}
          aria-pressed={fiveFoot}>5-FOOT {fiveFoot ? 'ON' : 'OFF'}</button>
      </div>
    </header>
    <main>
      <section className="controlbar" aria-label="Charlie Maps controls">
        <div className="locator">
          <span aria-hidden>⌕</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Find a station or stop…" aria-label="Search sample stations" />
          {results.length > 0 && <div className="search-results" role="listbox">
            {results.map(({line:l,stop:s}) => <button key={l.id+s.id} onClick={() => focus(l,s)}>
              <span className="line-dot" style={{backgroundColor:l.color}} /> {s.name}
              <small>{l.name}</small></button>)}
          </div>}
        </div>
        <button onClick={locate} className="locate-button" title="Optional, browser-side location">
          ◉ <span>{locationStatus}</span>
        </button>
      </section>
      <div className="workspace">
        <aside className="rail">
          <p className="eyebrow">EXPLORE</p>
          <h1>{line ? line.name : 'The whole T.\nOne big picture.'}</h1>
          <p className="aside-copy">{line
            ? 'Follow the thick track. Choose a stop to unfold transfers and bus branches.'
            : 'Touch a colored line to straighten it into a living route diagram.'}</p>
          <div className="rail-links">
            <button className={!line ? 'route-pill active' : 'route-pill'} onClick={overview}><span className="pill-square">⌗</span> Entire network <span>↗</span></button>
            {demoLines.map(l => <button key={l.id} onClick={() => focus(l)}
              className={lineId === l.id ? 'route-pill active' : 'route-pill'}>
              <span className="line-dot" style={{backgroundColor:l.color}} />
              <span>{l.name}</span><span>→</span>
            </button>)}
          </div>
          <div className="note">
            <strong>NOT LIVE YET</strong>
            <p>Tracks, trains, and ETAs on this screen are design samples. The GTFS → Neo4j importer is the next milestone.</p>
          </div>
        </aside>
        <section className="stage" aria-label={line ? `Focused ${line.name} station diagram` : 'MBTA schematic sample network'}>
          <div className="stage-heading">
            <div className="crumbs"><button onClick={overview}>NETWORK</button><span> / </span>
              <strong>{line ? line.name.toUpperCase() : 'BOSTON'}</strong>
              {station && <><span> / </span><strong>{station.name.toUpperCase()}</strong></>}
            </div>
            <div className="stage-options">
              {line && <button className="overview-button" onClick={overview}>↗ ZOOM OUT</button>}
              <span className="scale-pill">{line ? modeLabel(line) : 'ALL MODES'}</span>
            </div>
          </div>
          {!line ? <div className="map-window">
            <svg viewBox="0 0 1100 700" className="network-svg" role="img"
              aria-label="Illustrative SVG transit network. Choose a track or station.">
              <defs><pattern id="paper" patternUnits="userSpaceOnUse" width="42" height="42"><path d="M42 0H0V42" fill="none" stroke="#edf0f3" strokeWidth="1" /></pattern></defs>
              <rect width="1100" height="700" fill="url(#paper)" />
              <text x="55" y="58" className="map-heading">THE T · EXPLORE MODE</text>
              <text x="55" y="80" className="map-subheading">SCHEMATIC PREVIEW · NOT TO SCALE</text>
              {demoLines.map(l => <g key={l.id} className="svg-route" tabIndex={0} role="button"
                aria-label={`Focus ${l.name}`} onClick={() => focus(l)}
                onKeyDown={e => {if(e.key==='Enter'||e.key===' '){e.preventDefault(); focus(l);}}}>
                <path d={linePath(l)} fill="none" stroke="transparent" strokeWidth="43" className="route-hit" />
                <Track line={l} d={linePath(l)} />
              </g>)}
              {demoLines.map(l => {
                const p = pointOnLine(l,l.sampleVehicleProgress);
                return <Vehicle key={l.id} x={p.x} y={p.y} color={l.color} />;
              })}
              {demoLines.flatMap(l => l.stops.filter((s,i) => i === 0 || i === l.stops.length-1 || i%2===0 || demoConnections(s.id).length > 1)
                .map(s => <g key={l.id+s.id} role="button" tabIndex={0} className="svg-station"
                  aria-label={`Open ${s.name} on ${l.name}`}
                  transform={`translate(${s.x} ${s.y})`} onClick={() => focus(l,s)}
                  onMouseMove={e=>showTip(e,l,s)} onMouseLeave={()=>setTip(null)}
                  onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focus(l,s);}}}>
                  <circle r="21" fill="transparent" />
                  <circle r={demoConnections(s.id).length>1?11:8} fill="white" stroke="#111820" strokeWidth="4" />
                  {(s.id==='suffolk'||s.id==='gov'||s.id==='north'||s.id==='harvard'||s.id==='south'||s.id==='rockport'||s.id==='forest'||s.id==='oak'||s.id==='wonderland') &&
                    <text x="15" y="-17" className="map-label">{s.name}</text>}
                </g>))}
              <text x="50" y="677" className="map-subheading">BOSTON • SUBWAY • BUS • PURPLE COMMUTER RAIL</text>
            </svg>
          </div> : <div className="focus-layout">
            <div className="focus-scroll">
              <div className="focus-title"><span className="line-dot big" style={{backgroundColor:line.color}}/>
                <div><p>{modeLabel(line)} / SAMPLE ROUTE</p><h2>{line.name}</h2></div>
                <span className="direction-chip">↓ ALL STOPS</span>
              </div>
              <svg viewBox={`0 0 830 ${focusHeight}`} className="focused-svg" role="img"
                aria-label={`Vertical route diagram: ${line.stops.map(s=>s.name).join(', ')}`}>
                <Track line={line} d={focusTrack} focus />
                {line.stops.map((s,i) => {
                  const y = 72+i*112, isActive = s.id===stationId;
                  return <g key={s.id} className={isActive?'focus-stop picked':'focus-stop'} tabIndex={0} role="button"
                    aria-label={`Select ${s.name}`}
                    onClick={()=>{setStationId(s.id); setOriginId(s.id); setTip(null);}}
                    onMouseMove={e=>showTip(e,line,s)} onMouseLeave={()=>setTip(null)}
                    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setStationId(s.id);setOriginId(s.id);}}}>
                    <rect x="174" y={y-46} width="640" height="92" rx="20" fill={isActive?'#f2f5f8':'transparent'} className="stop-hit" />
                    <circle cx="205" cy={y} r="31" fill="white" stroke="#141c24" strokeWidth="5" />
                    <circle cx="205" cy={y} r="13" fill={line.color} />
                    <text x="262" y={y-5} className="stop-name">{s.name}</text>
                    <text x="262" y={y+26} className="stop-sub">{demoConnections(s.id).length>1?'TRANSFER / CONNECTION':'TOUCH FOR STATION DETAILS'}</text>
                    <text x="780" y={y+8} textAnchor="end" className="stop-arrow">↗</text>
                  </g>;
                })}
                <Vehicle x={205} y={72 + Math.min(line.stops.length-1,line.sampleVehicleProgress*(line.stops.length-1))*112}
                  color={line.color} text="SAMPLE" />
              </svg>
            </div>
            <div className="station-panel">
              {station ? <>
                <p className="eyebrow">FOCUS / STATION</p><h3>{station.name}</h3>
                <p className="panel-muted">Everything connected to this stop unfolds here.</p>
                <div className="transfer-list">
                  {connected.map(l => <button key={l.id} onClick={() => focus(l, l.stops.find(s=>s.id===station.id))}>
                    <span className="line-dot" style={{backgroundColor:l.color}}/>
                    <span>{l.name}</span><strong>↗</strong>
                  </button>)}
                </div>
                <p className="panel-warning">Travel times will appear here after Neo4j timetable routing is implemented.</p>
              </> : <>
                <div className="huge-arrow">↙</div><p className="eyebrow">SELECT A STATION</p>
                <h3>The line gets bigger. The network gets deeper.</h3>
                <p className="panel-muted">Choose a stop to reveal connected lines, bus branches, and eventually live travel times.</p>
              </>}
              <button className="origin-reset" onClick={()=>{setStationId(null);setOriginId('suffolk')}}>CLEAR FOCUS</button>
            </div>
          </div>}
          <div className="stage-footer"><span>◇ SVG / REACT / NEO4J</span><span>PLANNED + LIVE DELTAS → COMING NEXT</span></div>
        </section>
      </div>
    </main>
    {tip && <div className="pointer-tip" role="status" style={{left:Math.min(window.innerWidth-245,tip.x+20),top:Math.min(window.innerHeight-125,tip.y+18)}}>
      <span className="tip-eyebrow">DEMO TRAVEL TIME • NOT A LIVE ETA</span>
      <strong>{demoETA(tip.line,tip.stop) ?? '—'} min <small>sample</small></strong>
      <span>{tip.stop.name}</span>
      <small>Approx. stop spacing only; routing not connected.</small>
    </div>}
    <footer className="site-footer">CHARLIE MAPS / MADE FOR BOSTON <span>MBTA DATA © / ATTRIBUTION REQUIRED WHEN CONNECTED</span></footer>
  </div>;
}
