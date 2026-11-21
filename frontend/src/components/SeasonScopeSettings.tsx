import {Notice} from '../shared/ui';

/** Server-persisted opening-round policy selected by the commissioner before qualifying locks. */
export type SeasonScopeFields = {
  openingRound: number;
  expectedRaces: number;
  championshipEnabled: boolean;
  salvageEnabled: boolean;
};

/** Show race-count-based championship scaling and conditional August salvage rules. */
export function SeasonScopeSettings({value, onChange, locked}: {
  value: SeasonScopeFields; onChange: (next: SeasonScopeFields) => void; locked?: boolean;
}) {
  const mid = value.openingRound > 1;
  const bonus = mid ? Math.round(25 * value.expectedRaces / 24) : 25;
  const penalty = mid ? Math.round(15 * value.expectedRaces / 24) : 15;
  const warnPaid = mid && value.expectedRaces < 3;

  /** Change independent options while clearing salvage when championship picks are turned off. */
  function patch(next: Partial<SeasonScopeFields>) {
    const merged = {...value,...next};
    if (!merged.championshipEnabled) merged.salvageEnabled = false;
    onChange(merged);
  }

  return <fieldset className="season-scope-settings" aria-label="Season scope settings">
    <legend className="divider-title">TOURNAMENT RACE SCOPE & CHAMPIONSHIP</legend>
    <div className="form-grid">
      <label className="input-label">OPENING F1 ROUND
        <input type="number" aria-label="Opening F1 round" min={1} max={40} disabled={locked} value={value.openingRound} onChange={e => patch({openingRound:Number(e.target.value)})}/>
      </label>
      <label className="input-label">SCHEDULED RACES
        <input type="number" aria-label="Scheduled races" min={0} max={40} disabled={locked} value={value.expectedRaces} onChange={e => patch({expectedRaces:Number(e.target.value)})}/>
      </label>
    </div>
    <label className="check-line"><input type="checkbox" disabled={locked} checked={value.championshipEnabled} onChange={e => patch({championshipEnabled:e.target.checked})}/> Enable WDC/WCC championship predictions</label>
    <label className="check-line"><input type="checkbox" disabled={locked || !value.championshipEnabled} checked={value.salvageEnabled} onChange={e => patch({salvageEnabled:e.target.checked})}/> Enable August summer-break salvage (only if at least four scheduled rounds finish before August)</label>
    <Notice>{mid ? `Mid-Season · Starts R${value.openingRound} · ${value.expectedRaces} Races.` : 'Full Season.'}
      {' '}{value.championshipEnabled ? `Correct championship picks earn +${bonus} points each.` : 'Pure Race-by-Race Mode — no championship bonuses.'}
      {' '}{value.salvageEnabled ? `Changed picks cost −${penalty} points each after August salvage.` : 'August salvage is disabled.'}
    </Notice>
    {warnPaid && <Notice kind="error">Fewer than three races remain. Only free/fun tournaments with a zero entry fee can launch.</Notice>}
    {mid && value.expectedRaces < 10 && value.championshipEnabled && <Notice kind="error">Mid-season championship picks need at least 10 pre-August races. Switch to Pure Race-by-Race Mode.</Notice>}
  </fieldset>;
}
