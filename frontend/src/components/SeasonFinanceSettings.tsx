import {useEffect, useState} from 'react';
import {get, post, money} from '../api';
import {Notice, Select, FieldHelp} from '../shared/ui';
import {type PlatformPolicy} from './OperatorFinancePanel';
import {formatBps} from './FinancialTerms';

/** Controlled commissioner inputs, stored on each season rather than on the tournament metadata record. */
export type SeasonFinanceFields = {
  payoutModel: 'adaptive-3tier' | 'poker';
  houseRakeEnabled: boolean;
  houseRakeBps: number;
  pokerFloorEnabled: boolean;
  pokerItmPct: number;
  pokerAlphaMode: 'auto' | 'manual';
  pokerAlphaManual: number;
};

/** New seasons default to the v1 payout engine with both house rake layers switched off. */
export const defaultFinanceFields: SeasonFinanceFields = {
  payoutModel: 'adaptive-3tier', houseRakeEnabled: false, houseRakeBps: 500,
  pokerFloorEnabled: true, pokerItmPct: 20, pokerAlphaMode: 'auto', pokerAlphaManual: 1.5,
};

type Preview = {
  model: string; slotsCents: number[]; grossPotCents: number; platformRakeCents: number;
  creatorRakeCents: number; netPlayerPotCents: number; alpha: number | null; paidPlaces: number;
};

/** Season-level financial controls with a server-computed live payout preview and explicit safety caveats. */
export function SeasonFinanceSettings({season, form, onChange}: {
  season?: any; form: SeasonFinanceFields; onChange: (next: SeasonFinanceFields) => void;
}) {
  const [policy, setPolicy] = useState<PlatformPolicy | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');

  /** Read the global permission controlling creator rake before presenting editable controls. */
  useEffect(() => {void get<PlatformPolicy>('/finance-policy').then(setPolicy).catch((e: Error) => setError(e.message));}, []);

  /** Recompute the projected prize ladder whenever any of the financial toggles changes. */
  useEffect(() => {
    if (!season?.id || season.configLocked) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      post<Preview>('/admin/finance-preview', {seasonId: season.id, ...form})
        .then(value => {if (!cancelled) {setPreview(value); setError('');}})
        .catch((e: Error) => {if (!cancelled) {setPreview(null); setError(e.message);}});
    }, 250);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [season?.id, season?.configLocked, form]);

  const locked = !!season?.configLocked;
  const operatorBps = policy?.platformRakeEnabled ? policy.platformRakeBps : 0;
  const creatorHeadroom = 1500 - operatorBps;
  const creatorPermitted = policy?.allowTournamentHouseRake && creatorHeadroom > 0;

  /** Merge one season field while retaining unrelated settings and the selected payout model. */
  function change(next: Partial<SeasonFinanceFields>) {onChange({...form, ...next});}

  return <section className="season-finance-settings" aria-label="Season payout rules">
    <div className="divider-title">Prize distribution and fees · {locked ? 'Locked at first qualifying' : 'Locks at first qualifying'}</div>
    <p className="muted">Choose one engine per season. House fees apply to both payout models and are calculated from buy-ins minus refunds. Financial settings freeze at the first qualifying deadline.</p>
    <label className="input-label">Prize distribution model<FieldHelp label="Prize distribution model" detail="Choose classic Top 3 prizes or the Poker model, where more places may receive an award."/><Select disabled={locked} value={form.payoutModel} onChange={value => change({payoutModel: value as SeasonFinanceFields['payoutModel']})} options={[{value:'adaptive-3tier',label:'Adaptive 3-Tier · classic Top-3'},{value:'poker',label:'Casino Poker · scalable In The Money ladder'}]}/></label>
    <div className="form-grid">
      <label className="check-line"><input type="checkbox" disabled={locked || !creatorPermitted} checked={form.houseRakeEnabled} onChange={event=>change({houseRakeEnabled:event.target.checked})}/> Charge a tournament creator fee <FieldHelp label="Charge a tournament creator fee" detail="Take an optional fee for the person running this pool, subject to the platform 15% combined limit."/></label>
      <label className="input-label">Creator fee (basis points)<FieldHelp label="Creator fee (basis points)" detail="100 basis points equals 1% of net entry contributions; operator and creator combined cannot exceed 1500 points (15%)."/><input type="number" step="50" min="0" max={creatorHeadroom} disabled={locked || !creatorPermitted} value={form.houseRakeBps} onChange={event=>change({houseRakeBps:Number(event.target.value)})}/></label>
    </div>
    <p className="muted">Operator hosting fee: {formatBps(operatorBps)} · Maximum creator headroom: {formatBps(creatorHeadroom)} · Combined maximum 15%. Creator may compete if they pay the same buy-in; refunds reduce both rake shares.</p>
    {!creatorPermitted && <Notice>Creator rake is disabled by the global operator or the operator already uses the 15% cap.</Notice>}
    {form.payoutModel === 'poker' && <>
      <div className="form-grid">
        <label className="check-line"><input type="checkbox" disabled={locked} checked={form.pokerFloorEnabled} onChange={event=>change({pokerFloorEnabled:event.target.checked})}/> Guarantee paid players recover their entry <FieldHelp label="Guarantee paid players recover their entry" detail="When enabled, every paid prize must be at least a full entry fee; this may reduce the number of prize places."/></label>
        <label className="input-label">Players receiving prizes (%)<FieldHelp label="Players receiving prizes (%)" detail="Target share of paying participants receiving a prize (15–50%); the final number depends on pool size, rake and the minimum-cash floor."/><input type="number" disabled={locked} min="15" max="50" step="1" value={form.pokerItmPct} onChange={event=>change({pokerItmPct:Number(event.target.value)})}/></label>
        <label className="input-label">Prize curve<FieldHelp label="Prize curve" detail="Automatic distributes prizes based on the player count and race count; Manual lets you choose how top-heavy prizes are."/><Select disabled={locked} value={form.pokerAlphaMode} onChange={value=>change({pokerAlphaMode:value as SeasonFinanceFields['pokerAlphaMode']})} options={[{value:'auto',label:'Auto · N / races / stakes / ITM / floor'},{value:'manual',label:'Manual · fixed exponent'}]}/></label>
        {form.pokerAlphaMode==='manual' && <label className="input-label">Manual prize curve (0.50–2.50)<FieldHelp label="Manual prize curve (0.50–2.50)" detail="Controls how sharply awards decline by place. Higher values prioritize winners; lower values distribute prizes more evenly."/><input type="number" disabled={locked} min="0.5" max="2.5" step="0.05" value={form.pokerAlphaManual} onChange={event=>change({pokerAlphaManual:Number(event.target.value)})}/></label>}
      </div>
      {!form.pokerFloorEnabled && <Notice kind="error">Loss-Reduction Mode: lower paid positions may receive less than the entry fee. Spots below 25% of the entry are trimmed automatically.</Notice>}
      <p className="muted">Small pools of nine or fewer players use 1–3 paid spots. Wider ITM thresholds may slightly reduce first-place prizes.</p>
    </>}
    {preview && <div className="finance-preview" aria-label="Projected payout ladder"><h4>Live projection · {preview.model}</h4><p>Gross: {money(preview.grossPotCents, season.currency)} · Operator: {money(preview.platformRakeCents, season.currency)} · Creator: {money(preview.creatorRakeCents, season.currency)} · Net: {money(preview.netPlayerPotCents, season.currency)}</p>
      {form.payoutModel==='poker' && <p>Resolved α: <strong>{preview.alpha ?? 'N/A (winner-take-all)'}</strong> · Paid spots: {preview.paidPlaces}</p>}
      <ol>{preview.slotsCents.map((amount,index)=><li key={index}>#{index+1} · {money(amount,season.currency)} {form.payoutModel==='poker' && !form.pokerFloorEnabled && amount < season.base_entry_cents ? '· Loss-Reduction Spot' : ''}</li>)}</ol>
    </div>}
    {!season && <Notice>Create a season to enable the live payout preview.</Notice>}
    {locked && <Notice>Round 1 has locked. These controls are read-only for historical fairness.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
  </section>;
}
