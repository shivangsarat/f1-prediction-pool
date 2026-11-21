import {all, get, run, transaction} from './db.ts';
import {type FinanceConfig, financePlan, grossFromEntries} from './finance.ts';
import {locked} from './rules.ts';

/** Persisted platform policy; disabled rates retain their defaults for later re-enablement. */
export interface PlatformPolicy {
  platformRakeEnabled: boolean;
  platformRakeBps: number;
  allowTournamentHouseRake: boolean;
}

/** Return the operator's global controls, without disclosing any credentials. */
export function platformPolicy(): PlatformPolicy {
  const row = get('SELECT * FROM platform_finance WHERE id=1');
  return {
    platformRakeEnabled: !!row?.platform_rake_enabled,
    platformRakeBps: row?.platform_rake_bps ?? 500,
    allowTournamentHouseRake: !!row?.allow_tournament_house_rake,
  };
}

/** Reject globally invalid platform percentages and toggles before writing them. */
export function validatePlatformPolicy(policy: PlatformPolicy): void {
  if (typeof policy.platformRakeEnabled !== 'boolean' || typeof policy.allowTournamentHouseRake !== 'boolean' || !Number.isInteger(policy.platformRakeBps) || policy.platformRakeBps < 0 || policy.platformRakeBps > 1500) {
    throw Error('Invalid platform rake settings');
  }
}

/** Persist operator changes atomically after snapshotting any newly locked historic seasons. */
export function updatePlatformPolicy(patch: Partial<PlatformPolicy>): PlatformPolicy {
  const current = platformPolicy();
  const next = {...current, ...patch};
  validatePlatformPolicy(next);
  return transaction(() => {
    snapshotLockedSeasons();
    run(`UPDATE platform_finance SET platform_rake_enabled=?,platform_rake_bps=?,allow_tournament_house_rake=?,updated_at=? WHERE id=1`,
      next.platformRakeEnabled ? 1 : 0, next.platformRakeBps, next.allowTournamentHouseRake ? 1 : 0, new Date().toISOString());
    return next;
  });
}

/** Determine whether the first weekend's Sprint or main qualifying deadline has already passed. */
export function financeIsLocked(seasonId: string): boolean {
  const first = get('SELECT is_sprint,sprint_qualifying_at,qualifying_at FROM weekends WHERE season_id=? ORDER BY round ASC LIMIT 1', seasonId);
  return !!first && locked(first.is_sprint ? first.sprint_qualifying_at : first.qualifying_at);
}

/** Capture platform and creator rake at Round 1 and preserve the original terms after later policy edits. */
export function snapshotFinance(seasonId: string): void {
  const season = get('SELECT * FROM seasons WHERE id=?', seasonId);
  if (!season || season.platform_rake_bps_snapshot !== null || !financeIsLocked(seasonId)) return;
  const policy = platformPolicy();
  const operator = policy.platformRakeEnabled ? policy.platformRakeBps : 0;
  const creator = policy.allowTournamentHouseRake && season.house_rake_enabled ? Math.min(season.house_rake_bps, 1500 - operator) : 0;
  if (operator + creator > 1500) throw Error('Locked season exceeds the combined 15% house rake cap');
  run('UPDATE seasons SET platform_rake_bps_snapshot=?,house_rake_bps_snapshot=?,finance_locked_at=? WHERE id=? AND platform_rake_bps_snapshot IS NULL',
    operator, creator, new Date().toISOString(), seasonId);
}

/** Reconcile all unsnapshotted locked seasons before a global operator policy mutation. */
export function snapshotLockedSeasons(): void {
  for (const season of all('SELECT id FROM seasons WHERE platform_rake_bps_snapshot IS NULL')) snapshotFinance(season.id);
}

/** Resolve the effective season config from the live global policy or its immutable Round-1 snapshot. */
export function seasonFinanceConfig(seasonId: string): FinanceConfig & {configLocked: boolean} {
  snapshotFinance(seasonId);
  const season = get('SELECT * FROM seasons WHERE id=?', seasonId);
  if (!season) throw Error('Season not found');
  const lockedNow = financeIsLocked(seasonId);
  const policy = platformPolicy();
  const operator = lockedNow ? (season.platform_rake_bps_snapshot ?? 0) : (policy.platformRakeEnabled ? policy.platformRakeBps : 0);
  const creator = lockedNow ? (season.house_rake_bps_snapshot ?? 0) : (season.house_rake_enabled && policy.allowTournamentHouseRake ? Math.min(season.house_rake_bps, 1500 - operator) : 0);
  return {
    configLocked: lockedNow,
    payoutModel: season.payout_model ?? 'adaptive-3tier',
    platformRakeBps: operator,
    creatorRakeBps: creator,
    baseEntryCents: season.base_entry_cents,
    smallMax: season.small_max,
    mediumMax: season.medium_max,
    pokerFloorEnabled: !!season.poker_floor_enabled,
    pokerItmPct: season.poker_itm_pct ?? 20,
    pokerAlphaMode: season.poker_alpha_mode ?? 'auto',
    pokerAlphaManual: season.poker_alpha_manual ?? 1.5,
    scheduledRaces: get('SELECT COUNT(*) AS count FROM weekends WHERE season_id=?', seasonId)?.count ?? 0,
  };
}

/** Select the active season's live financial terms without exposing private tournament membership data. */
export function tournamentTerms(tournamentId: string) {
  const season = get('SELECT id,currency,base_entry_cents,year FROM seasons WHERE tournament_id=? ORDER BY year DESC LIMIT 1', tournamentId);
  if (!season) return {configured: false, warning: 'No season has been configured; confirm terms before buying in.'};
  const config = seasonFinanceConfig(season.id);
  return {
    configured: true,
    seasonId: season.id,
    year: season.year,
    currency: season.currency,
    baseEntryCents: season.base_entry_cents,
    payoutModel: config.payoutModel,
    platformRakeBps: config.platformRakeBps,
    creatorRakeBps: config.creatorRakeBps,
    totalRakeBps: config.platformRakeBps + config.creatorRakeBps,
    pokerFloorEnabled: config.payoutModel === 'poker' ? config.pokerFloorEnabled : null,
    pokerItmPct: config.payoutModel === 'poker' ? config.pokerItmPct : null,
    configLocked: config.configLocked,
    warning: 'Financial settings freeze at Round 1 Qualifying lock; confirm live terms before joining or paying.',
  };
}

/** Validate season financial configuration, including operator priority within the combined cap. */
export function validateSeasonFinanceChanges(seasonId: string, changes: Record<string, unknown>) {
  const s = get('SELECT * FROM seasons WHERE id=?', seasonId);
  if (!s) throw Error('Season not found');
  const policy = platformPolicy();
  const payoutModel = changes.payoutModel ?? s.payout_model;
  const houseRakeEnabled = changes.houseRakeEnabled ?? !!s.house_rake_enabled;
  const houseRakeBps = changes.houseRakeBps ?? s.house_rake_bps;
  const pokerFloorEnabled = changes.pokerFloorEnabled ?? !!s.poker_floor_enabled;
  const pokerItmPct = changes.pokerItmPct ?? s.poker_itm_pct;
  const pokerAlphaMode = changes.pokerAlphaMode ?? s.poker_alpha_mode;
  const pokerAlphaManual = changes.pokerAlphaManual ?? s.poker_alpha_manual;
  if (typeof houseRakeEnabled !== 'boolean' || typeof pokerFloorEnabled !== 'boolean' || !Number.isInteger(houseRakeBps) || houseRakeBps < 0 || houseRakeBps > 1500) throw Error('Invalid season rake configuration');
  if (houseRakeEnabled && !policy.allowTournamentHouseRake) throw Error('Tournament house rake is disabled by the platform operator');
  const operatorBps = policy.platformRakeEnabled ? policy.platformRakeBps : 0;
  if (houseRakeEnabled && operatorBps + houseRakeBps > 1500) throw Error('Operator and creator rake cannot exceed 15% combined');
  const config: FinanceConfig = {
    payoutModel: payoutModel as FinanceConfig['payoutModel'], platformRakeBps: operatorBps,
    creatorRakeBps: houseRakeEnabled ? houseRakeBps as number : 0,
    baseEntryCents: s.base_entry_cents, smallMax: s.small_max, mediumMax: s.medium_max,
    pokerFloorEnabled: pokerFloorEnabled as boolean, pokerItmPct: pokerItmPct as number,
    pokerAlphaMode: pokerAlphaMode as FinanceConfig['pokerAlphaMode'], pokerAlphaManual: pokerAlphaManual as number,
    scheduledRaces: 0,
  };
  // The pure engine validates the complete set (percentages, exponent, and payout selector).
  financePlan([], [], 0, config);
  return {payoutModel, houseRakeEnabled, houseRakeBps, pokerFloorEnabled, pokerItmPct, pokerAlphaMode, pokerAlphaManual};
}

/** Produce a financial projection against contributions, deliberately ignoring prior disbursements. */
export function financeProjection(seasonId: string, standings: any[], members: any[]) {
  const rows = all('SELECT type,amount_cents FROM ledger WHERE season_id=?', seasonId);
  const gross = grossFromEntries(rows);
  return financePlan(standings, members, gross, seasonFinanceConfig(seasonId));
}
