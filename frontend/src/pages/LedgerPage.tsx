import {Coins, Info, Trophy, Users, Wallet} from 'lucide-react';
import {money, date} from '../api';
import {Card, SectionHeading, Metric, Notice} from '../shared/ui';

/** Display the authoritative cash balance separately from contribution-based prize entitlements. */
export function LedgerPage({season, ledger, standings}: {season: any; ledger: any; standings: any[]}) {
  const plan = ledger?.payouts;
  const entries: any[] = ledger?.entries ?? [];
  const slots: number[] = plan?.slotsCents ?? [];
  const gross = plan?.grossPotCents ?? ledger?.grossPotCents ?? 0;
  const platform = plan?.platformRakeCents ?? 0;
  const creator = plan?.creatorRakeCents ?? 0;
  const net = plan?.netPlayerPotCents ?? gross;

  return <>
    <SectionHeading eyebrow="TRANSPARENT ECONOMICS" title="Prize pool & ledger" detail="Published contributions, both house fees, and the projected payout ladder. Payout forecasts never depend on cash already distributed."/>
    <div className="metrics-grid three">
      <Metric label="GROSS POT" value={money(gross, season.currency)} sub="Buy-ins minus refunds and adjustments" icon={Coins}/>
      <Metric label="NET PLAYER POT" value={money(net, season.currency)} sub="After operator and creator fees" icon={Wallet}/>
      <Metric label="PAYING PARTICIPANTS" value={plan?.participants ?? 0} sub={plan?.model ?? 'No payout configured'} icon={Users}/>
    </div>
    <Card>
      <h3>House fee disclosure</h3>
      <div className="financial-rows">
        <div><span>Gross contributions</span><strong>{money(gross,season.currency)}</strong></div>
        <div><span>Operator hosting fee</span><strong>{money(platform,season.currency)}</strong></div>
        <div><span>Tournament creator house rake</span><strong>{money(creator,season.currency)}</strong></div>
        <div><span>Net player prize pool</span><strong>{money(net,season.currency)}</strong></div>
        <div><span>Cash remaining after recorded disbursements</span><strong>{money(ledger?.cashCents ?? 0,season.currency)}</strong></div>
      </div>
      <Notice>Rake is calculated once from gross buy-ins, minus refunds, never from the remaining cash balance. Combined operator and creator rake is capped at 15%.</Notice>
    </Card>
    <div className="two-col">
      <Card>
        <div className="card-heading"><div><div className="eyebrow">{plan?.payoutModel === 'poker' ? 'CASINO POKER DISTRIBUTION' : 'ADAPTIVE 3-TIER MODEL'}</div><h3>Projected payout ladder</h3></div><Trophy size={20}/></div>
        <p className="muted">{plan?.model} · {plan?.paidPlaces ?? 0} paid places{plan?.alpha !== null && plan?.alpha !== undefined ? ` · α ${plan.alpha}` : ''}</p>
        <div className="payout-list">
          {slots.map((amount,i) => {
            const winner = plan?.prizes?.find((p: any) => p.rank === i + 1);
            const name = winner ? standings.find(row => row.userId === winner.userId)?.name : null;
            const cashback = plan?.payoutModel === 'poker' && plan?.floorEnabled === false && amount < season.base_entry_cents;
            return <div className={'payout-row place-' + i} key={i}>
              <div className="trophy-medal">{i + 1}</div>
              <div><strong>Place {i+1}</strong><span>{name ?? 'Projected prize slot'}</span>{cashback && <small className="loss-warning">Loss-Reduction Spot · below full entry</small>}</div>
              <strong>{money(amount, season.currency)}</strong>
            </div>;
          })}
          {!slots.length && <p className="muted">No paid-entry units yet.</p>}
        </div>
        <div className="card-note"><Info size={16}/> Every cent of the Net Player Pot is allocated to eligible winners. Ties across the payout bubble share paid plus zero-value slots; prorated entrants can have capped shares.</div>
        {plan?.payoutModel === 'poker' && <Notice>ITM threshold changes can open a new paid spot and slightly reduce first-place winnings. Floor OFF can return less than the buy-in; slots under 25% of a full entry are trimmed.</Notice>}
      </Card>
      <Card>
        <div className="card-heading"><div><div className="eyebrow">FINANCIAL AUDIT TRAIL</div><h3>Recorded cash flow</h3></div><Coins size={20}/></div>
        {entries.length ? entries.slice(0,25).map(entry => <div className="transaction" key={entry.id}>
          <div className="transaction-icon"><Coins size={18}/></div>
          <div><strong>{entry.description}</strong><span>{date(entry.created_at)} · {entry.type}</span></div>
          <strong className={entry.amount_cents >= 0 ? 'positive' : 'negative'}>{entry.amount_cents > 0 ? '+' : ''}{money(entry.amount_cents, season.currency)}</strong>
        </div>) : <div className="empty">No financial ledger entries yet. The commissioner records externally settled transactions.</div>}
      </Card>
    </div>
  </>;
}
