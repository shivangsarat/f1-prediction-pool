/** OpenF1 is a data supplier, NOT the official FIA authority. Never auto-publish. */
import {HttpError} from './auth.ts';
import {get, run} from './db.ts';
const BASE = 'https://api.openf1.org/v1';
let nextAllowed = 0;
const inFlight = new Map<string, Promise<any[]>>();

/** Normalize OpenF1 parameters to a stable global cache key shared by parallel tournaments. */
export function cacheKey(endpoint: string, params: Record<string, string | number>): string {
  return `${endpoint}:${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
}

/** Set safe cache lifetimes; changing result classifications are refreshed more often than calendars. */
export function cacheLifetime(endpoint: string): number {
  if (endpoint === 'sessions' || endpoint === 'meetings') return 15 * 60_000;
  if (endpoint === 'drivers') return 60 * 60_000;
  return 90_000;
}

/**
 * Request OpenF1 once per unique endpoint and parameter set, sharing both concurrent
 * and recent responses across tournaments using persisted SQLite cache entries.
 */
export async function queryOpenF1(endpoint: string, params: Record<string, string | number>): Promise<any[]> {
  if (!/^[a-z_]+$/.test(endpoint)) throw new HttpError(400, 'Invalid OpenF1 endpoint');
  const key = cacheKey(endpoint, params);
  const at = new Date().toISOString();
  const cached = get('SELECT content FROM openf1_cache WHERE cache_key=? AND expires_at>?', key, at);
  if (cached) return JSON.parse(cached.content);
  const pending = inFlight.get(key);
  if (pending) return pending;

  /** Serialize upstream requests while retaining independent tournament DB records. */
  const request = (async () => {
    const url = new URL(`${BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const scheduled = Math.max(Date.now(), nextAllowed);
    nextAllowed = scheduled + 2100;
    const pause = scheduled - Date.now();
    if (pause) await new Promise(resolve => setTimeout(resolve, pause));
    const response = await fetch(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new HttpError(502, `OpenF1 ${endpoint}: HTTP ${response.status}; try manual import or retry later`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new HttpError(502, 'Unexpected OpenF1 response');
    const content = JSON.stringify(data);
    // Avoid unbounded database growth from abnormally large upstream session results.
    if (Buffer.byteLength(content, 'utf8') <= 6 * 1024 * 1024) {
      const now = new Date();
      run(`INSERT INTO openf1_cache(cache_key,endpoint,content,updated_at,expires_at)
        VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at,expires_at=excluded.expires_at`,
        key, endpoint, content, now.toISOString(), new Date(now.getTime() + cacheLifetime(endpoint)).toISOString());
    }
    return data;
  })();
  inFlight.set(key, request);
  try {return await request;} finally {inFlight.delete(key);}
}

/**
 * Translate OpenF1 session timing into championship weekend candidates.
 * @param rows - Input to this operation.
 * @param meetings - Input to this operation.
 */
export function calendarFromSessions(rows: any[], meetings: any[]) {

  const names = new Map(meetings.map(m => [m.meeting_key, m.meeting_name ?? m.location ?? 'Grand Prix']));
  const grouped = new Map<number, any[]>();
  for (const s of rows) {
    if (!grouped.has(s.meeting_key)) grouped.set(s.meeting_key, []);
    grouped.get(s.meeting_key)!.push(s)
  }
  const events: any[] = [];
  for (const [key, sessions] of grouped) {

    /**
     * Choose the best matching official event from available session records.
     * @param patterns - Input to this operation.
     */
    const pick = (...patterns: string[]) => sessions.find(s => patterns.some(p => String(s.session_name ?? s.session_type ?? '').toLowerCase() === p));
    const race = pick('race');
    const qualifying = pick('qualifying');
    if (!race || !qualifying) continue;
    const sprintQual = pick('sprint qualifying', 'sprint shootout'), sprint = pick('sprint');
    events.push({name: names.get(key), meetingKey: key, qualifyingAt: qualifying.date_start, raceAt: race.date_start, sprintQualifyingAt: sprintQual?.date_start ?? null, isSprint: !!sprint, openf1Keys: {race: race.session_key, qualifying: qualifying.session_key, sprint: sprint?.session_key, sprintQualifying: sprintQual?.session_key}})
  }
  return events.filter(e => e.qualifyingAt && e.raceAt && (!e.isSprint || e.sprintQualifyingAt)).sort((a, b) => Date.parse(a.raceAt) - Date.parse(b.raceAt)).map((e, i) => ({...e, round: i + 1}));
}
/**
 * Choose the fastest eligible race lap from session records.
 * @param laps - Input to this operation.
 * @param classified - Input to this operation.
 */
function lapFastest(laps: any[], classified: Set<string>): string | null {

  const eligible = laps.filter(l => classified.has(String(l.driver_number)) && typeof l.lap_duration === 'number' && l.lap_duration > 0);
  eligible.sort((a, b) => a.lap_duration - b.lap_duration);
  return eligible.length ? String(eligible[0].driver_number) : null;
}
/**
 * Collect provisional OpenF1 classifications and highlight fields requiring FIA verification.
 * @param keys - Input to this operation.
 * @param isSprint - Input to this operation.
 */
export async function fetchDraft(keys: any, isSprint: boolean) {

  if (!keys.race || !keys.qualifying) throw new HttpError(400, 'Missing OpenF1 session keys');
  const race = await queryOpenF1('session_result', {session_key: keys.race});
  const quali = await queryOpenF1('session_result', {session_key: keys.qualifying});
  if (race.length < 10 || quali.length < 10) throw new HttpError(502, 'Session classifications are not available yet');
  const laps = await queryOpenF1('laps', {session_key: keys.race});
  const finishers = race.map(r => ({driverId: String(r.driver_number), position: Number.isInteger(r.position) ? r.position : null, status: r.dns ? 'DNS' : r.dsq ? 'DSQ' : r.dnf ? 'NC' : 'CLASSIFIED'}));
  const classified = new Set(finishers.filter(r => r.status === 'CLASSIFIED').map(r => r.driverId));
  const q3 = quali.filter(q => Array.isArray(q.duration) && typeof q.duration[2] === 'number').sort((a, b) => a.duration[2] - b.duration[2]);
  const poleId = q3[0] ? String(q3[0].driver_number) : null;
  // First DNF and sprint tie categories need authoritative manual verification.
  let sprint: any = null;
  if (isSprint && keys.sprint) {

    const sprintRes = await queryOpenF1('session_result', {session_key: keys.sprint});
    const sprintGrid = await queryOpenF1('starting_grid', {session_key: keys.sprint});
    const first = sprintRes.find(x => x.position === 1);
    const pts = [8, 7, 6, 5, 4, 3, 2, 1];
    const drivers = await queryOpenF1('drivers', {session_key: keys.sprint});
    const team = new Map(drivers.map(d => [String(d.driver_number), String(d.team_name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]));
    const teamPoints = new Map<string, number>();
    sprintRes.forEach(r => {
      const t = team.get(String(r.driver_number)) ?? '';
      if (t && r.position >= 1 && r.position <= 8) teamPoints.set(t, (teamPoints.get(t) ?? 0) + pts[r.position - 1])
    });
    const maximum = Math.max(0, ...teamPoints.values());
    const startPositions = new Map(sprintGrid.map(g => [String(g.driver_number), g.position]));
    const gains = sprintRes.filter(r => !r.dnf && !r.dns && !r.dsq && r.position > 0).map(r => ({driverId: String(r.driver_number), gain: (startPositions.get(String(r.driver_number)) ?? 20) - r.position}));
    const best = Math.max(0, ...gains.map(v => v.gain));
    sprint = {winnerId: first ? String(first.driver_number) : null, topTeams: [...teamPoints].filter(([, v]) => v === maximum).map(([k]) => k), topGainers: gains.filter(g => g.gain === best).map(g => g.driverId)};
  }
  return {draft: {finishers, poleId, fastestLapId: lapFastest(laps, classified), firstDnfIds: [], sprint, greenFlagLaps: 0, cancelled: false}, needsReview: ['Verify FIA Pole Award (grid penalties)', 'Set first DNF winners / Lap-1 ties using FIA race classification', 'Set official green-flag laps and cancellation status', 'Confirm fastest official race lap', 'Review sprint starting grid pit-lane starts and tied sprint results']};
}
