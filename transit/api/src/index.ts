import express, { NextFunction, Request, Response } from 'express';
import compression from 'compression';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driver, graphReady } from './graph.js';
import {
  alertedRoutes, alertsFor, arrivalsAt, bus, realtimeState, startRealtimeCollector, stopRealtimeCollector, vehicleSnapshot,
} from './realtime.js';
import { lineDetail, lineSummaries, scheduleNetwork, stationDetail } from './schedule.js';

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');
// Caddy strips /transit in production; accept it too so a local run behaves the same.
app.use((req, _res, next) => {
  if (req.url === '/transit' || req.url.startsWith('/transit/') || req.url.startsWith('/transit?')) req.url = req.url.slice(8) || '/';
  next();
});
app.use(compression({ filter: (req, res) => req.path !== '/api/events' && compression.filter(req, res) }));
const port = Number(process.env.PORT || 4100);

// Every /api answer is a projection with its own as-of time; never cache it in between.
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

app.get('/api/health', async (_req: Request, res: Response) => {
  const ready = await graphReady();
  const network = scheduleNetwork();
  res.status(ready ? 200 : 503).json({
    service: 'charlie-maps', status: ready ? 'ready' : 'graph_unavailable', graph: 'neo4j', mode: 'schedule-first',
    schedule: network ? { feed: network.feed, generatedAt: network.generatedAt, lines: network.lines.length, stations: network.stations.length } : null,
    realtime: realtimeState(), now: new Date().toISOString(),
  });
});

app.get('/api/network', async (_req: Request, res: Response) => {
  const network = scheduleNetwork();
  if (!network) { res.status(503).json({ mode: 'unavailable', lines: [], stations: [] }); return; }
  res.json({ mode: 'schedule', graph: (await graphReady()) ? 'available' : 'unavailable', ...network });
});

app.get('/api/lines', (_req, res) => {
  const alerted = alertedRoutes();
  res.json({ lines: lineSummaries().map(l => ({ ...l, alert: alerted[l.id] ?? 0 })) });
});
app.get('/api/lines/:id', (req, res) => {
  const line = lineDetail(req.params.id);
  if (!line) { res.status(404).json({ error: 'unknown_line' }); return; }
  res.json({ ...line, alerts: alertsFor({ route: line.id }), vehicles: vehicleSnapshot(line.id) });
});
app.get('/api/stations/:id', (req, res) => {
  const station = stationDetail(req.params.id);
  if (!station) { res.status(404).json({ error: 'unknown_station' }); return; }
  res.json({ ...station, arrivals: arrivalsAt(station.id), alerts: alertsFor({ station: station.id }) });
});
app.get('/api/vehicles', (req, res) => res.json(vehicleSnapshot(typeof req.query.route === 'string' ? req.query.route : undefined)));
app.get('/api/arrivals', (req, res) => {
  const station = typeof req.query.station === 'string' ? req.query.station : '';
  if (!station) { res.status(400).json({ error: 'station_required' }); return; }
  res.json(arrivalsAt(station));
});
app.get('/api/alerts', (req, res) => res.json(alertsFor({
  route: typeof req.query.route === 'string' ? req.query.route : undefined,
  station: typeof req.query.station === 'string' ? req.query.station : undefined,
})));
app.get('/api/realtime', (_req, res) => res.json(realtimeState()));

// Server-sent events: one stream per open map. The server pushes each fresh vehicles snapshot
// and an alerts-changed ping; the browser never polls MBTA.
let streams = 0;
app.get('/api/events', (req: Request, res: Response) => {
  if (streams >= 150) { res.status(503).json({ error: 'busy' }); return; }
  streams++;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('status', { mode: 'deltas-only', realtime: realtimeState() });
  send('vehicles', vehicleSnapshot());
  const onUpdate = (key: string) => {
    if (key === 'vehicles') send('vehicles', vehicleSnapshot());
    else if (key === 'alerts') send('alerts', { alerted: alertedRoutes() });
    else if (key === 'trip-updates') send('predictions', { at: Date.now() });
  };
  bus.on('update', onUpdate);
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
  req.on('close', () => { streams--; clearInterval(timer); bus.off('update', onUpdate); });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ---- the page --------------------------------------------------------------------------------
const webRoot = process.env.TRANSIT_WEB_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
let template = '';
try { template = readFileSync(path.join(webRoot, 'index.html'), 'utf8'); } catch { template = '<!doctype html><title>Charlie Maps</title><p>Build missing.</p>'; }

const ASSETS = 'https://go.fridge.run/assets';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The ONE fridge.run app bar (wiki dev:ux:outside-go), rendered on the server from Caddy's identity headers. */
function appbar(req: Request) {
  const user = req.get('x-fridge-user') ?? '';
  const name = req.get('x-fridge-name') || user;
  const owner = (req.get('x-fridge-groups') ?? '').split(/[\s,]+/).includes('owner');
  const chip = user ? `<span class="chip me-chip${owner ? ' owner' : ''}">${owner ? '👑' : '⭐'} ${esc(name)}</span>` : '';
  const signout = user ? '<a class="btn small signout" href="https://go.fridge.run/logout" title="Sign out">🚪<span class="lbl"> Sign out</span></a>' : '';
  return `<header class="appbar">
    <a class="brand" href="https://go.fridge.run/"><img src="${ASSETS}/logo-mark.png" srcset="${ASSETS}/logo-mark@2x.png 2x" width="42" height="48" alt=""><span><b class="app-name">Charlie Maps</b> <span class="house">· fridge.run</span></span></a>
    ${chip}
    <div class="me">
      <a class="back-btn" href="https://fridge.run/" title="Back to fridge.run"><picture><source type="image/webp" srcset="${ASSETS}/back-button.webp 1x, ${ASSETS}/back-button@2x.webp 2x"><img src="${ASSETS}/back-button.png" srcset="${ASSETS}/back-button@2x.png 2x" width="154" height="36" alt="Back to fridge.run"></picture></a>
      ${signout}
    </div>
  </header>`;
}

function page(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(template.replace('<!--fridge-bar-->', appbar(req)));
}

app.get(['/', '/index.html'], page);
app.use('/data', express.static(path.join(webRoot, 'data'), { maxAge: '10m' }));
app.use('/assets', express.static(path.join(webRoot, 'assets'), { immutable: true, maxAge: '365d' }));
app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
app.get('*', page); // deep links (?line=Red) and any client view
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

const server = app.listen(port, '0.0.0.0', () => console.log('Charlie Maps API on :' + port));
startRealtimeCollector();
async function close() {
  stopRealtimeCollector();
  server.close();
  await driver.close();
}
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
