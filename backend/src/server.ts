import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {randomUUID, createHash} from 'node:crypto';
import {get, all, run, transaction, dbPath, db} from './db.ts';
import {createBackup} from './backups.ts';
import {HttpError, bad, register, login, logout, auth, setSessionCookie, clearSessionCookie, type User} from './auth.ts';
import {readJson, assertSameOrigin, securityHeaders, sendJson, writeAudit, clientIp} from './http.ts';
import {listTournaments, publicCatalogue, invitePreview, requireTournament, requireCommissioner, requireSeasonMember, requireSeasonCommissioner, createTournament, joinTournament, joinPublicTournament, rotateInvite, amendTournament, searchUsers, inviteExistingUser, myInvitations, respondInvitation} from './tournaments.ts';
import {queryOpenF1, calendarFromSessions, fetchDraft} from './openf1.ts';
import {queueNotification, requestEmailVerification, confirmEmail, mailProvider, mailStatus, drainEmailOutbox, reconcileDeadlineEmails, publicUrl} from './email.ts';
import {utcNow, locked, formDeadline, validateGp, validateSprint, validateUnified, validateResult, scoreBallot, payoutPlan, rankWithTies, validId, type GPClassification, type FormKind, type ScoreInput, type RankingRow, type SprintMode} from './rules.ts';

// A production instance must be able to make encrypted backups before accepting payments or picks.
if (process.env.NODE_ENV === 'production' && !/^[a-fA-F0-9]{64}$/.test(process.env.BACKUP_ENCRYPTION_KEY ?? '')) {

  throw new Error('BACKUP_ENCRYPTION_KEY is required to start the API in production (64 hex characters).');
}

/** Produce a unique identifier for an immutable database record. */
const id = () => randomUUID();
/** Read the server's authoritative UTC timestamp for locks and audit records. */
const now = () => utcNow();
/** Serialize a validated payload before it is written to persistent storage. */
const toJSON = (x: any) => JSON.stringify(x);
/**
 * Parse a trusted JSON string persisted in the SQLite database.
 * @param x - Input to this operation.
 */
const parse = (x: string) => JSON.parse(x);
/**
 * Validate an input timestamp with an explicit timezone and normalize to UTC.
 * @param x - Input to this operation.
 * @param label - Input to this operation.
 */
const asUTC = (x: any, label: string): string => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x) || !/(Z|[+-]\d\d:\d\d)$/.test(x) || !Number.isFinite(Date.parse(x))) throw bad(`${label} must include an explicit UTC offset`);
  return new Date(x).toISOString()
};
/**
 * Require a bounded integer for money, round numbers, and configuration values.
 * @param x - Input to this operation.
 * @param min - Input to this operation.
 * @param max - Input to this operation.
 */
const int = (x: any, min = 0, max = 1_000_000) => {
  if (!Number.isInteger(x) || x < min || x > max) throw bad(`Expected integer between ${min} and ${max}`);
  return x
};
/**
 * Compute a SHA-256 digest for deterministic score-preview fingerprints.
 * @param text - Input to this operation.
 */
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const reply = sendJson;
const audit = writeAudit;
const body = readJson;
/**
 * Find the requested season and verify membership when a user is supplied.
 * @param id - Input to this operation.
 * @param user - The currently authenticated participant.
 */
function season(id: string, user?: User) {
  return user ? requireSeasonMember(user, id) : get('SELECT * FROM seasons WHERE id=?', id) ?? (() => {
    throw new HttpError(404, 'Season not found')
  })()
}
/**
 * Find a weekend, joined with season configuration, and enforce tournament membership.
 * @param id - Input to this operation.
 * @param user - The currently authenticated participant.
 */
function weekend(id: string, user?: User) {
  const v = get('SELECT w.*,s.tournament_id,s.sprint_mode,s.preseason_lock,s.salvage_start,s.salvage_end,s.year FROM weekends w JOIN seasons s ON s.id=w.season_id WHERE w.id=?', id);
  if (!v) throw new HttpError(404, 'Weekend not found');
  if (user) requireTournament(user, v.tournament_id);
  return v
}
/**
 * Determine which of a weekend’s deadlines applies to a ballot form.
 * @param w - Input to this operation.
 * @param form - Input to this operation.
 */
function formLock(w: any, form: FormKind) {
  if (!['gp', 'sprint', 'unified'].includes(form)) throw bad('Invalid form');
  return formDeadline({isSprint: !!w.is_sprint, qualifyingAt: w.qualifying_at, sprintQualifyingAt: w.sprint_qualifying_at}, w.sprint_mode, form)
}
/**
 * Freeze season settings after the first qualifying deadline.
 * @param s - Input to this operation.
 */
function seasonIsLocked(s: any): boolean {
  const w = get('SELECT * FROM weekends WHERE season_id=? ORDER BY round LIMIT 1', s.id);
  return !!w && locked(w.is_sprint ? w.sprint_qualifying_at : w.qualifying_at)
}
/**
 * Validate form shape and verify every driver/team against the season roster.
 * @param w - Input to this operation.
 * @param form - Input to this operation.
 * @param payload - Input to this operation.
 */
function validateForm(w: any, form: FormKind, payload: any) {

  formLock(w, form);
  if (form === 'gp') validateGp(payload); else if (form === 'sprint') validateSprint(payload); else validateUnified(payload);
  const roster = all('SELECT id,team_id FROM roster WHERE season_id=?', w.season_id);
  const ids = new Set(roster.map(r => r.id)), teams = new Set(roster.map(r => r.team_id));
  if (!ids.size) throw bad('The commissioner must configure drivers first');
  /**
 * Reject a driver identifier not present in the configured tournament roster.
 * @param v - Input to this operation.
 */
  const requireDriver = (v: string) => {
    if (!ids.has(v)) throw bad(`Unknown driver ID ${v}`)
  };
  if (form !== 'sprint') {
    for (const v of payload.top10) requireDriver(v);
    for (const v of Object.values(payload.props)) requireDriver(String(v))
  }
  if (form !== 'gp') {
    const p = form === 'sprint' ? payload.props : payload.sprint;
    requireDriver(p.winner);
    requireDriver(p.mostGained);
    if (!teams.has(p.teamMostPoints)) throw bad('Unknown team ID')
  }
}
/**
 * Return the latest immutable revision of each ballot for a weekend.
 * @param wId - Input to this operation.
 * @param userId - Input to this operation.
 */
function latestSubmissions(wId: string, userId?: string): any[] {

  const rows = all(`SELECT p.* FROM submissions p WHERE p.weekend_id=? ${userId ? 'AND p.user_id=?' : ''}
 AND p.version=(SELECT MAX(q.version) FROM submissions q WHERE q.weekend_id=p.weekend_id AND q.user_id=p.user_id AND q.form=p.form)`, ...(userId ? [wId, userId] : [wId]));
  return rows.map(r => ({...r, payload: parse(r.payload)}))
}
/**
 * Append a deadline-checked ballot revision and its audit entry atomically.
 * @param w - Input to this operation.
 * @param uId - Input to this operation.
 * @param form - Input to this operation.
 * @param payload - Input to this operation.
 * @param submittedAt - Input to this operation.
 * @param source - Input to this operation.
 * @param note - Input to this operation.
 */
function insertSubmission(w: any, uId: string, form: FormKind, payload: any, submittedAt: string, source = 'web', note = '') {

  validateForm(w, form, payload);
  if (locked(formLock(w, form), new Date(submittedAt))) throw new HttpError(409, 'Form deadline passed. Picks are immutable after lock');
  const latest = get('SELECT MAX(version) AS v FROM submissions WHERE user_id=? AND weekend_id=? AND form=?', uId, w.id, form);
  const version = (latest?.v ?? 0) + 1;
  run('INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?)', id(), uId, w.id, form, toJSON(payload), version, submittedAt, source, note);
  audit(uId, 'submission.revision', w.id, note, {form, version, source, submittedAt});
  return {version, submittedAt};
}
/**
 * Load the latest provisional or published race classification.
 * @param wId - Input to this operation.
 */
function currentResult(wId: string) {
  const r = get('SELECT * FROM results WHERE weekend_id=?', wId);
  return r ? {...r, payload: parse(r.payload)} : null
}
/**
 * Read the latest published result version for each participant.
 * @param wId - Input to this operation.
 */
function latestScores(wId: string) {
  return all(`SELECT s.* FROM score_snapshots s WHERE s.weekend_id=? AND s.result_version=(SELECT MAX(t.result_version) FROM score_snapshots t WHERE t.weekend_id=s.weekend_id AND t.user_id=s.user_id)`, wId)
}
/**
 * Compute tournament-member scores from the reviewed classification and latest ballots.
 * @param w - Input to this operation.
 * @param result - Input to this operation.
 */
function computeScores(w: any, result: GPClassification) {

  const submissions = latestSubmissions(w.id);
  const users = all('SELECT u.id,u.display_name FROM users u JOIN tournament_members m ON m.user_id=u.id WHERE m.tournament_id=?', w.tournament_id);
  return users.map(u => {

    const own = submissions.filter(s => s.user_id === u.id), forms: Record<string, unknown> = Object.fromEntries(own.map(s => [s.form, s.payload]));
    const details = scoreBallot(forms as ScoreInput, result, w.sprint_mode, !!w.is_sprint);
    return {userId: u.id, displayName: u.display_name, ...details};
  });
}
/**
 * Fingerprint a reviewed result and submissions to prevent stale publication.
 * @param w - Input to this operation.
 * @param result - Input to this operation.
 */
function resultDigest(w: any, result: GPClassification) {
  const picks = latestSubmissions(w.id).map(p => [p.user_id, p.form, p.version, p.payload]);
  return hash(toJSON({result, picks}));
}
/**
 * Find the latest championship selection for a member and category.
 * @param seasonId - Input to this operation.
 * @param userId - Input to this operation.
 * @param category - Input to this operation.
 * @param phase - Input to this operation.
 */
function preSeasonPick(seasonId: string, userId: string, category: string, phase?: string) {
  return get(`SELECT * FROM champion_picks WHERE season_id=? AND user_id=? AND category=? ${phase ? 'AND phase=?' : ''} ORDER BY version DESC LIMIT 1`, ...(phase ? [seasonId, userId, category, phase] : [seasonId, userId, category]))
}
/**
 * Compute each tournament member’s net season buy-in and refunds.
 * @param seasonId - Input to this operation.
 */
function memberContributions(seasonId: string) {

  return all(`SELECT u.id as userId,u.display_name as name,
 COALESCE(SUM(CASE WHEN l.type IN ('buyin','refund') THEN l.amount_cents ELSE 0 END),0) AS contributionCents
 FROM users u JOIN tournament_members m ON m.user_id=u.id AND m.tournament_id=(SELECT tournament_id FROM seasons WHERE id=?) LEFT JOIN ledger l ON l.user_id=u.id AND l.season_id=? GROUP BY u.id`, seasonId, seasonId)
}
/**
 * Summarize the append-only financial ledger using integer cents.
 * @param seasonId - Input to this operation.
 */
function ledgerSummary(seasonId: string) {
  const rows = all('SELECT * FROM ledger WHERE season_id=? ORDER BY created_at DESC', seasonId);
  const cash = rows.reduce((n, r) => n + r.amount_cents, 0);
  const gross = rows.filter(r => r.amount_cents > 0).reduce((n, r) => n + r.amount_cents, 0);
  return {entries: rows, cashCents: cash, totalInflowsCents: gross};
}
/**
 * Combine race points, summer salvage penalties, and championship bonuses per member.
 * @param seasonId - Input to this operation.
 */
function standingRows(seasonId: string): Array<RankingRow & {name: string; salvagePenalty: number; championshipPoints: number}> {

  const tid = season(seasonId).tournament_id;
  const users = all('SELECT u.id,u.display_name FROM users u JOIN tournament_members m ON m.user_id=u.id WHERE m.tournament_id=?', tid);
  const raceRows = all(`SELECT sc.* FROM score_snapshots sc JOIN weekends w ON w.id=sc.weekend_id
 WHERE w.season_id=? AND sc.result_version=(SELECT MAX(v.result_version) FROM score_snapshots v WHERE v.weekend_id=sc.weekend_id AND v.user_id=sc.user_id)`, seasonId);
  const s = season(seasonId), champ = get('SELECT * FROM champions WHERE season_id=?', seasonId);
  return users.map(u => {

    const scores = raceRows.filter(r => r.user_id === u.id), base = scores.reduce((t, r) => t + r.points, 0);
    let penalty = 0, champPts = 0;
    for (const cat of ['wdc', 'wcc']) {

      const orig = preSeasonPick(seasonId, u.id, cat, 'preseason'), latest = preSeasonPick(seasonId, u.id, cat);
      const changed = !!(orig && latest && orig.choice !== latest.choice && latest.phase === 'salvage');
      if (changed && locked(s.salvage_end)) penalty -= 15;
      if (champ && latest?.choice === champ[cat]) champPts += 25;
    }
    return {userId: u.id, name: u.display_name, total: base + penalty + champPts, exactPodiums: scores.reduce((t, r) => t + r.exact_podiums, 0), exactTop10: scores.reduce((t, r) => t + r.exact_top10, 0), propPoints: scores.reduce((t, r) => t + r.prop_points, 0), bestWeek: Math.max(0, ...scores.map(r => r.points)), salvagePenalty: penalty, championshipPoints: champPts};
  });
}
/**
 * Evaluate adaptive payout tiers against the actual collected cash balance.
 * @param s - Input to this operation.
 */
function payoutSnapshot(s: any) {

  const standings = standingRows(s.id), members = memberContributions(s.id), ledger = ledgerSummary(s.id);
  const plan = payoutPlan(standings, members, ledger.cashCents, s.base_entry_cents, {smallMax: s.small_max, mediumMax: s.medium_max});
  return {...plan, currency: s.currency, participants: members.filter(m => m.contributionCents > 0).length};
}
/**
 * Present a safe, derived weekend record with live server-side lock status.
 * @param w - Input to this operation.
 */
function sanitizeW(w: any) {
  return {...w, is_sprint: !!w.is_sprint, openf1_keys: parse(w.openf1_keys), qualifyingLocked: locked(w.qualifying_at), sprintLocked: w.sprint_qualifying_at ? locked(w.sprint_qualifying_at) : false}
}
/**
 * Block publication until official classification or the 24-hour contingency.
 * @param w - Input to this operation.
 * @param r - Input to this operation.
 */
function ensureResultPublishable(w: any, r: any) {
  validateResult(r.payload, !!w.is_sprint);
  if (!locked(w.qualifying_at)) throw new HttpError(409, 'Cannot publish before qualifying lock');
  if (!r.final_classification && !(w.chequered_at && locked(new Date(Date.parse(w.chequered_at) + 86400000).toISOString()))) throw new HttpError(409, 'Publication requires FIA final classification or 24h after the chequered flag');
}

/** Isolate notification failures from authoritative tournament, scoring and ledger transactions. */
function notifySafely(userId: string, eventKey: string, tournamentId: string | null, subject: string, message: string): void {
  try {queueNotification(userId, eventKey, tournamentId, subject, message);}
  catch (error) {console.error('[NOTIFICATION QUEUE]', (error as Error).message);}
}

/** Email a new participant and current commissioners without exposing other participants' addresses. */
function notifyJoined(user: User, tournament: any): void {
  notifySafely(user.id, `joined:${tournament.id}:${user.id}`, tournament.id,
    `You joined ${tournament.name}`, `Your tournament is ready:\n${publicUrl()}/?tournament=${tournament.id}`);
  const commissioners = all("SELECT user_id FROM tournament_members WHERE tournament_id=? AND role='commissioner'", tournament.id);
  for (const commissioner of commissioners) {
    if (commissioner.user_id === user.id) continue;
    notifySafely(commissioner.user_id, `member-joined:${tournament.id}:${user.id}:${commissioner.user_id}`, tournament.id,
      `New entrant in ${tournament.name}`, `${user.display_name} (@${user.username}) joined your tournament.\n${publicUrl()}/?tournament=${tournament.id}`);
  }
}

/**
 * Authorize and dispatch requests for the correct participant/tournament resource.
 * @param req - Input to this operation.
 * @param res - Input to this operation.
 * @param url - Input to this operation.
 */
async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {

  const method = req.method ?? 'GET', p = url.pathname, parts = p.split('/').filter(Boolean);
  if (method === 'GET' && p === '/api/health') return reply(res, 200, {status: 'ok', serverTime: now(), database: 'sqlite-wal'});
  if (method === 'GET' && p === '/api/auth/verify-email') {
    const code = url.searchParams.get('token') ?? '';
    const verified = confirmEmail(code);
    return reply(res, verified ? 200 : 400, {verified});
  }
  if (method === 'GET' && p === '/api/email/capabilities') return reply(res, 200, {available: mailProvider() !== 'none'});
  if (method === 'GET' && p === '/api/catalogue') return reply(res, 200, publicCatalogue(url.searchParams.get('q') ?? ''));
  if (method === 'GET' && parts[1] === 'invite-preview' && parts.length === 3) return reply(res, 200, invitePreview(parts[2]));
  if (method === 'POST' && p === '/api/auth/register') {
    const key = `register:${clientIp(req)}`;
    const {rateLimit, recordFailedAttempt} = await import('./auth.ts');
    rateLimit(key, 20, 60);
    recordFailedAttempt(key);
    const b = await body(req), result = register(b.email as string, b.name as string, b.password as string, b.bootstrapKey as string, b.username as string);
    setSessionCookie(res, result.token);
    if (mailProvider() !== 'none') {
      try {requestEmailVerification(result.user);} catch (error) {console.error('[VERIFICATION QUEUE]', (error as Error).message);}
    }
    return reply(res, 201, {user: result.user, expiresAt: result.expiresAt})
  }
  if (method === 'POST' && p === '/api/auth/login') {
    const b = await body(req), result = login(b.email as string, b.password as string, clientIp(req));
    setSessionCookie(res, result.token);
    return reply(res, 200, {user: result.user, expiresAt: result.expiresAt})
  }
  const user = auth(req);
  if (method === 'GET' && p === '/api/auth/me') return reply(res, 200, {...user, emailVerified: !!get('SELECT email_verified_at FROM users WHERE id=?', user.id)?.email_verified_at, notificationOptIn: !!get('SELECT notification_opt_in FROM users WHERE id=?', user.id)?.notification_opt_in});
  if (method === 'POST' && p === '/api/account/verification-email') {
    requestEmailVerification(user);
    return reply(res, 202, {queued: mailProvider() !== 'none'});
  }
  if (method === 'PATCH' && p === '/api/account/notifications') {
    const b = await body(req);
    if (typeof b.enabled !== 'boolean') throw bad('enabled must be boolean');
    run('UPDATE users SET notification_opt_in=? WHERE id=?', b.enabled ? 1 : 0, user.id);
    return reply(res, 200, {enabled: b.enabled});
  }
  if (method === 'POST' && p === '/api/auth/logout') {
    logout(req);
    clearSessionCookie(res);
    return reply(res, 200, {ok: true})
  }
  if (method === 'GET' && p === '/api/tournaments') return reply(res, 200, listTournaments(user));
  if (method === 'GET' && p === '/api/invitations') return reply(res, 200, myInvitations(user));
  if (method === 'POST' && parts[1] === 'invitations' && parts.length === 4 && parts[3] === 'respond') {
    const b = await body(req);
    const result = respondInvitation(user, parts[2], b.action);
    if (b.action === 'accept') notifyJoined(user, result);
    return reply(res, 200, result);
  }
  if (method === 'POST' && p === '/api/tournaments/join-public') {
    const b = await body(req);
    const joined = joinPublicTournament(user, b.tournamentId);
    notifyJoined(user, joined);
    return reply(res, 200, joined);
  }
  if (method === 'POST' && p === '/api/tournaments') {
    const b = await body(req);
    const created = createTournament(user, b.name, b.description, b.visibility ?? 'invite_only');
    notifySafely(user.id, `created:${created.id}:${user.id}`, created.id, `Tournament created: ${created.name}`, `Your new GRIDLOCK tournament is ready.\n${publicUrl()}/?tournament=${created.id}`);
    return reply(res, 201, created)
  }
  if (method === 'POST' && p === '/api/tournaments/join') {
    const b = await body(req);
    const joined = joinTournament(user, b.inviteCode);
    notifyJoined(user, joined);
    return reply(res, 200, joined)
  }
  if (parts[1] === 'tournaments' && parts.length >= 3) {

    const t = requireTournament(user, parts[2]);
    if (method === 'GET' && parts.length === 3) return reply(res, 200, t);
    if (method === 'PATCH' && parts.length === 3) {
      const changes = await body(req);
      const amended = amendTournament(user, t.id, changes);
      audit(user.id, 'tournament.amend', t.id, '', changes);
      return reply(res, 200, amended);
    }
    if (method === 'GET' && parts[3] === 'users' && parts.length === 4) {
      return reply(res, 200, searchUsers(user, t.id, url.searchParams.get('q') ?? ''));
    }
    if (method === 'POST' && parts[3] === 'invite-user' && parts.length === 4) {
      const b = await body(req);
      const result = inviteExistingUser(user, t.id, b.userId);
      notifySafely(b.userId, `invited:${t.id}:${b.userId}`, t.id, `Invitation to ${t.name}`, `You have a new GRIDLOCK tournament invitation. Sign in to accept it:\n${publicUrl()}/?tournament=${t.id}`);
      audit(user.id, 'tournament.invite-user', t.id, '', {userId: b.userId});
      return reply(res, 201, result);
    }
    if (method === 'GET' && parts[3] === 'members') {

      return reply(res, 200, all(`SELECT u.id,u.display_name,m.role,m.joined_at FROM users u
     JOIN tournament_members m ON m.user_id=u.id WHERE m.tournament_id=? ORDER BY m.joined_at`, t.id))
    }
    if (method === 'POST' && parts[3] === 'rotate-invite') {
      return reply(res, 200, rotateInvite(user, t.id))
    }
  }
  if (method === 'GET' && p === '/api/seasons') {
    const t = url.searchParams.get('tournamentId');
    if (!t) throw bad('tournamentId required');
    requireTournament(user, t);
    return reply(res, 200, all('SELECT * FROM seasons WHERE tournament_id=? ORDER BY year DESC', t))
  }
  if (method === 'GET' && parts[1] === 'seasons' && parts.length === 3) {
    const s = season(parts[2], user);
    return reply(res, 200, {...s, configLocked: seasonIsLocked(s), champions: get('SELECT wdc,wcc,published_at FROM champions WHERE season_id=?', s.id) ?? null})
  }
  if (method === 'GET' && p === '/api/weekends') {
    const s = url.searchParams.get('seasonId');
    if (!s) throw bad('seasonId required');
    season(s, user);
    return reply(res, 200, all('SELECT * FROM weekends WHERE season_id=? ORDER BY round', s).map(sanitizeW))
  }
  if (parts[1] === 'weekends' && parts.length >= 3) {

    const w = weekend(parts[2], user);
    if (method === 'GET' && parts.length === 3) {
      const own = latestSubmissions(w.id, user.id);
      const published = currentResult(w.id);
      const mine = latestScores(w.id).find(r => r.user_id === user.id) ?? null;
      return reply(res, 200, {weekend: sanitizeW(w), mySubmissions: own, result: published?.published_at ? published.payload : null, score: mine ? {...mine, breakdown: parse(mine.breakdown)} : null})
    }
    if (method === 'GET' && parts[3] === 'leaderboard') {
      const published = currentResult(w.id);
      if (!published?.published_at) return reply(res, 200, []);
      const overall = standingRows(w.season_id), scores = latestScores(w.id);
      const table = scores.map(sc => {
        const stats = overall.find(r => r.userId === sc.user_id);
        return {userId: sc.user_id, name: stats?.name ?? 'Player', total: sc.points, exactPodiums: stats?.exactPodiums ?? 0, exactTop10: stats?.exactTop10 ?? 0, propPoints: stats?.propPoints ?? 0, bestWeek: stats?.bestWeek ?? 0};
      });
      return reply(res, 200, rankWithTies(table));
    }
    if (method === 'GET' && parts[3] === 'picks' && parts.length === 4) {

      const picks = latestSubmissions(w.id).filter(s => s.user_id === user.id || locked(formLock(w, s.form)));
      return reply(res, 200, picks.map(s => ({...s, displayName: get('SELECT display_name FROM users WHERE id=?', s.user_id)?.display_name})));
    }
    if (method === 'PUT' && parts[3] === 'picks' && parts.length === 5) {

      const form = parts[4] as FormKind;
      const b = await body(req);
      return reply(res, 201, transaction(() => {
        if (locked(formLock(w, form))) throw new HttpError(409, 'Submission deadline passed');
        const receipt = insertSubmission(w, user.id, form, b, now());
        notifySafely(user.id, `submission:${w.id}:${form}:${user.id}:${receipt.version}`, w.tournament_id,
          `${w.name}: your ${form} submission is saved`, `Your prediction was submitted at ${receipt.submittedAt} (UTC). Revision ${receipt.version}.\nYour picks stay private until the session locks.\n${publicUrl()}/?tournament=${w.tournament_id}`);
        return receipt
      }));
    }
  }
  if (method === 'GET' && p === '/api/roster') {
    const s = url.searchParams.get('seasonId');
    if (!s) throw bad('seasonId required');
    season(s, user);
    return reply(res, 200, all('SELECT * FROM roster WHERE season_id=? ORDER BY team_name,name', s))
  }
  if (method === 'GET' && p === '/api/standings') {
    const s = url.searchParams.get('seasonId');
    if (!s) throw bad('seasonId required');
    season(s, user);
    return reply(res, 200, rankWithTies(standingRows(s)))
  }
  if (method === 'GET' && p === '/api/ledger') {
    const s = url.searchParams.get('seasonId');
    if (!s) throw bad('seasonId required');
    season(s, user);
    return reply(res, 200, {...ledgerSummary(s), entries: ledgerSummary(s).entries.map(({idempotency_key, created_by, ...entry}: any) => entry), payouts: payoutSnapshot(season(s))})
  }
  if (method === 'GET' && p === '/api/championship-picks') {

    const s = url.searchParams.get('seasonId');
    if (!s) throw bad('seasonId required');
    const seasonData = season(s, user);
    const visible = locked(seasonData.preseason_lock);
    const rows = all('SELECT * FROM champion_picks WHERE season_id=? ORDER BY version DESC', s), seen = new Set<string>();
    return reply(res, 200, rows.filter(r => {
      const k = r.user_id + ':' + r.category;
      if (seen.has(k)) return false;
      seen.add(k);
      return visible || r.user_id === user.id
    }).map(r => ({...r, displayName: get('SELECT display_name FROM users WHERE id=?', r.user_id)?.display_name})));
  }
  if (method === 'PUT' && p === '/api/championship-picks') {

    const b = await body(req), s = season(b.seasonId, user), date = now();
    const isPre = !locked(s.preseason_lock), isSalvage = locked(s.salvage_start) && !locked(s.salvage_end);
    if (!isPre && !isSalvage) throw new HttpError(409, 'Championship picks are currently locked');
    if (!['wdc', 'wcc'].includes(b.category) || !validId(b.choice)) throw bad('Choose a valid category and driver/constructor');
    if (b.category === 'wdc' && !get('SELECT 1 FROM roster WHERE season_id=? AND id=?', s.id, b.choice)) throw bad('Unknown WDC driver');
    if (b.category === 'wcc' && !get('SELECT 1 FROM roster WHERE season_id=? AND team_id=?', s.id, b.choice)) throw bad('Unknown WCC team');
    return reply(res, 201, transaction(() => {

      if (isSalvage && !preSeasonPick(s.id, user.id, b.category, 'preseason')) throw bad('Cannot adjust a missing preseason pick');
      const prev = preSeasonPick(s.id, user.id, b.category), v = (prev?.version ?? 0) + 1, phase = isPre ? 'preseason' : 'salvage';
      run('INSERT INTO champion_picks VALUES(?,?,?,?,?,?,?,?)', id(), s.id, user.id, b.category, b.choice, phase, date, v);
      audit(user.id, 'championship.pick', s.id, '', {category: b.category, phase, version: v});
      return {category: b.category, choice: b.choice, phase, version: v};
    }));
  }
  if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'Route not found');
  if (method === 'POST' && p === '/api/admin/seasons') {

    const b = await body(req);
    const year = int(b.year, 2023, 2200), sId = id();
    requireCommissioner(user, b.tournamentId);
    if (!['one-form', 'two-form'].includes(b.sprintMode ?? 'two-form')) throw bad('Invalid sprint mode');
    const currency = String(b.currency ?? 'EUR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw bad('Three-letter currency required');
    const base = int(b.baseEntryCents ?? 1000, 1, 10000000), small = int(b.smallMax ?? 5, 3, 100), medium = int(b.mediumMax ?? 10, small + 1, 200);
    const pre = asUTC(b.preseasonLock, 'Preseason lock'), sStart = asUTC(b.salvageStart, 'Salvage start'), sEnd = asUTC(b.salvageEnd, 'Salvage end');
    if (Date.parse(sEnd) - Date.parse(sStart) !== 7 * 86400000 || new Date(sStart).getUTCMonth() !== 7 || new Date(sEnd).getUTCMonth() !== 7) throw bad('Salvage window must be exactly 7 days entirely within August (UTC)');
    try {
      return reply(res, 201, transaction(() => {
        run('INSERT INTO seasons VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', sId, year, String(b.name ?? `F1 ${year}`), b.tournamentId, b.sprintMode ?? 'two-form', currency, base, small, medium, pre, sStart, sEnd, now());
        audit(user.id, 'season.create', sId);
        return {id: sId}
      }))
    } catch (e: any) {
      if (/UNIQUE/.test(String(e))) throw new HttpError(409, 'Season already exists');
      throw e
    }
  }
  if (method === 'PATCH' && parts[2] === 'seasons' && parts.length === 4) {

    const s = requireSeasonCommissioner(user, parts[3]);
    if (seasonIsLocked(s)) throw new HttpError(409, 'Season configuration is frozen after Round 1 lock');
    const b = await body(req);
    const patch = {sprint_mode: b.sprintMode ?? s.sprint_mode, base_entry_cents: b.baseEntryCents ?? s.base_entry_cents, small_max: b.smallMax ?? s.small_max, medium_max: b.mediumMax ?? s.medium_max};
    if (!['two-form', 'one-form'].includes(patch.sprint_mode)) throw bad('Invalid mode');
    int(patch.base_entry_cents, 1);
    int(patch.small_max, 3, 100);
    int(patch.medium_max, patch.small_max + 1, 200);
    return reply(res, 200, transaction(() => {
      run('UPDATE seasons SET sprint_mode=?,base_entry_cents=?,small_max=?,medium_max=? WHERE id=?', patch.sprint_mode, patch.base_entry_cents, patch.small_max, patch.medium_max, s.id);
      audit(user.id, 'season.config', s.id, '', patch);
      return patch
    }));
  }
  if (method === 'POST' && p === '/api/admin/roster') {

    const b = await body(req);
    requireSeasonCommissioner(user, b.seasonId);
    if (!Array.isArray(b.drivers) || b.drivers.length < 1 || b.drivers.length > 40) throw bad('Supply 1–40 drivers');
    const ids = new Set<string>();
    for (const d of b.drivers) {
      if (!validId(d.id) || !validId(d.teamId) || typeof d.name !== 'string' || typeof d.teamName !== 'string' || ids.has(d.id)) throw bad('Invalid or duplicate roster entry');
      ids.add(d.id)
    }
    return reply(res, 200, transaction(() => {

      const existing = get('SELECT COUNT(*) AS n FROM submissions p JOIN weekends w ON p.weekend_id=w.id WHERE w.season_id=?', b.seasonId);
      if (existing?.n > 0) throw new HttpError(409, 'Cannot replace roster after submissions');
      run('DELETE FROM roster WHERE season_id=?', b.seasonId);
      for (const d of b.drivers) run('INSERT INTO roster VALUES(?,?,?,?,?,?)', b.seasonId, d.id, d.name, d.code ?? d.id, d.teamId, d.teamName);
      audit(user.id, 'roster.replace', b.seasonId, '', {count: b.drivers.length});
      return {count: b.drivers.length}
    }));
  }
  if (method === 'POST' && p === '/api/admin/weekends') {

    const b = await body(req), s = requireSeasonCommissioner(user, b.seasonId);
    const round = int(b.round, 1, 40), qual = asUTC(b.qualifyingAt, 'Qualifying'), race = asUTC(b.raceAt, 'Race'), isSprint = !!b.isSprint;
    const sprintQual = isSprint ? asUTC(b.sprintQualifyingAt, 'Sprint qualifying') : null;
    if ((isSprint && Date.parse(sprintQual!) >= Date.parse(qual)) || Date.parse(qual) >= Date.parse(race)) throw bad('Session dates must be ordered');
    const lock = isSprint ? sprintQual! : qual;
    if (round === 1 && Date.parse(s.preseason_lock) > Date.parse(lock)) throw bad('Preseason lock must be on/before Round 1 qualifying lock');
    const wId = id();
    return reply(res, 201, transaction(() => {
      run('INSERT INTO weekends VALUES(?,?,?,?,?,?,?,?,?,?,?)', wId, s.id, round, String(b.name ?? `Round ${round}`), Number(isSprint), qual, sprintQual, race, b.chequeredAt ? asUTC(b.chequeredAt, 'Chequered flag') : null, toJSON(b.openf1Keys ?? {}), now());
      audit(user.id, 'weekend.create', wId);
      return {id: wId}
    }));
  }
  if (method === 'POST' && p === '/api/admin/openf1/import-roster') {

    const b = await body(req), s = requireSeasonCommissioner(user, b.seasonId), sessionKey = int(b.sessionKey, 1);
    const drivers = await queryOpenF1('drivers', {session_key: sessionKey});
    const rows = [...new Map(drivers.filter(d => d.driver_number && d.team_name).map(d => [String(d.driver_number), d])).values()].map(d => ({
      id: String(d.driver_number), name: String(d.full_name ?? d.broadcast_name ?? d.last_name), code: String(d.name_acronym ?? d.driver_number), teamId: String(d.team_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), teamName: String(d.team_name)
    }));
    if (rows.length < 10) throw bad('OpenF1 roster incomplete; fewer than 10 drivers');
    return reply(res, 200, transaction(() => {

      if (get('SELECT COUNT(*) AS n FROM submissions p JOIN weekends w ON w.id=p.weekend_id WHERE w.season_id=?', s.id)?.n > 0) throw new HttpError(409, 'Cannot replace roster after predictions');
      run('DELETE FROM roster WHERE season_id=?', s.id);
      for (const d of rows) run('INSERT INTO roster VALUES(?,?,?,?,?,?)', s.id, d.id, d.name, d.code, d.teamId, d.teamName);
      audit(user.id, 'openf1.roster', s.id, '', {sessionKey, count: rows.length});
      return {count: rows.length, drivers: rows};
    }));
  }
  if (method === 'POST' && p === '/api/admin/openf1/calendar') {

    const b = await body(req);
    requireCommissioner(user, b.tournamentId);
    const year = int(b.year, 2023, 2200);
    const [sessions, meetings] = await Promise.all([queryOpenF1('sessions', {year}), queryOpenF1('meetings', {year})]);
    return reply(res, 200, calendarFromSessions(sessions, meetings));
  }
  if (method === 'POST' && p === '/api/admin/openf1/import-calendar') {

    const b = await body(req), s = requireSeasonCommissioner(user, b.seasonId);
    if (!Array.isArray(b.events) || b.events.length > 40) throw bad('Expected events from calendar preview');
    return reply(res, 200, transaction(() => {

      let created = 0, unchanged = 0;
      for (const e of b.events) {

        const rnd = int(e.round, 1, 40), qual = asUTC(e.qualifyingAt, 'qualifying'), race = asUTC(e.raceAt, 'race'), sprint = !!e.isSprint, sp = sprint ? asUTC(e.sprintQualifyingAt, 'sprint qualifying') : null;
        if (rnd === 1 && Date.parse(s.preseason_lock) > Date.parse(sprint ? sp! : qual)) throw bad('Preseason lock must be on/before Round 1 qualifying lock');
        if (get('SELECT id FROM weekends WHERE season_id=? AND round=?', s.id, rnd)) {
          unchanged++;
          continue
        }
        const wId = id();
        run('INSERT INTO weekends VALUES(?,?,?,?,?,?,?,?,?,?,?)', wId, s.id, rnd, String(e.name), Number(sprint), qual, sp, race, null, toJSON(e.openf1Keys ?? {}), now());
        created++;
      }
      audit(user.id, 'calendar.import', s.id, '', {created, unchanged});
      return {created, unchanged};
    }));
  }
  if (parts[2] === 'weekends' && parts.length >= 4) {

    const w = weekend(parts[3], user), r = currentResult(w.id);
    requireCommissioner(user, w.tournament_id);
    if (method === 'PATCH' && parts[4] === 'schedule') {

      const b = await body(req);
      if (r?.published_at) throw new HttpError(409, 'Published round cannot be rescheduled');
      if (locked(w.is_sprint ? w.sprint_qualifying_at : w.qualifying_at)) throw new HttpError(409, 'Cannot change dates after the earliest qualifying lock');
      const qual = b.qualifyingAt ? asUTC(b.qualifyingAt, 'qualifying') : w.qualifying_at;
      const sp = w.is_sprint ? (b.sprintQualifyingAt ? asUTC(b.sprintQualifyingAt, 'sprint qualifying') : w.sprint_qualifying_at) : null;
      const race = b.raceAt ? asUTC(b.raceAt, 'race') : w.race_at;
      if ((w.is_sprint && Date.parse(sp) >= Date.parse(qual)) || Date.parse(qual) >= Date.parse(race)) throw bad('Invalid session order');
      return reply(res, 200, transaction(() => {
        run('UPDATE weekends SET qualifying_at=?,sprint_qualifying_at=?,race_at=? WHERE id=?', qual, sp, race, w.id);
        audit(user.id, 'weekend.schedule', w.id, String(b.note ?? ''), {qualifyingAt: qual, sprintQualifyingAt: sp, raceAt: race});
        return {updated: true}
      }));
    }
    if (method === 'GET' && parts[4] === 'result') return reply(res, 200, r ?? {error: 'No draft entered'});
    if (method === 'POST' && parts[4] === 'sync') {

      if (r?.published_at) throw new HttpError(409, 'Published result is frozen');
      const {draft, needsReview} = await fetchDraft(parse(w.openf1_keys), !!w.is_sprint);
      const version = (r?.version ?? 0) + 1;
      transaction(() => {

        run(`INSERT INTO results(weekend_id,payload,source,version,final_classification,updated_at)
      VALUES(?,?,?, ?,0,?) ON CONFLICT(weekend_id) DO UPDATE SET payload=excluded.payload,source=excluded.source,version=excluded.version,final_classification=0,updated_at=excluded.updated_at`, w.id, toJSON(draft), 'openf1', version, now());
        run('DELETE FROM scoring_previews WHERE weekend_id=?', w.id);
        audit(user.id, 'result.sync', w.id, 'OpenF1 provisional draft', {version, needsReview})
      });
      return reply(res, 200, {draft, needsReview});
    }
    if (method === 'PUT' && parts[4] === 'result') {

      const b = await body(req);
      if (r?.published_at) throw new HttpError(409, 'Published result is frozen');
      validateResult(b.result, !!w.is_sprint);
      if (!['manual', 'openf1', 'json-import'].includes(b.source ?? 'manual')) throw bad('Invalid result source');
      const v = (r?.version ?? 0) + 1;
      return reply(res, 200, transaction(() => {

        run(`INSERT INTO results(weekend_id,payload,source,version,final_classification,updated_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(weekend_id) DO UPDATE SET payload=excluded.payload,source=excluded.source,version=excluded.version,final_classification=excluded.final_classification,updated_at=excluded.updated_at`, w.id, toJSON(b.result), b.source ?? 'manual', v, b.finalClassification ? 1 : 0, now());
        run('DELETE FROM scoring_previews WHERE weekend_id=?', w.id);
        audit(user.id, 'result.edit', w.id, String(b.note ?? ''), {version: v});
        return {version: v}
      }));
    }
    if (method === 'POST' && parts[4] === 'preview') {

      if (!r) throw bad('Import or enter a race classification first');
      validateResult(r.payload, !!w.is_sprint);
      const digest = resultDigest(w, r.payload), scores = computeScores(w, r.payload);
      transaction(() => {
        run('INSERT INTO scoring_previews VALUES(?,?,?,?) ON CONFLICT(weekend_id) DO UPDATE SET digest=excluded.digest,created_at=excluded.created_at,reviewer_id=excluded.reviewer_id', w.id, digest, now(), user.id);
        audit(user.id, 'result.preview', w.id, '', {digest})
      });
      return reply(res, 200, {digest, voided: r.payload.cancelled || r.payload.greenFlagLaps < 2, scores});
    }
    if (method === 'POST' && parts[4] === 'publish') {

      if (!r) throw bad('No result draft');
      ensureResultPublishable(w, r);
      if (r.published_at) return reply(res, 200, {alreadyPublished: true});
      const digest = resultDigest(w, r.payload), preview = get('SELECT * FROM scoring_previews WHERE weekend_id=?', w.id);
      if (!preview || preview.digest !== digest) throw new HttpError(409, 'Run Preview Scores after the latest draft or pick revision before publishing');
      const scores = computeScores(w, r.payload);
      const published = transaction(() => {

        for (const s of scores) run('INSERT INTO score_snapshots VALUES(?,?,?,?,?,?,?,?,?,?)', id(), w.id, s.userId, r.version, s.total, s.exactPodiums, s.exactTop10, s.propPoints, toJSON(s), now());
        run('UPDATE results SET published_at=?,published_hash=? WHERE weekend_id=?', now(), digest, w.id);
        audit(user.id, 'result.publish', w.id, '', {version: r.version, digest});
        const ranks = rankWithTies(standingRows(w.season_id));
        for (const row of ranks) {
          const weekScore = scores.find(item => item.userId === row.userId)?.total ?? 0;
          notifySafely(row.userId, `result:${w.id}:${r.version}:${row.userId}`, w.tournament_id,
            `${w.name}: results and standings published`,
            `Your ${w.name} result: ${weekScore} points.\nOverall rank: ${row.rank}; total points: ${row.total}.\nReview the public submissions, full results and standings in the tournament:\n${publicUrl()}/?tournament=${w.tournament_id}`);
        }
        return {published: true, count: scores.length, digest}
      });
      try {
        const b = await createBackup();
        return reply(res, 200, {...published, backup: {encrypted: b.encrypted, offsite: b.offsite, warning: b.warning}})
      } catch (e: any) {
        console.error('[BACKUP FAILED AFTER RACE]', e);
        return reply(res, 200, {...published, backupWarning: String(e.message)})
      }
    }
    if (method === 'POST' && parts[4] === 'fallback') {

      const b = await body(req), participant = get('SELECT id FROM users WHERE id=?', b.userId);
      if (!participant || !get('SELECT 1 FROM tournament_members WHERE tournament_id=? AND user_id=?', w.tournament_id, b.userId)) throw bad('Unknown tournament participant');
      const timestamp = asUTC(b.evidenceTimestamp, 'Evidence timestamp');
      if (timestamp > now()) throw bad('Evidence timestamp cannot be in the future');
      if (typeof b.evidenceNote !== 'string' || b.evidenceNote.length < 8) throw bad('Emergency submissions require a timestamped evidence note');
      if (r?.published_at) throw new HttpError(409, 'Published round cannot be edited');
      const form = b.form as FormKind;
      return reply(res, 201, transaction(() => insertSubmission(w, b.userId, form, b.pick, timestamp, 'emergency', b.evidenceNote)));
    }
  }
  if (method === 'POST' && p === '/api/admin/ledger') {

    const b = await body(req), s = requireSeasonCommissioner(user, b.seasonId), type = b.type, amount = int(Math.abs(b.amountCents), 1, 100000000);
    if (!['buyin', 'adjustment', 'refund', 'payout'].includes(type)) throw bad('Unsupported transaction type');
    const signed = ['refund', 'payout'].includes(type) ? -amount : (type === 'adjustment' && b.amountCents < 0 ? -amount : amount);
    if (['buyin', 'refund', 'payout'].includes(type) && !b.userId) throw bad('Buy-in, refund and payout must identify a tournament participant');
    if (b.userId && !get('SELECT 1 FROM tournament_members WHERE tournament_id=? AND user_id=?', s.tournament_id, b.userId)) throw bad('Unknown tournament participant');
    if (!validId(b.idempotencyKey) || typeof b.description !== 'string' || b.description.trim().length < 3 || b.description.length > 500) throw bad('Idempotency key and description of 3–500 characters required');
    return reply(res, 201, transaction(() => {

      const existing = get('SELECT * FROM ledger WHERE idempotency_key=?', b.idempotencyKey);
      if (existing) {
        if (existing.season_id !== s.id || existing.user_id !== (b.userId ?? null) || existing.amount_cents !== signed || existing.type !== type) throw new HttpError(409, 'Idempotency key already used for a different transaction');
        return {...existing, replayed: true};
      }
      if (type === 'refund') {
        const paid = get("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM ledger WHERE season_id=? AND user_id=? AND type IN ('buyin','refund')", s.id, b.userId)?.cents ?? 0;
        if (paid < amount) throw new HttpError(409, 'Refund exceeds the participant’s net paid entry');
      }
      if (type === 'payout') {
        const eligible = get("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM ledger WHERE season_id=? AND user_id=? AND type IN ('buyin','refund')", s.id, b.userId)?.cents ?? 0;
        if (eligible <= 0) throw new HttpError(409, 'Payout requires a paying tournament participant');
      }
      if (ledgerSummary(s.id).cashCents + signed < 0) throw new HttpError(409, 'Ledger transaction would overdraw the pool');
      const row = {id: id(), season_id: s.id, user_id: b.userId ?? null, type, amount_cents: signed, description: b.description, idempotency_key: b.idempotencyKey, created_by: user.id, created_at: now()};
      run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?)', ...Object.values(row));
      audit(user.id, 'ledger.entry', row.id, '', {type, signed});
      return row;
    }));
  }
  if (method === 'POST' && p === '/api/admin/champions') {

    const b = await body(req), s = requireSeasonCommissioner(user, b.seasonId);
    if (!validId(b.wdc) || !validId(b.wcc) || !get('SELECT 1 FROM roster WHERE season_id=? AND id=?', s.id, b.wdc) || !get('SELECT 1 FROM roster WHERE season_id=? AND team_id=?', s.id, b.wcc)) throw bad('Invalid champions');
    if (!locked(s.salvage_end)) throw new HttpError(409, 'Cannot finalize championships before summer break');
    const last = get('SELECT race_at FROM weekends WHERE season_id=? ORDER BY round DESC LIMIT 1', s.id);
    if (!last || !locked(last.race_at)) throw new HttpError(409, 'Season is not finished yet');
    if (get('SELECT COUNT(*) AS n FROM weekends w LEFT JOIN results r ON r.weekend_id=w.id WHERE w.season_id=? AND r.published_at IS NULL', s.id)?.n > 0) throw new HttpError(409, 'Publish all round results before the championship');
    return reply(res, 200, transaction(() => {

      if (get('SELECT 1 FROM champions WHERE season_id=?', s.id)) throw new HttpError(409, 'Championship has already been published');
      run('INSERT INTO champions VALUES(?,?,?,?,?)', s.id, b.wdc, b.wcc, now(), user.id);
      audit(user.id, 'championship.publish', s.id, '', {wdc: b.wdc, wcc: b.wcc});
      const ranks = rankWithTies(standingRows(s.id));
      const payouts = payoutSnapshot(s);
      const tournament = get('SELECT name FROM tournaments WHERE id=?', s.tournament_id);
      for (const row of ranks) {
        const share = payouts.prizes.find((p: any) => p.userId === row.userId)?.amountCents ?? 0;
        notifySafely(row.userId, `champions:${s.id}:${row.userId}`, s.tournament_id,
          `${tournament?.name ?? 'GRIDLOCK'}: final standings and prize shares`,
          `Final position: #${row.rank} with ${row.total} points.\nYour calculated prize allocation: ${(share / 100).toFixed(2)} ${s.currency}.\nThis is a ledger allocation, not proof of payment.\nFull final standings and payout information:\n${publicUrl()}/?tournament=${s.tournament_id}`);
      }
      return {published: true};
    }));
  }
  if (method === 'GET' && p === '/api/admin/audit') {
    const t = url.searchParams.get('tournamentId');
    if (!t) throw bad('tournamentId required');
    requireCommissioner(user, t);
    const entityId = url.searchParams.get('entityId');
    return reply(res, 200, entityId ? all('SELECT * FROM audit WHERE tournament_id=? AND entity_id=? ORDER BY created_at DESC LIMIT 300', t, entityId) : all('SELECT * FROM audit WHERE tournament_id=? ORDER BY created_at DESC LIMIT 300', t))
  }
  if (method === 'GET' && p === '/api/admin/mail') {
    if (user.role !== 'admin') throw new HttpError(403, 'Operator privileges required');
    return reply(res, 200, mailStatus());
  }
  if (method === 'POST' && p === '/api/admin/mail/sync') {
    if (user.role !== 'admin') throw new HttpError(403, 'Operator privileges required');
    const queued = reconcileDeadlineEmails();
    const delivery = await drainEmailOutbox(10);
    return reply(res, 200, {queued, delivery});
  }
  if (method === 'POST' && p === '/api/admin/backup') {
    if (user.role !== 'admin') throw new HttpError(403, 'Operator role required for database-wide backups');
    const backup = await createBackup();
    audit(user.id, 'backup.created', 'database', '', {encrypted: backup.encrypted, offsite: backup.offsite, warning: backup.warning});
    return reply(res, 200, {created: true, encrypted: backup.encrypted, offsite: backup.offsite, warning: backup.warning});
  }
  throw new HttpError(404, 'Route not found');
}
/** API-only Node.js HTTP server; the frontend is deployed as an independent service. */
export const app = createServer(async (req, res) => {

  securityHeaders(res);
  try {

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    assertSameOrigin(req);
    await route(req, res, url);
  } catch (err) {

    if (err instanceof HttpError) reply(res, err.status, {error: err.message});
    else {
      console.error('[API ERROR]', err);
      reply(res, 500, {error: 'Internal server error'})
    }
  }
});
if (process.env.NODE_ENV !== 'test') {

  const port = Number(process.env.API_PORT ?? 3001), host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`F1 Prediction Pool listening http://${host}:${port} SQLite: ${dbPath}`);
    void catchUpOpenF1();
    void dispatchPendingMail();
    setInterval(() => void dispatchPendingMail(), 60_000).unref()
  });
  /**
 * Gracefully terminate the API and create a consistent database backup.
 */
  const shutdown = async () => {

    console.log('Shutting down; backing up persistent SQLite database');
    try {
      const outcome = await createBackup();
      console.log('Shutdown backup:', outcome)
    } catch (e) {
      console.error('Shutdown backup failed:', e)
    }
    app.close(() => {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      process.exit(0)
    })
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
/** Process delayed notifications after downtime; this does not control prediction deadlines. */
async function dispatchPendingMail(): Promise<void> {
  try {
    reconcileDeadlineEmails();
    await drainEmailOutbox(10);
  } catch (error) {
    console.error('[MAIL DISPATCH]', (error as Error).message);
  }
}

/** On restart, stage missing official classifications for review, never publish automatically. */
async function catchUpOpenF1() {

  if (process.env.AUTO_SYNC_ON_STARTUP !== 'true') return;
  const candidates = all(`SELECT * FROM weekends WHERE race_at<? AND race_at>? AND openf1_keys!='{}'
 ORDER BY race_at DESC LIMIT 2`, new Date(Date.now() - 5 * 3600000).toISOString(), new Date(Date.now() - 30 * 86400000).toISOString());
  for (const w of candidates) {

    try {

      if (currentResult(w.id)) continue;
      const {draft, needsReview} = await fetchDraft(parse(w.openf1_keys), !!w.is_sprint);
      transaction(() => {

        if (currentResult(w.id)) return;
        run('INSERT INTO results(weekend_id,payload,source,version,final_classification,updated_at) VALUES(?,?,?,1,0,?)', w.id, toJSON(draft), 'openf1', now());
        audit('system', 'result.startup-sync', w.id, 'Awaiting commissioner review', {needsReview})
      });
    } catch (e) {
      console.error('OpenF1 startup reconciliation failed for', w.id, e)
    }
  }
}
