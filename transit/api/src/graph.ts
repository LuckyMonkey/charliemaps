import neo4j, { Driver } from 'neo4j-driver';

const uri = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const user = process.env.NEO4J_USER ?? 'neo4j';
const password = process.env.NEO4J_PASSWORD ?? '';
export const driver: Driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
  maxConnectionPoolSize: 8,
  connectionAcquisitionTimeout: 5000,
  maxTransactionRetryTime: 3000,
});
export async function graphReady(): Promise<boolean> {
  try { await driver.verifyConnectivity(); return true; } catch { return false; }
}
export type PublicLine = {
  id: string; name: string; color: string; mode: string;
  stops: { id: string; name: string; lat: number | null; lon: number | null }[];
};
export async function getNetworkProjection(): Promise<PublicLine[]> {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    // Only graph-backed data is returned. No demo records are written to Neo4j.
    const r = await session.executeRead(tx => tx.run(`
      MATCH (r:Route)-[:SERVES]->(s:Stop)
      WITH r, s ORDER BY r.id, s.name
      RETURN r.id AS id, coalesce(r.longName, r.shortName, r.id) AS name,
             coalesce(r.color, '616161') AS color,
             coalesce(r.mode, 'unknown') AS mode,
             collect({id:s.id, name:s.name, lat:s.lat, lon:s.lon}) AS stops
      ORDER BY name LIMIT 2000
    `));
    return r.records.map(rec => ({
      id: String(rec.get('id')), name: String(rec.get('name')),
      color: String(rec.get('color')), mode: String(rec.get('mode')),
      stops: rec.get('stops').map((s: {id: string; name: string; lat: number | null; lon: number | null}) =>
        ({ id: String(s.id), name: String(s.name), lat: s.lat ?? null, lon: s.lon ?? null })),
    }));
  } finally {
    await session.close();
  }
}
