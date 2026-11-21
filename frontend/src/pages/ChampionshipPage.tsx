import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BarChart3, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Coins, Crown, Database, Flag, FlagTriangleRight, GitBranch, Info, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Save, Settings, Shield, ShieldCheck, Target, Timer, TrendingUp, Trophy, Users, Wallet, Wifi, X, Zap} from 'lucide-react';
import {get, post, put, patch, money, date} from '../api';
import {Card, SectionHeading, Metric, Pill, TextInput, Notice, Select, Action, useCountdown, mkDefault, emptySprint, slug, type Form, type View} from '../shared/ui';
/** ChampionshipPage renders the tournament-scoped championship experience. */
export function ChampionshipPage({season, drivers, teams, user, toast}: {season: any; drivers: any[]; teams: any[]; user: {id: string}; toast: (s: string) => void}) {

  const [all, setAll] = useState<any[]>([]), [wdc, setWdc] = useState(''), [wcc, setWcc] = useState(''), [saving, setSaving] = useState('');
  const load = useCallback(() => get(`/championship-picks?seasonId=${season.id}`).then(setAll).catch(e => toast(e.message)), [season.id]);
  useEffect(() => {
    load()
  }, [load]);
  const preseasonOpen = Date.now() < Date.parse(season.preseason_lock), salvageOpen = Date.now() >= Date.parse(season.salvage_start) && Date.now() < Date.parse(season.salvage_end), editable = preseasonOpen || salvageOpen;
  const dOpt = drivers.map(d => ({value: d.id, label: `${d.code} — ${d.name}`}));
  const tOpt = teams.map(t => ({value: t.id, label: t.name}));   /**
   * Find the current participant’s championship prediction from disclosed selections.
   * @param cat - Input to this operation.
   */
  const mine = (cat: string) => all.find(x => x.category === cat && x.user_id === user.id);
  useEffect(() => {
    const x = all.filter(x => x.user_id === user.id);
    setWdc(x.find(x => x.category === 'wdc')?.choice ?? drivers[0]?.id ?? '');
    setWcc(x.find(x => x.category === 'wcc')?.choice ?? teams[0]?.id ?? '')
  }, [all, drivers.length]);   /**
   * Persist an eligible championship prediction before its UTC lock.
   * @param cat - Input to this operation.
   * @param choice - Input to this operation.
   */
  async function save(cat: string, choice: string) {
    setSaving(cat);
    try {
      await put('/championship-picks', {seasonId: season.id, category: cat, choice});
      toast(`Your ${cat.toUpperCase()} pick was saved.`);
      load()
    } catch (e: any) {
      toast(e.message)
    } finally {
      setSaving('')
    }
  }
  const current = preseasonOpen ? 'Pre-season entry window' : salvageOpen ? 'Summer break salvage' : 'Selections locked';
  return <><SectionHeading eyebrow="THE LONG GAME" title="Championship predictions" detail="Pick the World Drivers’ and Constructors’ Champions. Each correct call earns 25 season points." right={<Pill tone={editable ? 'green' : 'red'}>{current}</Pill>} /><div className="two-col"><Card><div className="championship-icon"><Trophy size={30} /></div><div className="eyebrow">WDC · 25 POINTS</div><h3>World Drivers' Champion</h3><p className="muted">Your predicted season champion follows the driver through any team changes.</p><div className="champ-field"><Select value={wdc} onChange={setWdc} options={dOpt} disabled={!editable} /><Action loading={saving === 'wdc'} disabled={!editable || !wdc} onClick={() => save('wdc', wdc)}><Save size={15} /> Save WDC</Action></div></Card><Card><div className="championship-icon yellow"><Crown size={30} /></div><div className="eyebrow">WCC · 25 POINTS</div><h3>World Constructors' Champion</h3><p className="muted">Select the team you expect to take the Constructors' Championship.</p><div className="champ-field"><Select value={wcc} onChange={setWcc} options={tOpt} disabled={!editable} /><Action loading={saving === 'wcc'} disabled={!editable || !wcc} onClick={() => save('wcc', wcc)}><Save size={15} /> Save WCC</Action></div></Card></div><Card className="salvage"><div className="card-heading"><div><div className="eyebrow">SECOND CHANCE</div><h3>Summer break salvage window</h3></div><Pill tone="amber">−15 pts per changed category</Pill></div><p>During one designated week in August, you can change a preseason pick. A changed category costs 15 points after the window closes, regardless of whether the new selection eventually wins.</p><div className="salvage-calendar"><span><CalendarDays size={16} /> Opens {date(season.salvage_start)}</span><ArrowRight size={18} /><span>Closes {date(season.salvage_end)}</span></div><div className="card-note">A correct updated pick nets +10. Keeping a correct original pick earns the full +25.</div></Card></>
}
