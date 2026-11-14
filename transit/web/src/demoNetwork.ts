// DESIGN DATA ONLY. Absolutely not realtime, schedule, or route-planning data.
export type TransportMode = 'subway' | 'tram' | 'commuter' | 'bus';
export type DemoStop = { id: string; name: string; x: number; y: number; lat?: number; lon?: number };
export type DemoLine = { id: string; name: string; mode: TransportMode; color: string; stops: DemoStop[]; sampleVehicleProgress: number };
const S = (id: string, name: string, x: number, y: number, lat?: number, lon?: number): DemoStop =>
  ({ id, name, x, y, lat, lon });

export const demoLines: DemoLine[] = [
  {
    id: 'Blue', name: 'Blue Line', mode: 'subway', color: '#1668ce', sampleVehicleProgress: 0.44,
    stops: [
      S('wonderland','Wonderland',95,215), S('revere','Revere Beach',165,245),
      S('suffolk','Suffolk Downs',230,275,42.3900,-70.9970), S('airport','Airport',310,315),
      S('maverick','Maverick',405,343), S('state','State',490,367),
      S('gov','Government Center',560,387,42.3596,-71.0590), S('bowdoin','Bowdoin',638,390)
    ]
  },
  {
    id: 'Orange', name: 'Orange Line', mode: 'subway', color: '#ef8500', sampleVehicleProgress: 0.68,
    stops: [
      S('oak','Oak Grove',530,66), S('sullivan','Sullivan Square',535,169),
      S('north','North Station',548,260,42.3656,-71.0613),
      S('state','State',490,367), S('dtx','Downtown Crossing',482,426),
      S('backbay','Back Bay',470,516), S('forest','Forest Hills',470,617)
    ]
  },
  {
    id: 'Red', name: 'Red Line', mode: 'subway', color: '#d62531', sampleVehicleProgress: 0.39,
    stops: [
      S('alewife','Alewife',198,68), S('harvard','Harvard',251,181,42.3734,-71.1189),
      S('kendall','Kendall/MIT',336,319), S('park','Park Street',440,406),
      S('dtx','Downtown Crossing',482,426),
      S('south','South Station',573,472), S('jfk','JFK/UMass',650,552),
      S('ashmont','Ashmont',732,637)
    ]
  },
  {
    id: 'Green', name: 'Green Line (sample trunk)', mode: 'tram', color: '#138248', sampleVehicleProgress: 0.58,
    stops: [
      S('bc','Boston College',92,561), S('kenmore','Kenmore',249,502),
      S('copley','Copley',349,467), S('park','Park Street',440,406),
      S('gov','Government Center',560,387),
      S('north','North Station',548,260), S('medford','Medford/Tufts',673,134)
    ]
  },
  {
    id: 'CR-Newburyport', name: 'Commuter Rail · Newburyport/Rockport sample', mode: 'commuter',
    color: '#81358c', sampleVehicleProgress: 0.37,
    stops: [
      S('north','North Station',548,260), S('chelsea','Chelsea',700,270),
      S('lynn','Lynn',790,248), S('salem','Salem',872,219),
      S('beverly','Beverly',955,181), S('rockport','Rockport',1030,109)
    ]
  },
  {
    id: 'CR-Lowell', name: 'Commuter Rail · Lowell sample', mode: 'commuter',
    color: '#81358c', sampleVehicleProgress: 0.20,
    stops: [
      S('north','North Station',548,260), S('anderson','Anderson/Woburn',716,164),
      S('lowell','Lowell',807,76)
    ]
  },
  {
    id: 'Bus-111', name: 'Bus 111 (illustrative)', mode: 'bus',
    color: '#49515a', sampleVehicleProgress: 0.67,
    stops: [
      S('haymarket','Haymarket',517,316), S('citysq','City Square',613,335),
      S('chelsea','Chelsea',700,270), S('broadway','Broadway',794,350),
      S('woodlawn','Woodlawn',875,407)
    ]
  }
];
export function demoConnections(stopId: string): DemoLine[] {
  return demoLines.filter(line => line.stops.some(stop => stop.id === stopId));
}
export function demoTripMinutes(line: DemoLine, fromId: string, toId: string): number | null {
  const a = line.stops.findIndex(s => s.id === fromId);
  const b = line.stops.findIndex(s => s.id === toId);
  if (a < 0 || b < 0) return null;
  return Math.abs(b-a) * (line.mode === 'commuter' ? 8 : line.mode === 'bus' ? 5 : 3);
}
export function pointOnLine(line: DemoLine, progress: number) {
  const seg = Math.max(0, Math.min(0.999, progress)) * (line.stops.length - 1);
  const i = Math.floor(seg), t = seg - i, a = line.stops[i], b = line.stops[i+1];
  return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t };
}
