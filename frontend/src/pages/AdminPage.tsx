import {useEffect, useState} from 'react';
import {BarChart3, Database, Flag, Plus, RefreshCw, Save, Settings, Shield, ShieldCheck, Trophy} from 'lucide-react';
import {get, post, put, patch, date} from '../api';
import {Card, SectionHeading, Pill, TextInput, Notice, Select, Action} from '../shared/ui';
import {SeasonFinanceSettings, defaultFinanceFields, type SeasonFinanceFields} from '../components/SeasonFinanceSettings';
import {SeasonScopeSettings, type SeasonScopeFields} from '../components/SeasonScopeSettings';
import {isoToUtcField, postAugustMidseason, suggestedAugustWindow, utcFieldToIso} from '../components/seasonDates';
/** Configure a specific tournament’s seasons, OpenF1 results, immutable scoring, ledgers and audit trail. */
export function AdminPage({season, seasons, weekends, users, refresh, toast, tournamentId, isOperator}: {season: any; seasons: any[]; weekends: any[]; users: any[]; refresh: () => void; toast: (x: string) => void; tournamentId: string; isOperator: boolean}) {

  const [financeForm, setFinanceForm] = useState<SeasonFinanceFields>(defaultFinanceFields);
  const [scopeForm, setScopeForm] = useState<SeasonScopeFields>({openingRound:1,expectedRaces:24,championshipEnabled:true,salvageEnabled:true});
  const [tab, setTab] = useState('setup'), [busy, setBusy] = useState(false), [year, setYear] = useState(String(new Date().getFullYear() + 1)), [sprintMode, setSprintMode] = useState('two-form'), [entry, setEntry] = useState('1000'), [currency, setCurrency] = useState('EUR'), [cutoff1, setCutoff1] = useState('5'), [cutoff2, setCutoff2] = useState('10');
  const initialYear = new Date().getFullYear() + 1;
  const [preseason, setPreseason] = useState(`${initialYear}-03-01T12:00`);
  const [salvageStart, setSalvageStart] = useState(suggestedAugustWindow(initialYear).start);
  const [salvageEnd, setSalvageEnd] = useState(suggestedAugustWindow(initialYear).end);
  const [rosterJson, setRosterJson] = useState(JSON.stringify([{id: '44', name: 'Example Driver', code: 'EXM', teamId: 'example-team', teamName: 'Example Team'}], null, 2)), [rosterSession, setRosterSession] = useState('');
  const [calYear, setCalYear] = useState(String(season?.year ?? new Date().getFullYear())), [calendar, setCalendar] = useState<any[]>([]);
  const [event, setEvent] = useState(weekends[0]?.id ?? ''), [resultJson, setResultJson] = useState(''), [finalResult, setFinalResult] = useState(false), [preview, setPreview] = useState<any>(null), [note, setNote] = useState('');
  const [ldUser, setLdUser] = useState(''), [ldType, setLdType] = useState('buyin'), [ldAmount, setLdAmount] = useState('1000'), [ldDesc, setLdDesc] = useState('Season buy-in'), [wdc, setWdc] = useState(''), [wcc, setWcc] = useState(''), [audit, setAudit] = useState<any[]>([]);
  const [scheduleName, setScheduleName] = useState(''), [scheduleRound, setScheduleRound] = useState('1'), [scheduleQual, setScheduleQual] = useState('2027-03-06T14:00'), [scheduleSprintQual, setScheduleSprintQual] = useState(''), [scheduleRace, setScheduleRace] = useState('2027-03-07T14:00'), [scheduleSprint, setScheduleSprint] = useState(false);
  const [evidenceUser, setEvidenceUser] = useState(''), [evidenceForm, setEvidenceForm] = useState('gp'), [evidenceStamp, setEvidenceStamp] = useState(''), [evidenceNote, setEvidenceNote] = useState(''), [evidencePick, setEvidencePick] = useState('{}');
  /**
 * Convert a commissioner-entered local session time to a timezone-aware ISO string.
 * @param local - Input to this operation.
 */
  const asIso = (local: string) => new Date(local).toISOString();
  /** Change the creation year and its suggested UTC calendar dates together. */
  function changeSeasonYear(nextYear: string) {
    setYear(nextYear);
    const numericYear = Number(nextYear);
    if (!Number.isInteger(numericYear) || numericYear < 2023 || numericYear > 2200) return;
    setPreseason(`${numericYear}-03-01T12:00`);
    const suggested = suggestedAugustWindow(numericYear);
    setSalvageStart(suggested.start);
    setSalvageEnd(suggested.end);
    setScopeForm(current => postAugustMidseason(numericYear, current.openingRound)
      ? {...current, championshipEnabled:false, salvageEnabled:false} : current);
  }
  /**
 * Wrap a commissioner API mutation with pending/error notifications and refresh.
 * @param fn - Input to this operation.
 * @param message - Input to this operation.
 * @param after - Input to this operation.
 */
  const runAction = async (fn: () => Promise<any>, message: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      after?.();
      refresh()
    } catch (e: any) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  };
  useEffect(() => {
    setEvent(weekends[0]?.id ?? '');
    setCalYear(String(season?.year ?? new Date().getFullYear()));
    if (!season) {
      void get(`/tournaments/${tournamentId}`).then((t: any) => {
        const opening = t.launch_opening_round ?? 1;
        setScopeForm({openingRound:opening,expectedRaces:t.launch_expected_races || (opening === 1 ? 24 : 0),
          championshipEnabled:opening === 1,salvageEnabled:opening === 1});
        if (opening > 1 && t.launch_expected_races > 0 && t.launch_expected_races < 3) setEntry('0');
        if (t.launch_year) changeSeasonYear(String(t.launch_year));
      }).catch(() => {});
    }
    if (season) {
      setScopeForm({openingRound:season.opening_round ?? 1,expectedRaces:season.expected_races ?? 24,
        championshipEnabled:!!season.championship_enabled,salvageEnabled:!!season.salvage_enabled});
      if (season.salvage_start) setSalvageStart(isoToUtcField(season.salvage_start));
      if (season.salvage_end) setSalvageEnd(isoToUtcField(season.salvage_end));
      if (season.preseason_lock) setPreseason(isoToUtcField(season.preseason_lock));
      setYear(String(season.year));
      setSprintMode(season.sprint_mode);
      setEntry(String(season.base_entry_cents));
      setCutoff1(String(season.small_max));
      setCutoff2(String(season.medium_max));
      setCurrency(season.currency);
      setFinanceForm({payoutModel:season.payout_model ?? 'adaptive-3tier',houseRakeEnabled:!!season.house_rake_enabled,houseRakeBps:season.house_rake_bps ?? 500,pokerFloorEnabled:!!season.poker_floor_enabled,pokerItmPct:season.poker_itm_pct ?? 20,pokerAlphaMode:season.poker_alpha_mode ?? 'auto',pokerAlphaManual:season.poker_alpha_manual ?? 1.5})
    }
  }, [season?.id, weekends.length]);
  /**
 * Fetch an existing classification draft for commissioner review.
 */
  async function loadResult() {
    if (!event) return;
    try {
      const d = await get(`/admin/weekends/${event}/result`);
      setResultJson(d.payload ? JSON.stringify(d.payload, null, 2) : JSON.stringify({finishers: [], poleId: null, fastestLapId: null, firstDnfIds: [], greenFlagLaps: 0, cancelled: false, sprint: null}, null, 2));
      setFinalResult(!!d.final_classification);
      setPreview(null)
    } catch (e: any) {
      toast(e.message)
    }
  }
  useEffect(() => {
    if (tab === 'results') loadResult();
    if (tab === 'audit') get(`/admin/audit?tournamentId=${tournamentId}`).then(setAudit).catch(e => toast(e.message))
  }, [tab, event]);
  const menu = [['setup', 'Season setup'], ['roster', 'Roster'], ['calendar', 'Calendar'], ['results', 'Race control'], ['finance', 'Buy-ins'], ['champions', 'Champions'], ['audit', 'Audit & backup']];
  return <><SectionHeading eyebrow="COMMISSIONER ACCESS" title="Race control" detail="Configure the season, manage driver data and results, run scoring previews, and reconcile the financial ledger." right={<Pill tone="red"><Shield size={12} /> ADMIN ONLY</Pill>} /><Card><div className="admin-nav">{menu.map(([key, label]) => <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'setup' && <div className="admin-content"><h3>Season configuration</h3><p className="muted">For a November launch in the current year, set the opening round to the first upcoming F1 event and disable championship/salvage (there is no retroactive August window). UTC salvage inputs are only used for eligible future windows.</p><p className="muted">All rules freeze at this tournament’s own opening qualifying lock, even if it begins at F1 Round 12 or later.</p><SeasonScopeSettings value={scopeForm} onChange={next => {
      setScopeForm(next);
      if (!season && next.openingRound > 1 && next.expectedRaces > 0 && next.expectedRaces < 3) setEntry('0');
    }} locked={!!season?.configLocked} seasonYear={Number(year)}/><div className="form-grid"><TextInput label="SEASON YEAR" value={year} onChange={changeSeasonYear} type="number" /><TextInput label="CURRENCY (ISO 4217)" value={currency} onChange={setCurrency} /><TextInput label="BASE ENTRY (CENTS)" value={entry} onChange={setEntry} type="number" /><label className="input-label">SPRINT MODE<Select value={sprintMode} onChange={setSprintMode} options={[{value: 'two-form', label: 'Two forms (default)'}, {value: 'one-form', label: 'One unified form'}]} /></label><TextInput label="SMALL POOL UPPER CUTOFF" value={cutoff1} onChange={setCutoff1} type="number" /><TextInput label="MEDIUM POOL UPPER CUTOFF" value={cutoff2} onChange={setCutoff2} type="number" />{scopeForm.championshipEnabled && scopeForm.openingRound === 1 && <TextInput label="CHAMPIONSHIP DEADLINE (UTC OFFSET CONVERTED)" value={preseason} onChange={setPreseason} type="datetime-local" />}{scopeForm.salvageEnabled && <><TextInput label="SALVAGE WINDOW OPENS (UTC)" value={salvageStart} onChange={setSalvageStart} type="datetime-local" /><TextInput label="SALVAGE WINDOW CLOSES (UTC)" value={salvageEnd} onChange={setSalvageEnd} type="datetime-local" /></>}</div><SeasonFinanceSettings season={season} form={financeForm} onChange={setFinanceForm}/><div className="actions-row"><Action disabled={busy} onClick={() => runAction(() => post('/admin/seasons', {tournamentId, year: Number(year), name: `F1 ${year} Prediction Pool`, currency, sprintMode, baseEntryCents: Number(entry), smallMax: Number(cutoff1), mediumMax: Number(cutoff2), ...scopeForm, ...(scopeForm.openingRound === 1 && scopeForm.championshipEnabled ? {preseasonLock: asIso(preseason)} : {}), ...(scopeForm.salvageEnabled ? {salvageStart: utcFieldToIso(salvageStart), salvageEnd: utcFieldToIso(salvageEnd)} : {}), ...financeForm}), 'Season created')}> <Plus size={16} /> Create new season</Action>{season && <Action kind="outline" disabled={busy} onClick={() => runAction(() => patch(`/admin/seasons/${season.id}`, {sprintMode, baseEntryCents: Number(entry), smallMax: Number(cutoff1), mediumMax: Number(cutoff2), ...scopeForm, ...(scopeForm.salvageEnabled ? {salvageStart: utcFieldToIso(salvageStart), salvageEnd: utcFieldToIso(salvageEnd)} : {}), ...financeForm}), 'Active season settings updated')}><Settings size={16} /> Update active season</Action>}</div>{!!season && <Notice>Active season: {season.name} ({season.year}). Changes to open windows are immutable once locked.</Notice>}</div>}
    {tab === 'roster' && <div className="admin-content"><h3>Driver & constructor roster</h3><p className="muted">Import the roster from a completed OpenF1 session or paste a JSON array. Driver IDs are used as immutable prediction identities.</p><div className="inline-form"><TextInput label="OPENF1 SESSION KEY" value={rosterSession} onChange={setRosterSession} placeholder="e.g. 9158" /><Action kind="primary" disabled={busy || !season || !rosterSession} onClick={() => runAction(() => post('/admin/openf1/import-roster', {seasonId: season.id, sessionKey: Number(rosterSession)}), 'Roster imported from OpenF1')}> <RefreshCw size={16} /> Import drivers</Action></div><label className="input-label">MANUAL ROSTER JSON<textarea rows={13} className="code-area" spellCheck={false} value={rosterJson} onChange={e => setRosterJson(e.target.value)} /></label><Action disabled={busy || !season} onClick={() => runAction(() => post('/admin/roster', {seasonId: season.id, drivers: JSON.parse(rosterJson)}), 'Roster saved')}><Save size={16} /> Replace roster</Action><Notice>Roster replacements are blocked after the first prediction is submitted.</Notice></div>}
    {tab === 'calendar' && <div className="admin-content"><h3>Calendar import</h3><p className="muted">Preview scheduled OpenF1 events before importing. Existing rounds are not overwritten, so repeated imports are safe.</p><div className="inline-form"><TextInput label="CALENDAR YEAR" type="number" value={calYear} onChange={setCalYear} /><Action kind="outline" disabled={busy} onClick={() => runAction(async () => setCalendar(await post('/admin/openf1/calendar', {tournamentId, year: Number(calYear)})), 'Calendar preview loaded')}><RefreshCw size={16} /> Preview OpenF1</Action></div>{calendar.length > 0 && <><div className="calendar-preview">{calendar.map(e => <div key={e.meetingKey}><span>R{e.round} · {e.name}</span><span>{date(e.raceAt)}</span>{e.isSprint && <Pill tone="amber">Sprint</Pill>}</div>)}</div><Action disabled={busy || !season} onClick={() => runAction(() => post('/admin/openf1/import-calendar', {seasonId: season.id, events: calendar, upcomingOnly: (season.opening_round ?? 1) > 1, startFromRound: season.opening_round ?? 1}), 'Calendar imported', () => setCalendar([]))}><Save size={16} /> Import {calendar.length} rounds</Action></>}<div className="divider-title">OR MANUALLY CREATE A ROUND</div><div className="form-grid"><TextInput label="ROUND NUMBER" value={scheduleRound} onChange={setScheduleRound} type="number" /><TextInput label="EVENT NAME" value={scheduleName} onChange={setScheduleName} placeholder="Australian Grand Prix" /><TextInput label="QUALIFYING START" value={scheduleQual} onChange={setScheduleQual} type="datetime-local" /><TextInput label="RACE START" value={scheduleRace} onChange={setScheduleRace} type="datetime-local" /><label className="check-line"><input type="checkbox" checked={scheduleSprint} onChange={e => setScheduleSprint(e.target.checked)} /> Sprint weekend</label>{scheduleSprint && <TextInput label="SPRINT QUALIFYING START" value={scheduleSprintQual} onChange={setScheduleSprintQual} type="datetime-local" />}</div><Action disabled={busy || !season} onClick={() => runAction(() => post('/admin/weekends', {seasonId: season.id, round: Number(scheduleRound), name: scheduleName, isSprint: scheduleSprint, qualifyingAt: asIso(scheduleQual), raceAt: asIso(scheduleRace), sprintQualifyingAt: scheduleSprint ? asIso(scheduleSprintQual) : null}), 'Round created')}><Plus size={16} /> Add round</Action></div>}
    {tab === 'results' && <div className="admin-content"><h3>Official result workflow</h3><p className="muted">1. Sync OpenF1 provisional data or enter final FIA results. 2. Verify all classifications. 3. Preview exact score impact. 4. Publish once the final classification arrives or 24 hours after the chequered flag.</p><div className="inline-form"><label className="input-label">RACE WEEKEND<Select value={event} onChange={setEvent} options={weekends.map(w => ({value: w.id, label: `R${w.round} · ${w.name}`}))} /></label><Action kind="outline" disabled={busy || !event} onClick={() => runAction(async () => {
      const d = await post(`/admin/weekends/${event}/sync`, {});
      setResultJson(JSON.stringify(d.draft, null, 2));
      setFinalResult(false);
      setPreview(null);
      toast(`OpenF1 synced. Review needed: ${d.needsReview.join('; ')}`)
    }, 'OpenF1 draft ready')}><RefreshCw size={15} /> Sync OpenF1</Action><Action kind="ghost" disabled={!event} onClick={loadResult}>Reload draft</Action></div><label className="input-label">CLASSIFICATION JSON <small>All result fields must be reviewed before publication.</small><textarea className="code-area" spellCheck={false} rows={16} value={resultJson} onChange={e => {
      setResultJson(e.target.value);
      setPreview(null)
    }} placeholder="Enter an official classification including greenFlagLaps" /></label><label className="check-line"><input type="checkbox" checked={finalResult} onChange={e => setFinalResult(e.target.checked)} /> FIA final classification has been published</label><div className="actions-row"><Action disabled={busy || !event || !resultJson} onClick={() => runAction(() => put(`/admin/weekends/${event}/result`, {result: JSON.parse(resultJson), finalClassification: finalResult, source: 'manual', note}), 'Classification draft saved', () => setPreview(null))}><Save size={16} /> Save result draft</Action><Action kind="outline" disabled={busy || !event} onClick={() => runAction(async () => setPreview(await post(`/admin/weekends/${event}/preview`, {})), 'Score preview calculated')}><BarChart3 size={16} /> Preview scores</Action><Action kind="danger" disabled={busy || !event || !preview} onClick={() => runAction(() => post(`/admin/weekends/${event}/publish`, {}), 'Official scores published', () => setPreview(null))}><Flag size={16} /> Publish scores</Action></div><TextInput label="AUDIT / OVERRIDE NOTE" value={note} onChange={setNote} placeholder="Classification source or commissioner note" />{preview && <div className="preview-result"><div className="card-heading"><h3>Dry-run score preview</h3><Pill tone="green">Reviewed · {preview.scores?.length ?? 0} accounts</Pill></div><div className="muted small">Fingerprint {preview.digest.slice(0, 16)} · No points published yet</div>{preview.scores?.slice().sort((a: any, b: any) => b.total - a.total).map((x: any) => <div key={x.userId} className="preview-line"><strong>{x.displayName}</strong><span>{x.gpTotal} GP + {x.sprintTotal} Sprint</span><strong>{x.total} pts</strong></div>)}</div>}<div className="divider-title">PRE-LOCK OUTAGE FALLBACK</div><p className="muted">Enter timestamped evidence received before qualifying lock. All emergency entries are append-only and audited.</p><div className="form-grid"><label className="input-label">PLAYER<Select value={evidenceUser} onChange={setEvidenceUser} options={users.map(u => ({value: u.userId, label: u.name}))} /></label><label className="input-label">FORM<Select value={evidenceForm} onChange={setEvidenceForm} options={[{value: 'gp', label: 'GP'}, {value: 'sprint', label: 'Sprint'}, {value: 'unified', label: 'Unified'}]} /></label><TextInput label="EVIDENCE TIME" type="datetime-local" value={evidenceStamp} onChange={setEvidenceStamp} /><TextInput label="EVIDENCE NOTE / SOURCE" value={evidenceNote} onChange={setEvidenceNote} placeholder="Screenshot or chat timestamp ID" /></div><textarea rows={5} className="code-area" value={evidencePick} onChange={e => setEvidencePick(e.target.value)} spellCheck={false} /><Action kind="outline" disabled={busy || !evidenceUser || !event} onClick={() => runAction(() => post(`/admin/weekends/${event}/fallback`, {userId: evidenceUser, form: evidenceForm, pick: JSON.parse(evidencePick), evidenceTimestamp: asIso(evidenceStamp), evidenceNote}), 'Emergency pick recorded')}><ShieldCheck size={16} /> Record emergency ballot</Action></div>}
    {tab === 'finance' && <div className="admin-content"><h3>Financial ledger</h3><p className="muted">This is a manually reconciled pool; no actual card payments or transfers are processed. Each mutation requires a unique idempotency key.</p><div className="form-grid"><label className="input-label">MEMBER<Select value={ldUser} onChange={setLdUser} options={users.map(u => ({value: u.userId, label: u.name}))} /></label><label className="input-label">TRANSACTION TYPE<Select value={ldType} onChange={setLdType} options={['buyin', 'adjustment', 'refund', 'payout', 'platform_rake', 'house_rake'].map(x => ({value: x, label: x.toUpperCase()}))} /></label><TextInput label="AMOUNT (CENTS)" value={ldAmount} onChange={setLdAmount} type="number" /><TextInput label="DESCRIPTION" value={ldDesc} onChange={setLdDesc} /></div><Action disabled={busy || !season} onClick={() => runAction(() => post('/admin/ledger', {seasonId: season.id, userId: ldUser || null, type: ldType, amountCents: Number(ldAmount), description: ldDesc, idempotencyKey: crypto.randomUUID().replace(/-/g, '')}), 'Ledger entry recorded')}><Plus size={16} /> Add ledger entry</Action><Notice>Each house layer is capped by its contribution-based entitlement. Only the global operator may record platform rake, while house rake is payable only to the tournament creator. Player payouts require published championship results and cannot exceed the calculated prize amount. The app records but does not transfer money.</Notice></div>}
    {tab === 'champions' && <div className="admin-content"><h3>Year-end championship outcomes</h3><p className="muted">Publish once after all scheduled results. {season?.championship_enabled ? `Matching predictions earn ${season?.scope?.championshipBonus ?? 25} points each.` : 'Pure Race-by-Race mode: publish a final standings record without WDC/WCC scoring.'} This step is immutable.</p><div className="form-grid"><label className="input-label">DRIVERS' CHAMPION (DRIVER ID)<input value={wdc} onChange={e => setWdc(e.target.value)} placeholder="e.g. 4" /></label><label className="input-label">CONSTRUCTORS' CHAMPION (TEAM ID)<input value={wcc} onChange={e => setWcc(e.target.value)} placeholder="e.g. mclaren" /></label></div><Action kind="danger" disabled={busy || !season || (!!season?.championship_enabled && (!wdc || !wcc))} onClick={() => runAction(() => post('/admin/champions', {seasonId: season.id, wdc, wcc}), 'Championship bonuses published')}><Trophy size={16} /> Publish final champions</Action></div>}
    {tab === 'audit' && <div className="admin-content"><h3>Audit trail & persistence</h3><p className="muted">Server mutations and manual overrides are timestamped. Backups use SQLite's online backup mechanism, including uncheckpointed WAL data.</p><div className="actions-row">{isOperator && <Action disabled={busy} onClick={() => runAction(() => post('/admin/backup', {}), 'Database backup created on host server')}><Database size={16} /> Create database snapshot</Action>}<Action kind="outline" onClick={() => get(`/admin/audit?tournamentId=${tournamentId}`).then(setAudit)}><RefreshCw size={16} /> Refresh audit</Action></div><div className="audit-list">{audit.map((e: any) => <div key={e.id}><span>{date(e.created_at)}</span><strong>{e.action}</strong><small>{e.note || e.entity_id.slice(0, 12)}</small></div>)}</div><Notice>For disaster recovery, configure an encrypted offsite copy of the host's backup directory. Local snapshots alone do not protect from disk failure.</Notice></div>}
  </Card></>
}
