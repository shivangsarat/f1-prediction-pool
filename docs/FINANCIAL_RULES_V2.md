# GRIDLOCK 2.0 — Rules, financial disclosure and implementation notes

## Authoritative references

- [Master System & Rules Design v2.0](specs/GRIDLOCK-master-v2.0.pdf) — 12 pages, complete rules and hosting/governance requirements.
- [Payout, Rake & Operator Controls Update v2.0](specs/GRIDLOCK-finance-delta-v2.0.pdf) — 12 pages, detailed delta, 20 alpha scenarios, interfaces and edge-case handling.
- [Original v1.0 specification](design-spec.pdf) remains for historical comparison.

The **v2.0 formulas and constraints are authoritative** where worked tables conflict with exact rounding or safety guards (see “Source arithmetic discrepancies”). F1 scoring, Sprint formats, championship predictions, UTC lock rules, and review-before-publication remain unchanged from v1.0.

## Tournament discovery and membership (clarification)

**Public tournaments:** appear in the public catalogue; participants may join from the catalogue **or from a valid invitation link or username invitation**. **Invite-only tournaments:** never appear in the public catalogue and can be joined **only through a valid invitation** (a rotating secret link or an invitation issued to an existing username). Invitation acceptance must not silently enrol a player; registration/sign-in must preserve the intended tournament destination.

The **global operator** may inspect and administer every tournament. Each creator/commissioner manages only their own tournament; ordinary participants see only the tournaments they have joined, plus public catalogue listings. API authorization, not UI navigation, enforces these boundaries. Every join/catalogue/invite acceptance must display **live server-derived financial terms**; email content is informational, not authoritative after a pre-lock configuration change.

## Governing financial settings

| Setting | Authority | Default | Lock / constraint |
| --- | --- | --- | --- |
| `platform_rake_enabled` | Global operator | OFF | Applies to unlocked seasons; locked seasons retain snapshots |
| `platform_rake_bps` | Global operator | 500 bps / 5% | 0–1500 basis points; operator has priority under combined cap |
| `allow_tournament_house_rake` | Global operator | OFF | Controls whether an unlocked creator can enable their house share |
| `payout_model` | Season commissioner | `adaptive-3tier` | `adaptive-3tier` or `poker`; frozen at Round 1 lock |
| `house_rake_enabled` | Season commissioner | OFF | Requires global permission; frozen at Round 1 lock |
| `house_rake_bps` | Season commissioner | 500 bps / 5% | 0–1500; active operator + active creator <=1500 |
| `poker_floor_enabled` | Season commissioner | ON | ON = full-entry minimum for paid places; OFF = loss-reduction |
| `poker_itm_pct` | Season commissioner | 20% | 15–50% integer; nominal ITM portion |
| `poker_alpha_mode` | Season commissioner | `auto` | `auto` or `manual` |
| `poker_alpha_manual` | Season commissioner | 1.50 | 0.50–2.50 |

For legacy v1.0 seasons, migrate to `adaptive-3tier`, with no operator or creator rake. The migration preserves existing historical scoring/ledger records. Global changes never retroactively alter locked seasons.

## Cent-exact money definitions

All values are integer cents; rake rates are **basis points**, 100 bps = 1%:

```text
Pgross = SUM(amount_cents) over ledger types buyin, refund and adjustment ONLY
operatorBps = enabled operator rate, else zero
creatorBps = permitted and enabled creator rate, else zero
operatorBps + creatorBps <= 1500
Hplat = floor(Pgross * operatorBps / 10000)
Hcreator = floor(Pgross * creatorBps / 10000)
Pnet = Pgross - Hplat - Hcreator
```

Never base rake or entitlement recalculation on remaining `cashCents`: payouts and both house disbursements reduce cash, **not** `Pgross`. `platform_rake` and `house_rake` are distinct ledger transaction types, disbursed at most up to their corresponding entitlements. The creator can be nonplaying and can still receive their creator fee; a playing creator pays the same full/prorated buy-in. No refunds greater than the payer's paid-in balance, no ledger overdraft, and no duplicate idempotency keys. House and player disbursements are frozen out until Round 1 locks; paid prizes must not exceed individually entitled amounts.

## Adaptive 3-Tier (v1 default)

Apply to **Pnet** using effective buy-in units `Neff = floor(Pgross / B)` (not player count):

- `Neff <= 3`: first place takes all (when zero pot, no payout).
- `4 <= Neff <= smallMax` (default 5): 75% to 1st, 25% to 2nd.
- `smallMax < Neff <= mediumMax` (default 10): 3rd receives one full entry B; 1st/2nd split 75%/25% of `Pnet - B`.
- Above medium tier: 65%/25%/10% for 1st/2nd/3rd.

**Inversion guard:** if medium-tier `Pnet < 5B`, use 65/25/10 when `Pnet >= 3B`, otherwise top-two 75/25. Always use cent-exact Hamilton allocation for proportional shares.

## Casino Poker (new v2 model)

- Effective entries `Neff = floor(Pgross / B)`; paid spots `k = 1` for `Neff <=3`, `2` for 4–5, `3` for 6–9, and `max(3, floor(ITM% * Neff))` for 10+. Cap at `Neff-1` for `Neff >=2`.
- For paid place `i`, weight `w_i = i^(-alpha)` and `S = Σ(w_i)` across places 1..k.
- **Floor ON:** decrement k while `Pnet <= k*B` and `k>1`; then allocate one full entry per paid place and distribute `(Pnet-kB)` by weights. When k=1, winner takes Pnet.
- **Floor OFF:** allocate all of Pnet by weights. Decrement k while final lowest-slot payout is below `B*0.25`, then recompute. Lower paid places may return less than the entry fee; label them “Loss-Reduction Spot”.
- Use **Hamilton / largest remainder** cent rounding with fractional-remainder ties favoring the better rank. Total allocated place amounts equals Pnet exactly.

**Auto α:** five factors, `clamp(alphaBase(Neff,floor) + raceAdjustment + stakeAdjustment + ITMAdjustment, .5, 2.5)`. Base by Neff: 4–6 ON 1.10/OFF .90; 7–15 1.40/1.20; 16–29 1.55/1.35; 30–59 1.75/1.50; >=60 1.95/1.65. Scheduled races 1–8: −.20/−.15, 9–16: 0, >=17: +.10. Stakes <= €15: +.10/+.05, €16–49: 0, >=€50: −.15. ITM 15–25%: 0, 26–35%: −.10, 36–50%: −.20. Manual mode uses the frozen 0.50–2.50 value instead.

## Ties, prorated entrants and prize visibility

After the scoring tie-breaker waterfall, combine the affected paid slots plus any zero-value slots, then split tied slots evenly with largest remainder. The entrant's paid-in fraction `s = min(1, paid/B)` caps their payout at `s * share`. Distribute surplus among fully paid winners; if all eligible winners are prorated, distribute the residual proportionally across them rather than leaving money in the pool. The projection separates **gross pot**, **operator rake**, **creator rake**, **net player pot**, **cash left**, **payout model**, **paid spots**, and **floor status**. An ITM-threshold increase can reduce first-place winnings; the UI displays that caveat.

## Source arithmetic discrepancies (explicitly recorded)

1. **20-player Floor-OFF at 5% rake, α=1.5, ITM=20%**: v2 delta p.5 / master p.8 illustrates payouts €113.70 / €40.20 / €21.88 / €14.22. Hamilton / largest-remainder rounding of the given weights and €190 net pot instead yields **€113.71 / €40.20 / €21.88 / €14.21**. Both total €190; code follows the specified Hamilton rule.
2. **80-player Floor-OFF / α=1.70 / 30% ITM / €10 entry / 5% rake**: delta p.8 scenario #20 states `24 → 20` paid places and last pays €2.61. Applying the specified 25%-of-entry dust guard to the stated power-law weights gives k20 last payout **€2.48**, which is below €2.50; the guard therefore reduces to **19 places**, with last payout approximately €2.71. Code follows the stated guard and weights, not this inconsistent illustrative row.

## Guardrails and non-goals

No rebuy, weekly bounty, PKO side-pot, mid-season ICM deal, or compounded rake. Platform and creator rake are each calculated independently from the **same gross pot**, not from one another. The app is a manual settlement ledger, **not** a payments processor. Production use involving real-money prize pools needs applicable legal and regulatory review; secure secrets and encrypted offsite backups before deployment.

## Regression verification

`npm test --prefix backend` covers monetary pure functions, migrations, tournament disclosure/join rules, admin permission checks, finance settings locks, cent exactness, refund/house disbursement limits, and core scoring. `npm test --prefix frontend`, `npm run build --prefix frontend` and both linters run in GitHub CI. See [API contract](API.md), [security](SECURITY.md), [architecture](ARCHITECTURE.md), and [operations](OPERATIONS.md).


## v2.1 mid-season eligibility and shared distribution

The active payout engine and all operator/creator rake rules remain unchanged. A new mid-season pool uses its **own** gross pot, participant count and standings; no funds may be moved from a previously locked pool. The exact number of future scheduled F1 rounds also informs Poker auto-steepness. Two-round or shorter pools are **free-only** (zero financial pot). Refer to [mid-season and cross-pool balancing](MIDSEASON_V2_1.md) for API fields, operator controls and scaled WDC/WCC scoring.
