import express, { Request, Response } from 'express';
import { driver, graphReady, getNetworkProjection } from './graph.js';

const app = express();
app.disable('x-powered-by');
const port = Number(process.env.PORT || 4100);

app.get('/api/health', async (_req: Request, res: Response) => {
  const ready = await graphReady();
  res.status(ready ? 200 : 503).json({
    service: 'charlie-maps', status: ready ? 'ready' : 'graph_unavailable',
    graph: 'neo4j', mode: 'scaffold', now: new Date().toISOString(),
  });
});

app.get('/api/network', async (_req: Request, res: Response) => {
  if (!(await graphReady())) {
    res.status(503).json({ mode: 'unavailable', lines: [], updatedAt: null });
    return;
  }
  try {
    const lines = await getNetworkProjection();
    // If not imported, this should stay empty. UI owns the explicitly labeled demo.
    res.json({ mode: lines.length ? 'graph' : 'uninitialized', lines, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('network projection failed', err);
    res.status(500).json({ mode: 'error', lines: [], updatedAt: null });
  }
});

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: status\\ndata: {"mode":"scaffold","live":false}\\n\\n');
  const timer = setInterval(() => res.write(': heartbeat\\n\\n'), 25000);
  req.on('close', () => clearInterval(timer));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
const server = app.listen(port, '0.0.0.0', () => console.log('Charlie Maps API on :' + port));
async function close() {
  server.close();
  await driver.close();
}
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
