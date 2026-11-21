import {rankWithTies, isSameRank, type PaymentEligibility, type RankingRow} from './rules.ts';

/** The season's immutable financial settings after Round 1 begins. Monetary fields are integer cents. */
export interface FinanceConfig {
  payoutModel: 'adaptive-3tier' | 'poker';
  platformRakeBps: number;
  creatorRakeBps: number;
  baseEntryCents: number;
  smallMax: number;
  mediumMax: number;
  pokerFloorEnabled: boolean;
  pokerItmPct: number;
  pokerAlphaMode: 'auto' | 'manual';
  pokerAlphaManual: number;
  scheduledRaces: number;
}

/** One append-only financial ledger entry. A refund/payout is a negative amount. */
export interface FinanceEntry {
  type: string;
  amount_cents: number;
}

/** A player's rank, prorated eligibility, and eventual cent-exact share of the prize ladder. */
export interface FinancePrize {
  userId: string;
  rank: number;
  amountCents: number;
  capCents: number;
  eligibleFraction: number;
}

/** The complete immutable mathematical projection; recorded disbursements are reported separately. */
export interface FinancePlan {
  model: string;
  potCents: number;
  grossPotCents: number;
  platformRakeCents: number;
  creatorRakeCents: number;
  netPlayerPotCents: number;
  slotsCents: number[];
  prizes: FinancePrize[];
  participants: number;
  effectiveUnits: number;
  paidPlaces: number;
  alpha: number | null;
  floorEnabled: boolean | null;
  payoutModel: FinanceConfig['payoutModel'];
  undistributedCents: number;
}

/** Enforce integral cents and integer basis-point inputs before monetary arithmetic. */
export function validateFinanceConfig(config: FinanceConfig): void {
  if (!Number.isSafeInteger(config.baseEntryCents) || config.baseEntryCents < 0) throw Error('Invalid base entry');
  if (![config.platformRakeBps, config.creatorRakeBps].every(v => Number.isInteger(v) && v >= 0 && v <= 1500)) throw Error('Invalid house rake');
  if (config.platformRakeBps + config.creatorRakeBps > 1500) throw Error('Combined house rake cannot exceed 15%');
  if (!['poker', 'adaptive-3tier'].includes(config.payoutModel)) throw Error('Invalid payout engine');
  if (!Number.isInteger(config.pokerItmPct) || config.pokerItmPct < 15 || config.pokerItmPct > 50) throw Error('Poker ITM must be 15–50%');
  if (!['auto', 'manual'].includes(config.pokerAlphaMode) || !Number.isFinite(config.pokerAlphaManual) || config.pokerAlphaManual < .5 || config.pokerAlphaManual > 2.5) throw Error('Poker steepness must be 0.50–2.50');
  if (!Number.isInteger(config.scheduledRaces) || config.scheduledRaces < 0) throw Error('Invalid race count');
  if (!Number.isInteger(config.smallMax) || !Number.isInteger(config.mediumMax) || config.smallMax < 3 || config.mediumMax <= config.smallMax) throw Error('Invalid payout cutoffs');
}

/** Only buy-ins, refunds and adjustments establish the gross pot; rake and payouts never affect it. */
export function grossFromEntries(entries: FinanceEntry[]): number {
  const gross = entries.reduce((sum, entry) => {
    if (!Number.isSafeInteger(entry.amount_cents)) throw Error('Ledger amount must be integral cents');
    return sum + (['buyin', 'refund', 'adjustment'].includes(entry.type) ? entry.amount_cents : 0);
  }, 0);
  if (!Number.isSafeInteger(gross) || gross < 0) throw Error('Gross contributions cannot be negative');
  return gross;
}

/** Compute two independent rake entitlements, flooring each to whole cents. */
export function calculateRake(grossCents: number, platformBps: number, creatorBps: number) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0 || ![platformBps, creatorBps].every(v => Number.isInteger(v) && v >= 0) || platformBps + creatorBps > 1500) throw Error('Invalid gross pot or combined rake');
  const platformRakeCents = Math.floor(grossCents * platformBps / 10000);
  const creatorRakeCents = Math.floor(grossCents * creatorBps / 10000);
  return {platformRakeCents, creatorRakeCents, netPlayerPotCents: grossCents - platformRakeCents - creatorRakeCents};
}

/** Resolve the deterministic five-step, season-length/stakes/ITM/floor-adjusted poker curve. */
export function resolveAlpha(config: FinanceConfig, effectiveUnits: number): number | null {
  if (effectiveUnits <= 3) return null;
  if (config.pokerAlphaMode === 'manual') return config.pokerAlphaManual;
  const floor = config.pokerFloorEnabled;
  const baseline = effectiveUnits <= 6 ? (floor ? 1.10 : .90)
    : effectiveUnits <= 15 ? (floor ? 1.40 : 1.20)
    : effectiveUnits <= 29 ? (floor ? 1.55 : 1.35)
    : effectiveUnits <= 59 ? (floor ? 1.75 : 1.50) : (floor ? 1.95 : 1.65);
  const races = config.scheduledRaces <= 8 ? (floor ? -.20 : -.15) : config.scheduledRaces <= 16 ? 0 : .10;
  const stakes = config.baseEntryCents <= 1500 ? (floor ? .10 : .05) : config.baseEntryCents >= 5000 ? -.15 : 0;
  const itm = config.pokerItmPct <= 25 ? 0 : config.pokerItmPct <= 35 ? -.10 : -.20;
  return Math.round(Math.min(2.5, Math.max(.5, baseline + races + stakes + itm)) * 100) / 100;
}

/** Hamilton (largest fractional remainder) allocation preserves every cent and favors higher ranks on ties. */
export function allocateCents(amount: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || !weights.length || weights.some(w => !Number.isFinite(w) || w < 0)) throw Error('Invalid cent allocation');
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw Error('At least one weight is required');
  const raw = weights.map(w => amount * w / total);
  const paid = raw.map(v => Math.floor(v));
  const left = amount - paid.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) => (raw[b] - Math.floor(raw[b])) - (raw[a] - Math.floor(raw[a])) || a - b);
  for (let i = 0; i < left; i++) paid[order[i]]++;
  return paid;
}

/** Resolve number of paid poker places, with small-field rules, entry-floor and 25% dust safety guards. */
export function pokerSlots(netCents: number, config: FinanceConfig, effectiveUnits: number, alpha: number | null): number[] {
  if (!effectiveUnits || !netCents) return [];
  let k = effectiveUnits <= 3 ? 1 : effectiveUnits <= 5 ? 2 : effectiveUnits <= 9 ? 3 : Math.max(3, Math.floor(config.pokerItmPct * effectiveUnits / 100));
  k = Math.min(k, Math.max(1, effectiveUnits - 1));
  const exponent = alpha ?? 1.5;
  const weights = (size: number) => Array.from({length: size}, (_, i) => (i + 1) ** -exponent);
  if (config.pokerFloorEnabled) {
    while (k > 1 && netCents <= k * config.baseEntryCents) k--;
    if (k === 1) return [netCents];
    const extras = allocateCents(netCents - k * config.baseEntryCents, weights(k));
    return extras.map(v => v + config.baseEntryCents);
  }
  while (k > 1) {
    const weightsForK = weights(k);
    const rawLastPlace = netCents * weightsForK[k - 1] / weightsForK.reduce((sum, weight) => sum + weight, 0);
    // The safety condition uses the unrounded last-place weight, never a cent-rounded approximation.
    if (rawLastPlace >= config.baseEntryCents * .25) return allocateCents(netCents, weightsForK);
    k--;
  }
  return [netCents];
}

/** Preserve classic v1 tiers; when rake would invert second and third places, use the documented fallback. */
export function adaptiveSlots(netCents: number, config: FinanceConfig, effectiveUnits: number): {model: string; slots: number[]} {
  if (!effectiveUnits || !netCents) return {model: 'No paid players', slots: []};
  if (effectiveUnits <= 3) return {model: 'Winner takes all', slots: [netCents]};
  if (effectiveUnits <= config.smallMax) return {model: '75/25 top two', slots: allocateCents(netCents, [.75, .25])};
  if (effectiveUnits <= config.mediumMax) {
    if (netCents < 3 * config.baseEntryCents) return {model: 'Inversion guard: 75/25 top two', slots: allocateCents(netCents, [.75, .25])};
    if (netCents < 5 * config.baseEntryCents) return {model: 'Inversion guard: 65/25/10', slots: allocateCents(netCents, [.65, .25, .10])};
    const third = config.baseEntryCents;
    const top = allocateCents(netCents - third, [.75, .25]);
    return {model: 'Third refund + 75/25 remainder', slots: [...top, third]};
  }
  return {model: '65/25/10', slots: allocateCents(netCents, [.65, .25, .10])};
}

/** Combine unresolved prize-slot ties (including unpaid bubble positions) before applying entry proration. */
export function tiedSlotShares(rows: RankingRow[], slots: number[]): Map<string, {rank: number; amount: number}> {
  const tied = rankWithTies(rows);
  const shares = new Map<string, {rank: number; amount: number}>();
  for (let i = 0; i < tied.length;) {
    let next = i + 1;
    while (next < tied.length && isSameRank(tied[i], tied[next])) next++;
    const sum = tied.slice(i, next).reduce((total, _, index) => total + (slots[i + index] ?? 0), 0);
    const split = sum ? allocateCents(sum, Array(next - i).fill(1)) : Array(next - i).fill(0);
    for (let at = i; at < next; at++) shares.set(tied[at].userId, {rank: i + 1, amount: split[at - i]});
    i = next;
  }
  return shares;
}

/** Cap prorated prizes, redistribute surplus to fully paid winners, or release caps if all paid winners are prorated. */
export function applyProration(rows: RankingRow[], members: PaymentEligibility[], slots: number[], fullEntryCents: number): FinancePrize[] {
  const eligible = new Map(members.filter(m => m.contributionCents > 0).map(m => [m.userId, m.contributionCents]));
  const shares = tiedSlotShares(rows.filter(r => eligible.has(r.userId)), slots);
  const prizes: FinancePrize[] = [];
  for (const [userId, share] of shares) {
    const fraction = Math.min(1, eligible.get(userId)! / fullEntryCents);
    const cap = Math.floor(share.amount * fraction);
    prizes.push({userId, rank: share.rank, amountCents: cap, capCents: cap, eligibleFraction: fraction});
  }
  const total = slots.reduce((s, v) => s + v, 0);
  const remaining = total - prizes.reduce((s, p) => s + p.amountCents, 0);
  if (remaining <= 0) return prizes;
  let candidates = prizes.filter(p => p.capCents > 0 && p.eligibleFraction === 1);
  if (!candidates.length) candidates = prizes.filter(p => p.capCents > 0);
  if (!candidates.length) return prizes;
  const extras = allocateCents(remaining, candidates.map(p => p.eligibleFraction === 1 ? p.capCents : eligible.get(p.userId)!));
  candidates.forEach((p, i) => {p.amountCents += extras[i];});
  return prizes;
}

/** Produce both house entitlements and the complete paid-place allocation from the gross contribution pot. */
export function financePlan(rows: RankingRow[], members: PaymentEligibility[], grossCents: number, config: FinanceConfig): FinancePlan {
  validateFinanceConfig(config);
  // Free/fun tournaments may run even when only one or two real F1 races remain.
  // They cannot have any collected money, rake, or prize liability.
  if (config.baseEntryCents === 0) {
    if (grossCents !== 0) throw Error('Free tournaments cannot carry a money pot');
    return {model: 'Free tournament · no payout',potCents:0,grossPotCents:0,platformRakeCents:0,
      creatorRakeCents:0,netPlayerPotCents:0,slotsCents:[],prizes:[],participants:0,
      effectiveUnits:0,paidPlaces:0,alpha:null,floorEnabled:null,payoutModel:config.payoutModel,undistributedCents:0};
  }
  const rake = calculateRake(grossCents, config.platformRakeBps, config.creatorRakeBps);
  const effectiveUnits = Math.floor(grossCents / config.baseEntryCents);
  const participants = members.filter(m => m.contributionCents > 0).length;
  const alpha = config.payoutModel === 'poker' ? resolveAlpha(config, effectiveUnits) : null;
  const modelSlots = config.payoutModel === 'poker'
    ? {model: `Poker ${config.pokerFloorEnabled ? 'Floor ON' : 'Loss-Reduction'}`, slots: pokerSlots(rake.netPlayerPotCents, config, effectiveUnits, alpha)}
    : adaptiveSlots(rake.netPlayerPotCents, config, effectiveUnits);
  const prizes = applyProration(rows, members, modelSlots.slots, config.baseEntryCents);
  return {
    model: modelSlots.model, potCents: rake.netPlayerPotCents, grossPotCents: grossCents,
    platformRakeCents: rake.platformRakeCents, creatorRakeCents: rake.creatorRakeCents,
    netPlayerPotCents: rake.netPlayerPotCents, slotsCents: modelSlots.slots, prizes,
    participants, effectiveUnits, paidPlaces: modelSlots.slots.length, alpha,
    floorEnabled: config.payoutModel === 'poker' ? config.pokerFloorEnabled : null,
    payoutModel: config.payoutModel,
    undistributedCents: rake.netPlayerPotCents - prizes.reduce((sum, p) => sum + p.amountCents, 0),
  };
}
