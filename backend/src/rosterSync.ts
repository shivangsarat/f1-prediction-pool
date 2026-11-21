import {all, get, run, transaction} from './db.ts';
import {queryOpenF1} from './openf1.ts';

/** Normalized identity for one OpenF1 driver in a specific F1 season. */
export type RosterDriver = {
  id: string;
  name: string;
  code: string;
  teamId: string;
  teamName: string;
};

/** Sanitized, non-secret state returned to tournament members for a roster sync. */
export type RosterSyncResult = {
  status: 'ready' | 'unavailable' | 'manual' | 'retry-later';
  count: number;
  added: number;
  updated: number;
  sessionKey?: number;
  message?: string;
};

const SUCCESS_INTERVAL_MS = 6 * 60 * 60_000;
const FAILED_INTERVAL_MS = 30 * 60_000;
const FORCE_INTERVAL_MS = 60_000;
const pendingBySeason = new Map<string, Promise<RosterSyncResult>>();

/**
 * Normalize OpenF1's session drivers into validated IDs and team slugs.
 * Never use stale fallback identities or invented drivers for an unavailable year.
 */
export function normalizeOpenF1Roster(rows: unknown): RosterDriver[] {
  if (!Array.isArray(rows)) return [];
  const drivers = new Map<string, RosterDriver>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const number = Number(d.driver_number);
    if (!Number.isInteger(number) || number < 1 || number > 99) continue;
    const name = String(d.full_name ?? d.broadcast_name ?? '').trim();
    const teamName = String(d.team_name ?? '').trim();
    const code = String(d.name_acronym ?? number).trim().toUpperCase();
    const teamId = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!name || name.length > 100 || !teamName || teamName.length > 100 || !teamId || teamId.length > 64 || !/^[A-Z0-9]{1,12}$/.test(code)) continue;
    drivers.set(String(number), {id: String(number), name, code, teamId, teamName});
  }
  return [...drivers.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Prefer the most recent already-started session of the selected championship year.
 * Never borrow drivers from a future year or an upcoming session with no recorded lineup.
 */
export function recentRosterSessionKeys(sessions: unknown, year: number, nowMs = Date.now()): number[] {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((row: any) => row && (row.year == null || Number(row.year) === year) &&
      Number.isInteger(Number(row.session_key)) && Number(row.session_key) > 0 &&
      typeof row.date_start === 'string' && Number.isFinite(Date.parse(row.date_start)) &&
      Date.parse(row.date_start) <= nowMs)
    .sort((a: any, b: any) => Date.parse(b.date_start) - Date.parse(a.date_start))
    .map((row: any) => Number(row.session_key))
    .filter((key: number, i: number, keys: number[]) => keys.indexOf(key) === i)
    .slice(0, 3);
}

/**
 * Merge fresh identities without deleting anyone referenced by past predictions.
 * Existing driver/team IDs are preserved once ballots have been submitted.
 */
export function mergeSeasonRoster(seasonId: string, source: RosterDriver[], sessionKey: number): {added: number; updated: number; count: number} {
  if (source.length < 10) throw new Error('OpenF1 roster incomplete; need at least ten drivers');
  return transaction(() => {
    const submitted = !!get(`SELECT 1 FROM submissions p JOIN weekends w ON p.weekend_id=w.id
      WHERE w.season_id=? LIMIT 1`, seasonId);
    let added = 0;
    let updated = 0;
    for (const d of source) {
      const previous = get('SELECT id,name,code,team_id,team_name FROM roster WHERE season_id=? AND id=?', seasonId, d.id);
      if (!previous) {
        run('INSERT INTO roster(season_id,id,name,code,team_id,team_name) VALUES(?,?,?,?,?,?)',
          seasonId, d.id, d.name, d.code, d.teamId, d.teamName);
        added++;
      } else if (!submitted && (previous.name !== d.name || previous.code !== d.code ||
        previous.team_id !== d.teamId || previous.team_name !== d.teamName)) {
        run('UPDATE roster SET name=?,code=?,team_id=?,team_name=? WHERE season_id=? AND id=?',
          d.name, d.code, d.teamId, d.teamName, seasonId, d.id);
        updated++;
      }
    }
    const count = get('SELECT COUNT(*) AS n FROM roster WHERE season_id=?', seasonId)?.n ?? 0;
    run(`INSERT INTO season_roster_sync(season_id,last_checked_at,session_key,status,message)
      VALUES(?,?,?,?,NULL) ON CONFLICT(season_id) DO UPDATE SET
      last_checked_at=excluded.last_checked_at,session_key=excluded.session_key,status=excluded.status,message=NULL`,
      seasonId, new Date().toISOString(), sessionKey, 'ready');
    return {added, updated, count};
  });
}

/**
 * Mark a commissioner-authored roster as authoritative so automatic sync never
 * overwrites the decision. It still remains scoped to this season and tournament.
 */
export function markManualRoster(seasonId: string): void {
  run(`INSERT INTO season_roster_sync(season_id,last_checked_at,session_key,status,message)
    VALUES(?, ?,NULL,'manual',NULL) ON CONFLICT(season_id) DO UPDATE SET
    last_checked_at=excluded.last_checked_at,session_key=NULL,status='manual',message=NULL`,
    seasonId, new Date().toISOString());
}

/** Persist a bounded diagnostic after an upstream failure, throttling repeat calls. */
function recordRosterFailure(seasonId: string, message: string): void {
  run(`INSERT INTO season_roster_sync(season_id,last_checked_at,session_key,status,message)
    VALUES(?, ?,NULL,'unavailable',?) ON CONFLICT(season_id) DO UPDATE SET
    last_checked_at=excluded.last_checked_at,status='unavailable',message=excluded.message`,
    seasonId, new Date().toISOString(), message.slice(0,200));
}

/**
 * Load an OpenF1 season roster on the first authorized read, then periodically
 * refresh it for replacement drivers. A durable throttle and OpenF1's shared
 * endpoint cache prevent parallel tournament members from flooding the provider.
 * Missing or rate-limited upstream data never prevents read-only use of the app.
 */
export async function ensureSeasonRoster(seasonId: string, force = false): Promise<RosterSyncResult> {
  const pending = pendingBySeason.get(seasonId);
  if (pending) return pending;
  const promise = (async () => {
    const season = get('SELECT id,year FROM seasons WHERE id=?', seasonId);
    if (!season) return {status: 'unavailable',count: 0,added: 0,updated: 0,message: 'Season not found'} as RosterSyncResult;
    const count = get('SELECT COUNT(*) AS n FROM roster WHERE season_id=?', seasonId)?.n ?? 0;
    const state = get('SELECT * FROM season_roster_sync WHERE season_id=?', seasonId);
    if (state?.status === 'manual' || (count >= 10 && !state)) return {status: 'manual',count,added: 0,updated: 0} as RosterSyncResult;
    const elapsed = Date.now() - Date.parse(state?.last_checked_at ?? '1970-01-01T00:00:00Z');
    const interval = force ? FORCE_INTERVAL_MS : state?.status === 'ready' ? SUCCESS_INTERVAL_MS : FAILED_INTERVAL_MS;
    if (state && elapsed < interval) return {status: count >= 10 ? 'ready' : 'retry-later',count,added: 0,updated: 0,sessionKey:state.session_key ?? undefined,
      message: count >= 10 ? undefined : 'OpenF1 lineup unavailable; the next automatic check is scheduled.'} as RosterSyncResult;

    try {
      const now = Date.now();
      const sessions = await queryOpenF1('sessions', {year: Number(season.year)});
      const keys = recentRosterSessionKeys(sessions, Number(season.year), now);
      for (const key of keys) {
        const response = await queryOpenF1('drivers', {session_key: key});
        const drivers = normalizeOpenF1Roster(response);
        if (drivers.length < 10) continue;
        const {added, updated, count: finalCount} = mergeSeasonRoster(seasonId, drivers, key);
        return {status: 'ready', count: finalCount, added, updated, sessionKey: key} as RosterSyncResult;
      }
      recordRosterFailure(seasonId, 'No complete OpenF1 driver list for this F1 season yet');
      return {status: count >= 10 ? 'ready' : 'unavailable',count,added: 0,updated: 0,
        message: 'OpenF1 has not published a complete driver roster for this season yet.'} as RosterSyncResult;
    } catch (error) {
      // The database roster remains usable during an OpenF1 outage.
      recordRosterFailure(seasonId, 'OpenF1 temporarily unavailable');
      return {status: count >= 10 ? 'ready' : 'unavailable',count,added: 0,updated: 0,
        message: 'OpenF1 is temporarily unavailable. Existing picks and roster are unchanged.'} as RosterSyncResult;
    }
  })();
  pendingBySeason.set(seasonId, promise);
  try {return await promise;} finally {pendingBySeason.delete(seasonId);}
}

/** Return only the authorized season's currently usable roster. */
export function listSeasonRoster(seasonId: string): Record<string, unknown>[] {
  return all('SELECT * FROM roster WHERE season_id=? ORDER BY team_name,name', seasonId);
}
