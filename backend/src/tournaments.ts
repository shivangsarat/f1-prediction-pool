import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {all, get, run, transaction} from './db.ts';
import {HttpError, bad, type User} from './auth.ts';

export type TournamentRole = 'commissioner' | 'player';

/** Normalize tournament names while rejecting markup-like or excessively long input. */
export function tournamentName(value: unknown): string {

  if (typeof value !== 'string') throw bad('Tournament name is required');
  const name = value.trim();
  if (name.length < 3 || name.length > 80 || /[<>]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32)) {

    throw bad('Tournament name must contain 3–80 printable characters');
  }
  return name;
}

/** Hash an invitation code so database disclosure does not reveal invitations. */
export function inviteHash(code: string): string {

  return createHash('sha256').update(code).digest('hex');
}

/** Generate a cryptographically random, URL-safe invite code. */
export function newInviteCode(): string {

  return randomBytes(24).toString('base64url');
}

/** Return only tournaments of which the caller is a member. */
export function listTournaments(user: User) {

  return all(`SELECT t.id,t.name,t.description,t.owner_id,t.created_at,m.role,
     (SELECT COUNT(*) FROM tournament_members tm WHERE tm.tournament_id=t.id) AS memberCount
     FROM tournaments t JOIN tournament_members m ON m.tournament_id=t.id
     WHERE m.user_id=? ORDER BY t.created_at DESC`, user.id);
}

/** Require membership, returning HTTP 404 for tournaments outside the caller's scope. */
export function requireTournament(user: User, tournamentId: string) {

  const t = get(`SELECT t.id,t.name,t.description,t.owner_id,t.created_at,m.role,
    (SELECT COUNT(*) FROM tournament_members tm WHERE tm.tournament_id=t.id) AS memberCount
    FROM tournaments t JOIN tournament_members m ON m.tournament_id=t.id
    WHERE t.id=? AND m.user_id=?`, tournamentId, user.id);
  if (!t) throw new HttpError(404, 'Tournament not found');
  return t;
}

/** Enforce tournament-local commissioner privileges; global roles do not bypass isolation. */
export function requireCommissioner(user: User, tournamentId: string) {

  const member = requireTournament(user, tournamentId);
  if (member.role !== 'commissioner') throw new HttpError(403, 'Tournament commissioner privileges required');
  return member;
}

/** Create a tournament and grant its creator local commissioner privileges atomically. */
export function createTournament(user: User, name: unknown, description: unknown) {

  const safeName = tournamentName(name);
  const safeDescription = typeof description === 'string' ? description.trim() : '';
  if (safeDescription.length > 500 || /[<>]/.test(safeDescription) || [...safeDescription].some(char => char.charCodeAt(0) < 9)) throw bad('Description must contain up to 500 plain-text characters');
  const id = randomUUID(), inviteCode = newInviteCode(), now = new Date().toISOString();
  return transaction(() => {

    run('INSERT INTO tournaments VALUES(?,?,?,?,?,?)', id, safeName, safeDescription, user.id, inviteHash(inviteCode), now);
    run('INSERT INTO tournament_members VALUES(?,?,?,?)', id, user.id, 'commissioner', now);
    return {id, name: safeName, description: safeDescription, role: 'commissioner', memberCount: 1, inviteCode};
  });
}

/** Join exactly one tournament by a secret invitation; repeated joins are idempotent. */
export function joinTournament(user: User, code: unknown) {

  if (typeof code !== 'string' || code.length < 20 || code.length > 128) throw bad('Invalid invitation code');
  return transaction(() => {

    const tournament = get('SELECT id FROM tournaments WHERE invite_hash=?', inviteHash(code));
    if (!tournament) throw new HttpError(404, 'Invitation code not recognized');
    run("INSERT OR IGNORE INTO tournament_members VALUES(?,?,?,?)", tournament.id, user.id, 'player', new Date().toISOString());
    return requireTournament(user, tournament.id);
  });
}

/** Rotate the invitation code, invalidating any previously issued codes. */
export function rotateInvite(user: User, tournamentId: string) {

  requireCommissioner(user, tournamentId);
  const inviteCode = newInviteCode();
  run('UPDATE tournaments SET invite_hash=? WHERE id=?', inviteHash(inviteCode), tournamentId);
  return {inviteCode};
}

/** Ensure an entity's season belongs to a tournament the caller joined. */
export function requireSeasonMember(user: User, seasonId: string) {

  const season = get('SELECT * FROM seasons WHERE id=?', seasonId);
  if (!season) throw new HttpError(404, 'Season not found');
  requireTournament(user, season.tournament_id);
  return season;
}

/** Require commissioner access on the tournament that owns the provided season. */
export function requireSeasonCommissioner(user: User, seasonId: string) {

  const season = requireSeasonMember(user, seasonId);
  requireCommissioner(user, season.tournament_id);
  return season;
}
