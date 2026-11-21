/**
 * Mid-season fairness and eligibility policy shared by API configuration and scoring.
 * All timestamps are server-side UTC and all round numbers refer to real F1 rounds.
 */

import {bad, HttpError} from './auth.ts';

export type SeasonScope = 'full' | 'mid';

/** Determine the scope from the opening championship round, not the date of creation. */
export function seasonScope(openingRound: number): SeasonScope {
  return openingRound === 1 ? 'full' : 'mid';
}

/**
 * Resolve an ISO timestamp for the actual first qualifying session, including Sprint qualifying.
 * @param weekend - First weekend in the local tournament calendar.
 */
export function openingQualifying(weekend: {is_sprint?: boolean | number; qualifying_at: string; sprint_qualifying_at?: string | null}): string {
  return weekend.is_sprint ? (weekend.sprint_qualifying_at ?? weekend.qualifying_at) : weekend.qualifying_at;
}

/**
 * Scale a season bonus or salvage penalty by remaining scheduled rounds.
 * Full-season pools preserve the original values, and mid-season pools use round-to-nearest.
 */
export function scaledSeasonPoints(openingRound: number, scheduledRaces: number): {championshipBonus: number; salvagePenalty: number} {
  if (openingRound === 1) return {championshipBonus: 25, salvagePenalty: 15};
  return {championshipBonus: Math.round(25 * scheduledRaces / 24), salvagePenalty: Math.round(15 * scheduledRaces / 24)};
}

/**
 * Calculate the eligibility and warning text shown before players pay to join a mid-season pool.
 * @param openingRound - First real F1 round in this tournament (not normalized to one).
 * @param scheduledRaces - Remaining rounds in this tournament.
 * @param startsBeforeAugust - Whether the first qualifying session occurs before August UTC.
 * @param qualifyingBeforeAugust - Number of tournament rounds that have a race finish before August.
 */
export function midseasonPreview(openingRound: number, scheduledRaces: number, startsBeforeAugust: boolean, qualifyingBeforeAugust: number) {
  const scope = seasonScope(openingRound);
  const scaled = scaledSeasonPoints(openingRound, scheduledRaces);
  const allowChampionship = scope === 'full' || (startsBeforeAugust && scheduledRaces >= 10);
  const allowSalvage = scope === 'full' || (startsBeforeAugust && qualifyingBeforeAugust >= 4);
  return {
    scope, openingRound, scheduledRaces, paidAllowed: scheduledRaces >= 3,
    allowChampionship, allowSalvage,
    defaultChampionshipEnabled: scope === 'full',
    defaultSalvageEnabled: scope === 'full',
    ...scaled,
    label: scope === 'full' ? 'Full Season' : `Mid-Season · Starts R${openingRound} · ${scheduledRaces} Races`,
    warning: scheduledRaces < 3 ? 'Fewer than three rounds remain: free/fun tournaments only (zero entry fee).' :
      (scope === 'mid' ? 'Mid-season pools never transfer points, entries or buy-ins from existing tournaments.' : ''),
  };
}

/**
 * Validate paid-entry and championship mode rules before they become immutable at the opening lock.
 * An unknown calendar count prevents paid buy-ins until the calendar is configured.
 */
export function validateMidseasonConfiguration(input: {
  openingRound: number; scheduledRaces: number; baseEntryCents: number;
  championshipEnabled: boolean; salvageEnabled: boolean;
  startsBeforeAugust: boolean; completedBeforeAugust: number;
}): ReturnType<typeof midseasonPreview> {
  const {openingRound, scheduledRaces, baseEntryCents, championshipEnabled, salvageEnabled, startsBeforeAugust, completedBeforeAugust} = input;
  if (!Number.isInteger(openingRound) || openingRound < 1 || openingRound > 40 || !Number.isInteger(scheduledRaces) || scheduledRaces < 0 || scheduledRaces > 40) {
    throw bad('Invalid opening round or scheduled race count');
  }
  const preview = midseasonPreview(openingRound, scheduledRaces, startsBeforeAugust, completedBeforeAugust);
  if (scheduledRaces > 0 && baseEntryCents > 0 && !preview.paidAllowed) {
    throw new HttpError(409, 'Paid tournaments require at least three future rounds');
  }
  if (championshipEnabled && !preview.allowChampionship) {
    throw new HttpError(409, 'Championship picks require full-season scope or at least ten pre-August remaining rounds');
  }
  if (salvageEnabled && (!championshipEnabled || !preview.allowSalvage)) {
    throw new HttpError(409, 'Salvage requires championship predictions and at least four rounds finishing before August');
  }
  return preview;
}

/**
 * Validate an optional salvage interval against the season year and UTC clock.
 * A newly activated window must still be in the future; archived seasons are
 * not changed retroactively by this check.
 * @param year - The F1 season year, not the browser's currently selected year.
 * @param start - UTC timestamp at the beginning of the August seven-day window.
 * @param end - UTC timestamp exactly seven days after start.
 * @param evaluatedAt - UTC creation/amendment time, injectable for deterministic tests.
 */
export function validateSalvageWindow(year: number, start: string, end: string, evaluatedAt = Date.now()): void {
  const from = Date.parse(start);
  const until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until - from !== 7 * 86400000 ||
      new Date(from).getUTCFullYear() !== year || new Date(until).getUTCFullYear() !== year ||
      new Date(from).getUTCMonth() !== 7 || new Date(until).getUTCMonth() !== 7) {
    throw bad('Salvage must be exactly seven days entirely inside August UTC of the selected season year');
  }
  if (evaluatedAt >= from) {
    throw new HttpError(409, 'The August salvage window has already begun or passed; disable salvage for this new tournament');
  }
}

/** Return the effective priority tier for an encrypted transactional-email outbox event. */
export function notificationPriority(eventKey: string): number {
  if (/^(locked:|result:|champions:|verification:|verify:)/.test(eventKey)) return 100;
  if (/^(created:|joined:|verified-member:|season:)/.test(eventKey)) return 60;
  if (/^(invited:|invite:)/.test(eventKey)) return 10;
  return 50;
}
