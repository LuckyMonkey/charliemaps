import express, { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driver, graphReady, getNetworkProjection } from './graph.js';
import { realtimeState, startRealtimeCollector, stopRealtimeCollector } from './realtime.js';
import { readScheduleSnapshot } from './schedule.js';

const app = express();
app.disable('x-powered-by');
const port = Number(process.env.PORT || 4100);

app.get('/api/health', async (_req: Request, res: Response) => {
  const ready = await graphReady();
  res.status(ready ? 200 : 503).json({
    service: 'charlie-maps', status: ready ? 'ready' : 'graph_unavailable',
    graph: 'neo4j', mode: 'schedule-first', realtime: realtimeState(), now: new Date().toISOString(),
  });
});

app.get('/api/network', async (_req: Request, res: Response) => {
  try {
    const schedule = await readScheduleSnapshot();
    const graph = await graphReady();
    res.json({
      mode: 'schedule', source: schedule.source, generatedAt: schedule.generatedAt,
      routes: schedule.routes, stations: schedule.stations,
      graph: graph ? 'available' : 'unavailable', updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('schedule projection failed', err);
    res.status(500).json({ mode: 'error', routes: [], stations: [], updatedAt: null });
  }
});

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: status\ndata: ${JSON.stringify({ mode: 'deltas-only', live: false, realtime: realtimeState() })}\n\n`);
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => clearInterval(timer));
});

app.get('/api/realtime', (_req: Request, res: Response) => res.json(realtimeState()));

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
app.use(express.static(webRoot));
app.get('*', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
const server = app.listen(port, '0.0.0.0', () => console.log('Charlie Maps API on :' + port));
async function close() {
  server.close();
  await driver.close();
}
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
startRealtimeCollector();
process.once('SIGTERM', stopRealtimeCollector);
process.once('SIGINT', stopRealtimeCollector);
