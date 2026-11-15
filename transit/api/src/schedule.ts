import { readFile } from 'node:fs/promises';

const snapshotPath = '/app/web/dist/data/network.json';

export type ScheduleSnapshot = {
  source: string;
  generatedAt: string;
  routes: unknown[];
  stations: unknown[];
};

export async function readScheduleSnapshot(): Promise<ScheduleSnapshot> {
  return JSON.parse(await readFile(snapshotPath, 'utf8')) as ScheduleSnapshot;
}
