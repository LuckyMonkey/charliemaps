import { useEffect, useMemo, useState } from 'react';

type Station = { id: string; name: string; lat: number; lon: number; accessible?: boolean };
type Route = { id: string; name: string; shortName: string; color: string; textColor: string; mode: string; pattern: string; stations: Station[] };
type Network = { source: string; generatedAt: string; routes: Route[]; stations: Station[] };
type Point = Station & { x: number; y: number; routes: Route[] };

const BACK = 'https://go.fridge.run/assets/back-button.png';
const BASE = import.meta.env.BASE_URL;

function project(stations: Station[]): Map<string, Point> {
  const lats = stations.map(s => s.lat), lons = stations.map(s => s.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const xPad = 92, yPad = 58, width = 1380, height = 820;
  const x = (lon: number) => xPad + ((lon - minLon) / (maxLon - minLon)) * (width - xPad * 2);
  const y = (lat: number) => yPad + ((maxLat - lat) / (maxLat - minLat)) * (height - yPad * 2);
  return new Map(stations.map(s => [s.id, { ...s, x: x(s.lon), y: y(s.lat), routes: [] }]));
}

function routePath(route: Route, points: Map<string, Point>) {
  return route.stations.map((station, index) => {
    const p = points.get(station.id);
    return p ? `${index ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : '';
  }).join(' ');
}

function transferCount(stationId: string, routes: Route[]) {
  return routes.filter(route => route.stations.some(station => station.id === stationId)).length;
}

function Detail({ route, routes, stationId, onStation, onBack }: {
  route: Route; routes: Route[]; stationId: string | null;
  onStation: (id: string) => void; onBack: () => void;
}) {
  const selected = stationId ? route.stations.find(s => s.id === stationId) : null;
  const selectedConnections = selected ? routes.filter(r => r.id !== route.id && r.stations.some(s => s.id === selected.id)) : [];
  const height = Math.max(720, route.stations.length * 74 + 120);
  return <div className="detail" style={{ '--route-color': route.color } as React.CSSProperties}>
    <button className="detail-back" onClick={onBack} aria-label="Back to the MBTA map">← map</button>
    <div className="detail-heading"><span className="route-mark" style={{ backgroundColor: route.color }} />
      <h1>{route.name}</h1><span className="pattern">{route.pattern}</span>
    </div>
    <div className="line-strip">
      <svg viewBox={`0 0 920 ${height}`} role="img" aria-label={`${route.name}, stations in order`}>
        <path className="detail-rail" d={`M 365 60 L 365 ${height - 60}`} />
        {route.stations.map((station, index) => {
          const y = 60 + index * ((height - 120) / Math.max(1, route.stations.length - 1));
          const transfer = transferCount(station.id, routes) > 1;
          const active = station.id === stationId;
          return <g key={station.id} className={active ? 'detail-station active' : 'detail-station'} role="button" tabIndex={0}
            aria-label={`${station.name}${transfer ? ', connection' : ''}`} onClick={() => onStation(station.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onStation(station.id); } }}>
            {transfer && <circle cx="365" cy={y} r="14" className="transfer-ring" />}
            <circle cx="365" cy={y} r={transfer ? 8 : 5.5} className="station-dot" />
            <line x1="365" y1={y} x2={index % 2 ? 332 : 398} y2={y} className="station-tick" />
            <text x={index % 2 ? 316 : 414} y={y + 5} textAnchor={index % 2 ? 'end' : 'start'} className="detail-name">{station.name}</text>
            {active && <text x={index % 2 ? 316 : 414} y={y + 25} textAnchor={index % 2 ? 'end' : 'start'} className="detail-note">{transfer ? `${transferCount(station.id, routes)} lines` : 'station'}</text>}
          </g>;
        })}
        {selectedConnections.map((connection, index) => <g key={connection.id} className="connection-overlap">
          <line x1="365" y1={height - 30 - index * 19} x2="520" y2={height - 30 - index * 19} stroke={connection.color} />
          <text x="530" y={height - 26 - index * 19}>{connection.name}</text>
        </g>)}
      </svg>
    </div>
    {selected && selectedConnections.length > 0 && <div className="connection-summary" aria-live="polite">
      {selected.name} · {selectedConnections.map(connection => <button key={connection.id} style={{ color: connection.color }} onClick={onBack}>{connection.name}</button>)}
    </div>}
  </div>;
}

export default function App() {
  const [network, setNetwork] = useState<Network | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}data/network.json`).then(response => {
      if (!response.ok) throw new Error(`Network data unavailable (${response.status})`);
      return response.json() as Promise<Network>;
    }).then(setNetwork).catch(reason => setError(reason instanceof Error ? reason.message : 'Network data unavailable'));
  }, []);

  const points = useMemo(() => network ? project(network.stations) : new Map<string, Point>(), [network]);
  const route = network?.routes.find(item => item.id === selectedRoute) ?? null;

  if (error) return <main className="map-error"><a href="https://fridge.run/" className="back-link"><img src={BACK} alt="Back to fridge.run" /></a><p>{error}</p></main>;
  if (!network) return <main className="map-loading"><a href="https://fridge.run/" className="back-link"><img src={BACK} alt="Back to fridge.run" /></a></main>;
  if (route) return <><a href="https://fridge.run/" className="back-link"><img src={BACK} alt="Back to fridge.run" /></a><Detail route={route} routes={network.routes} stationId={stationId} onStation={setStationId} onBack={() => { setSelectedRoute(null); setStationId(null); }} /></>;

  return <main className="network-page">
    <a href="https://fridge.run/" className="back-link"><img src={BACK} alt="Back to fridge.run" /></a>
    <svg className="network-map" viewBox="0 0 1480 900" role="img" aria-labelledby="map-title map-description">
      <title id="map-title">MBTA rapid transit map</title><desc id="map-description">The canonical route and station projection generated from the official MBTA GTFS schedule.</desc>
      <g className="map-routes">{network.routes.map(item => <path key={item.id} d={routePath(item, points)} stroke={item.color} onClick={() => { setSelectedRoute(item.id); setStationId(null); }} tabIndex={0} role="button" aria-label={`Open ${item.name}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRoute(item.id); } }} />)}</g>
      <g className="map-stations">{network.stations.map(station => { const point = points.get(station.id); if (!point) return null; const transfer = transferCount(station.id, network.routes) > 1; return <g key={station.id} className="map-station" transform={`translate(${point.x} ${point.y})`}>
        <circle r={transfer ? 8 : 4.5} className={transfer ? 'map-dot transfer' : 'map-dot'} /><text x="10" y="4">{station.name}</text>
      </g>; })}</g>
    </svg>
  </main>;
}
