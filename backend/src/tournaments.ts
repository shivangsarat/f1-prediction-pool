import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {all, get, run, transaction} from './db.ts';
import {HttpError, bad, type User} from './auth.ts';
import {platformPolicy, tournamentTerms} from './financeStore.ts';

export type TournamentRole = 'operator' | 'commissioner' | 'player';
export type Visibility = 'public' | 'invite_only';

/** Return true only for the platform-wide operator, never for a tournament commissioner. */
export function isOperator(user: User): boolean {
  return user.role === 'admin';
}

/** Detect low ASCII control codes without relying on a control-character regular expression. */
function hasLowAsciiControl(value: string, maxCode: number): boolean {
  return [...value].some(char => char.charCodeAt(0) <= maxCode);
}

/** Normalize a tournament name and reject HTML/control characters. */
export function tournamentName(value: unknown): string {
  if (typeof value !== 'string') throw bad('Tournament name is required');
  const name = value.trim();
  if (name.length < 3 || name.length > 80 || (name.includes('<') || name.includes('>') || hasLowAsciiControl(name, 31))) {
    throw bad('Tournament name must contain 3–80 printable characters');
  }
  return name;
}

/** Validate and normalize a public or invitation-only discovery setting. */
export function tournamentVisibility(value: unknown): Visibility {
  if (value !== 'public' && value !== 'invite_only') throw bad('Visibility must be public or invite_only');
  return value;
}

/** Hash a high-entropy invitation token so the database contains no usable invite links. */
export function inviteHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Generate an unpredictable URL-safe invitation code. */
export function newInviteCode(): string {
  return randomBytes(24).toString('base64url');
}

/** Select only the safe, public-facing tournament fields and membership count. */
const tournamentFields = `t.id,t.name,t.description,t.owner_id,t.visibility,t.status,t.created_at,
  t.launch_opening_round,t.launch_expected_races,t.launch_year,
  (SELECT COUNT(*) FROM tournament_members tm WHERE tm.tournament_id=t.id) AS memberCount`;

/** List tournaments visible to a user; an operator can administer all tournaments. */
export function listTournaments(user: User) {
  if (isOperator(user)) {
    return all(`SELECT ${tournamentFields},'operator' AS role FROM tournaments t ORDER BY t.created_at DESC`);
  }
  return all(`SELECT ${tournamentFields},m.role FROM tournaments t
    JOIN tournament_members m ON m.tournament_id=t.id WHERE m.user_id=?
    ORDER BY t.created_at DESC`, user.id);
}

/** Return a minimal, bounded, active public tournament catalogue without exposing private invitations. */
export function publicCatalogue(query = '', scope: 'all' | 'full' | 'mid' = 'all') {
  if (!['all','full','mid'].includes(scope)) throw bad('Unknown catalogue scope');
  const search = String(query).trim().slice(0, 80).replace(/[\\%_]/g, '\\$&');
  return all(`SELECT ${tournamentFields} FROM tournaments t
    WHERE t.visibility='public' AND t.status='active'
      AND (?='all' OR (?='mid' AND (t.launch_opening_round>1 OR EXISTS (SELECT 1 FROM seasons s WHERE s.tournament_id=t.id AND s.opening_round>1)))
       OR (?='full' AND t.launch_opening_round=1 AND NOT EXISTS (SELECT 1 FROM seasons s WHERE s.tournament_id=t.id AND s.opening_round>1)))
      AND (t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
    ORDER BY t.created_at DESC LIMIT 100`, scope, scope, scope, `%${search}%`, `%${search}%`).map(tournament => ({...tournament, terms: tournamentTerms(tournament.id)}));
}

/** Require membership or global operator permission, hiding inaccessible private pools. */
export function requireTournament(user: User, tournamentId: string) {
  const t = get(`SELECT ${tournamentFields},m.role AS member_role FROM tournaments t
    LEFT JOIN tournament_members m ON m.tournament_id=t.id AND m.user_id=? WHERE t.id=?`, user.id, tournamentId);
  if (!t || (!isOperator(user) && !t.member_role)) throw new HttpError(404, 'Tournament not found');
  const {member_role, ...safe} = t;
  return {...safe, role: isOperator(user) ? 'operator' : member_role};
}

/** Authorize settings, results, invites, and ledger operations for a commissioner or global operator. */
export function requireCommissioner(user: User, tournamentId: string) {
  const t = requireTournament(user, tournamentId);
  if (t.role !== 'commissioner' && t.role !== 'operator') {
    throw new HttpError(403, 'Tournament commissioner privileges required');
  }
  return t;
}

/** Validate and truncate a plain-text tournament description. */
function descriptionValue(value: unknown): string {
  const description = typeof value === 'string' ? value.trim() : '';
  if (description.length > 500 || (description.includes('<') || description.includes('>') || hasLowAsciiControl(description, 8))) {
    throw bad('Description must contain up to 500 plain-text characters');
  }
  return description;
}

/** Create a tournament and atomically grant the creator its local commissioner role. */
export function createTournament(user: User, name: unknown, description: unknown, visibility: unknown = 'invite_only', launch: {openingRound?: unknown; expectedRaces?: unknown; year?: unknown} = {}) {
  const safeName = tournamentName(name), safeDescription = descriptionValue(description);
  const safeVisibility = tournamentVisibility(visibility);
  const openingRound = launch.openingRound === undefined ? 1 : Number(launch.openingRound);
  const expectedRaces = launch.expectedRaces === undefined ? 0 : Number(launch.expectedRaces);
  const launchYear = launch.year === undefined ? null : Number(launch.year);
  if (!Number.isInteger(openingRound) || openingRound < 1 || openingRound > 40 ||
      !Number.isInteger(expectedRaces) || expectedRaces < 0 || expectedRaces > 40 ||
      (launchYear !== null && (!Number.isInteger(launchYear) || launchYear < 2023 || launchYear > 2200))) throw bad('Invalid mid-season launch scope');
  if (openingRound > 1 && safeVisibility === 'public' && !platformPolicy().allowPublicMidseason && !isOperator(user)) {
    throw new HttpError(403, 'Public mid-season creation is disabled; invite-only pools are still permitted');
  }
  const cap = platformPolicy().maxActiveOwnedPools;
  const owned = get("SELECT COUNT(*) AS n FROM tournaments WHERE owner_id=? AND status='active'", user.id)?.n ?? 0;
  if (!isOperator(user) && owned >= cap) throw new HttpError(409, `Active tournament creation limit reached (${cap}); archive an unused tournament first`);
  const id = randomUUID(), inviteCode = newInviteCode(), now = new Date().toISOString();
  return transaction(() => {
    run(`INSERT INTO tournaments(id,name,description,owner_id,invite_hash,created_at,visibility,status,launch_opening_round,launch_expected_races,launch_year)
      VALUES(?,?,?,?,?,?,?,'active',?,?,?)`, id, safeName, safeDescription, user.id, inviteHash(inviteCode), now, safeVisibility, openingRound, expectedRaces, launchYear);
    run('INSERT INTO tournament_members VALUES(?,?,?,?)', id, user.id, 'commissioner', now);
    return {...requireTournament(user, id), inviteCode};
  });
}

/** Allow members of a public pool to join by ID without learning any private invitation. */
export function joinPublicTournament(user: User, tournamentId: string) {
  return transaction(() => {
    const t = get("SELECT id FROM tournaments WHERE id=? AND visibility='public' AND status='active'", tournamentId);
    if (!t) throw new HttpError(404, 'Public tournament not found');
    run("INSERT OR IGNORE INTO tournament_members VALUES(?,?,?,?)", tournamentId, user.id, 'player', new Date().toISOString());
    return requireTournament(user, tournamentId);
  });
}

/** Preview a valid invite without exposing the secret or any private tournament records. */
export function invitePreview(code: unknown) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new HttpError(404, 'Invitation not found');
  const t = get(`SELECT ${tournamentFields} FROM tournaments t WHERE t.invite_hash=? AND t.status='active'`, inviteHash(code));
  if (!t) throw new HttpError(404, 'Invitation not found');
  return {...t, terms: tournamentTerms(t.id)};
}

/** Join one active tournament using a secret link; repeat requests do not duplicate memberships. */
export function joinTournament(user: User, code: unknown) {
  return transaction(() => {
    const t = invitePreview(code);
    run("INSERT OR IGNORE INTO tournament_members VALUES(?,?,?,?)", t.id, user.id, 'player', new Date().toISOString());
    return requireTournament(user, t.id);
  });
}

/** Rotate the join link and revoke old shared invitations. */
export function rotateInvite(user: User, tournamentId: string) {
  requireCommissioner(user, tournamentId);
  const inviteCode = newInviteCode();
  run('UPDATE tournaments SET invite_hash=? WHERE id=?', inviteHash(inviteCode), tournamentId);
  return {inviteCode};
}

/** Update public/private visibility, archive status, and editable tournament metadata. */
export function amendTournament(user: User, tournamentId: string, changes: Record<string, unknown>) {
  const current = requireCommissioner(user, tournamentId);
  const name = changes.name === undefined ? current.name : tournamentName(changes.name);
  const description = changes.description === undefined ? current.description : descriptionValue(changes.description);
  const visibility = changes.visibility === undefined ? current.visibility : tournamentVisibility(changes.visibility);
  const status = changes.status === undefined ? current.status : changes.status;
  if (!['active', 'archived'].includes(String(status))) throw bad('Invalid tournament status');
  const mid = get("SELECT 1 FROM seasons WHERE tournament_id=? AND opening_round>1 LIMIT 1", tournamentId);
  if (mid && current.visibility !== 'public' && visibility === 'public' && !platformPolicy().allowPublicMidseason && !isOperator(user)) {
    throw new HttpError(403, 'Operator disabled new public mid-season tournaments; use invite-only visibility');
  }
  run('UPDATE tournaments SET name=?,description=?,visibility=?,status=? WHERE id=?', name, description, visibility, status, tournamentId);
  return requireTournament(user, tournamentId);
}

/** Search a small, non-sensitive directory of existing users by exact username prefix. */
export function searchUsers(user: User, tournamentId: string, query: string) {
  requireCommissioner(user, tournamentId);
  const term = String(query).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(term)) throw bad('Enter at least two username characters');
  return all(`SELECT u.id,u.username,u.display_name FROM users u WHERE lower(u.username) LIKE ? ESCAPE '\\'
    AND NOT EXISTS (SELECT 1 FROM tournament_members m WHERE m.tournament_id=? AND m.user_id=u.id)
    ORDER BY u.username LIMIT 10`, `${term.replace(/[\\%_]/g, '\\$&')}%`, tournamentId);
}

/** Invite an existing user once, without automatically adding them to a private tournament. */
export function inviteExistingUser(user: User, tournamentId: string, targetId: string) {
  requireCommissioner(user, tournamentId);
  const target = get('SELECT id,email,username,display_name FROM users WHERE id=?', targetId);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.id === user.id) throw bad('Cannot invite yourself');
  const t = get('SELECT status FROM tournaments WHERE id=?', tournamentId);
  if (t?.status !== 'active') throw new HttpError(409, 'Archived tournaments do not accept invitations');
  const recent = get('SELECT COUNT(*) AS count FROM tournament_user_invites WHERE invited_by=? AND created_at>?',
    user.id, new Date(Date.now() - 86400000).toISOString())?.count ?? 0;
  if (recent >= 50 && !isOperator(user)) throw new HttpError(429, 'Invitation quota reached for this account');
  if (get('SELECT 1 FROM tournament_members WHERE tournament_id=? AND user_id=?', tournamentId, targetId)) {
    throw new HttpError(409, 'User is already a participant');
  }
  return transaction(() => {
    const invitationId = randomUUID(), createdAt = new Date().toISOString();
    run(`INSERT INTO tournament_user_invites(id,tournament_id,user_id,invited_by,status,created_at)
      VALUES(?,?,?,?,'pending',?)
      ON CONFLICT(tournament_id,user_id) DO UPDATE SET invited_by=excluded.invited_by,status='pending',created_at=excluded.created_at`,
    invitationId, tournamentId, targetId, user.id, createdAt);
    return {tournamentId, userId: targetId, username: target.username, status: 'pending'};
  });
}

/** Return each authenticated user's invitations, never other users' pending invites. */
export function myInvitations(user: User) {
  return all(`SELECT i.id,i.tournament_id,t.name,t.visibility,i.created_at
    FROM tournament_user_invites i JOIN tournaments t ON t.id=i.tournament_id
    WHERE i.user_id=? AND i.status='pending' AND t.status='active'
    ORDER BY i.created_at DESC`, user.id).map(invite => ({...invite, terms: tournamentTerms(invite.tournament_id)}));
}

/** Accept or decline one invitation, checking that it is addressed to the current user. */
export function respondInvitation(user: User, invitationId: string, action: unknown) {
  if (action !== 'accept' && action !== 'decline') throw bad('Invalid invitation decision');
  return transaction(() => {
    const invite = get(`SELECT i.* FROM tournament_user_invites i JOIN tournaments t ON t.id=i.tournament_id
      WHERE i.id=? AND i.user_id=? AND i.status='pending' AND t.status='active'`, invitationId, user.id);
    if (!invite) throw new HttpError(404, 'Invitation not found');
    run('UPDATE tournament_user_invites SET status=? WHERE id=?', action === 'accept' ? 'accepted' : 'declined', invitationId);
    if (action === 'accept') {
      run("INSERT OR IGNORE INTO tournament_members VALUES(?,?,?,?)", invite.tournament_id, user.id, 'player', new Date().toISOString());
      return requireTournament(user, invite.tournament_id);
    }
    return {status: 'declined'};
  });
}

/** Check season access using the owning tournament and the global operator override. */
export function requireSeasonMember(user: User, seasonId: string) {
  const s = get('SELECT * FROM seasons WHERE id=?', seasonId);
  if (!s) throw new HttpError(404, 'Season not found');
  requireTournament(user, s.tournament_id);
  return s;
}

/** Require commissioner/operator permission over the season's owning tournament. */
export function requireSeasonCommissioner(user: User, seasonId: string) {
  const s = requireSeasonMember(user, seasonId);
  requireCommissioner(user, s.tournament_id);
  return s;
}
