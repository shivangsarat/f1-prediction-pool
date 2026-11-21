import {useEffect, useState} from 'react';
import {ArrowLeft, ArrowRight, Globe2, Search, Users} from 'lucide-react';
import {get} from '../api';
import {Action, Card, Notice} from '../shared/ui';

/** Safe catalogue metadata: never contains private invitations, participant emails, or picks. */
export type PublicTournament = {
  id: string; name: string; description: string; visibility: 'public'; status: 'active'; memberCount: number;
};

/** Show only active public tournaments in an independent, searchable discovery page. */
export function TournamentCatalogue({onBack, onJoin, signedIn}: {
  onBack: () => void;
  onJoin: (tournament: PublicTournament) => Promise<void>;
  signedIn: boolean;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<PublicTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  /** Query public metadata only; requests never include participant/private records. */
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      get<PublicTournament[]>(`/catalogue?q=${encodeURIComponent(query)}`)
        .then(data => {if (!canceled) {setEntries(data); setError('');}})
        .catch((e: Error) => {if (!canceled) setError(e.message);})
        .finally(() => {if (!canceled) setLoading(false);});
    }, 150);
    return () => {canceled = true; clearTimeout(timer);};
  }, [query]);

  /** Join a selected public competition after authentication, or continue to account creation. */
  async function join(tournament: PublicTournament) {
    setBusy(tournament.id);
    setError('');
    try { await onJoin(tournament); } catch (e) { setError((e as Error).message); }
    finally {setBusy(null);}
  }

  return <div className="tournament-lobby">
    <header className="lobby-header"><strong className="brand">GRID<span>LOCK</span></strong><Action kind="ghost" onClick={onBack}><ArrowLeft size={16} /> Back</Action></header>
    <main className="lobby-main">
      <div className="eyebrow"><Globe2 size={16} /> THE PUBLIC PADDOCK</div>
      <h1>Tournament catalogue</h1>
      <p className="muted">Discover active public prediction pools. Private, invite-only tournaments are never listed here.</p>
      <label className="catalogue-search"><Search size={18} /><input aria-label="Search public tournaments" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search competitions" maxLength={80}/></label>
      {error && <Notice kind="error">{error}</Notice>}
      <section className="catalogue-grid" aria-label="Public tournaments">
        {entries.map(t => <Card key={t.id}>
          <div className="eyebrow"><Globe2 size={14} /> PUBLIC · ACTIVE</div>
          <h2>{t.name}</h2><p className="muted">{t.description || 'An F1 prediction championship open to participants.'}</p>
          <p className="muted"><Users size={15} /> {t.memberCount} participants</p>
          <Action disabled={busy === t.id} onClick={() => void join(t)}>{signedIn ? 'Join tournament' : 'Sign up to join'} <ArrowRight size={16}/></Action>
        </Card>)}
        {!loading && !entries.length && <Card><h2>No public tournaments found</h2><p className="muted">Try a different search. Invitation-only tournaments require a joining link.</p></Card>}
        {loading && <p role="status" className="muted">Loading public tournaments…</p>}
      </section>
    </main>
  </div>;
}
