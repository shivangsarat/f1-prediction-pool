import {useState, type FormEvent} from 'react';
import {ArrowRight, Check, FlagTriangleRight, Globe2, LogOut, Plus, Shield, Users} from 'lucide-react';
import {post} from '../api';
import {Action, Card, Notice, TextInput} from '../shared/ui';
import {InvitationsPanel} from '../components/InvitationsPanel';
import {NotificationSettings} from '../components/NotificationSettings';
import {OperatorMailPanel} from '../components/OperatorMailPanel';

/** A tournament is visible to its members, or to the platform operator across all pools. */
export type Tournament = {
  id: string; name: string; description: string;
  role: 'operator' | 'commissioner' | 'player';
  visibility: 'public' | 'invite_only'; status: 'active' | 'archived';
  memberCount: number; created_at?: string;
};

/** Display private memberships (or operator's all-pools list), creation, invites, and discovery. */
export function TournamentLobby({user, tournaments, onRefresh, onOpen, onSignOut, onCatalogue = () => {}}: {
  user: {display_name: string; role?: string; username?: string};
  tournaments: Tournament[];
  onRefresh: () => Promise<void>;
  onOpen: (tournament: Tournament) => void;
  onSignOut: () => void;
  onCatalogue?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'invite_only'>('invite_only');
  const [invite, setInvite] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Create an active public or private tournament with a commissioner and scoped ledger. */
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const created = await post<Tournament & {inviteCode: string}>('/tournaments', {name, description, visibility});
      setName(''); setDescription(''); setNewCode(created.inviteCode);
      await onRefresh();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  /** Join an active competition using a secret code extracted from a shared link. */
  async function join(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const code = invite.trim().includes('invite=') ? new URL(invite.trim()).searchParams.get('invite') ?? '' : invite.trim();
      const joined = await post<Tournament>('/tournaments/join', {inviteCode: code});
      setInvite(''); await onRefresh(); onOpen(joined);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  /** Refresh the user's list after accepting an in-app invitation and open the joined pool. */
  async function accepted(tournament: Tournament) {await onRefresh(); onOpen(tournament);}

  return <div className="tournament-lobby">
    <header className="lobby-header">
      <div className="brand"><FlagTriangleRight size={28}/><strong>GRID<span>LOCK</span></strong></div>
      <div className="lobby-user"><span>{user.display_name} {user.username ? `(@${user.username})` : ''}</span><Action kind="ghost" onClick={onSignOut}><LogOut size={17}/> Sign out</Action></div>
    </header>
    <main className="lobby-main">
      <div className="eyebrow">{user.role === 'admin' ? 'GLOBAL OPERATOR' : 'YOUR PADDOCK'}</div>
      <h1>Prediction tournaments</h1>
      <p className="muted">{user.role === 'admin' ? 'Operator access to every tournament and its settings. All amendments are audited.' : 'Your own competitions and those you joined. No other private tournament is visible to you.'}</p>
      <Action kind="outline" onClick={onCatalogue}><Globe2 size={16}/> Browse public tournament catalogue</Action>
      {error && <Notice kind="error">{error}</Notice>}
      <InvitationsPanel onAccepted={accepted}/>
      <section className="lobby-tournaments" aria-label="My tournaments">
        {tournaments.length ? tournaments.map(t => <button className="tournament-tile" key={t.id} onClick={() => onOpen(t)}>
          <div className="tile-icon"><FlagTriangleRight size={26}/></div>
          <span className="eyebrow">{t.role === 'operator' ? 'PLATFORM OPERATOR' : t.role === 'commissioner' ? 'COMMISSIONER' : 'PARTICIPANT'} · {t.visibility === 'public' ? 'PUBLIC' : 'INVITE ONLY'} · {t.status?.toUpperCase()}</span>
          <h2>{t.name}</h2><p>{t.description || 'F1 prediction championship'}</p>
          <div className="tile-bottom"><span><Users size={15}/>{t.memberCount} members</span><span>Enter tournament <ArrowRight size={16}/></span></div>
        </button>) : <Card><div className="welcome-empty"><FlagTriangleRight size={36}/><h2>No tournaments yet</h2><p>Create one, accept a private invitation, or explore the public catalogue.</p></div></Card>}
      </section>
      <div className="lobby-forms">
        <Card><form onSubmit={create}><h2><Plus size={20}/> Create a tournament</h2><p className="muted">You become commissioner and control this tournament's rules and financial ledger.</p>
          <TextInput label="TOURNAMENT NAME" value={name} onChange={setName} placeholder="2027 Friends Championship"/>
          <TextInput label="DESCRIPTION (OPTIONAL)" value={description} onChange={setDescription} placeholder="Weekend prediction challenge"/>
          <label className="input-label">WHO CAN FIND IT?<select value={visibility} aria-label="Tournament visibility" onChange={event => setVisibility(event.target.value as 'public' | 'invite_only')}>
            <option value="invite_only">Invite only — hidden from the public catalogue</option>
            <option value="public">Public — listed and open to join</option>
          </select></label>
          <Action type="submit" disabled={busy || name.trim().length < 3}>Create tournament <ArrowRight size={16}/></Action>
        </form></Card>
        <Card><form onSubmit={join}><h2><Shield size={20}/> Join by invitation</h2><p className="muted">Paste the private invite code or full joining URL.</p>
          <TextInput label="INVITATION CODE OR LINK" value={invite} onChange={setInvite} placeholder="Paste invite code"/>
          <Action type="submit" disabled={busy || invite.trim().length < 20}>Join tournament <ArrowRight size={16}/></Action>
        </form></Card>
      </div>
      {newCode && <Card><Notice kind="success"><Check size={16}/> Save this joining link. Generating another will revoke it.</Notice>
        <div className="copy-invite"><code>{`${window.location.origin}/?invite=${newCode}`}</code>
          <Action kind="outline" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/?invite=${newCode}`)}>Copy link</Action>
          <Action kind="ghost" onClick={() => setNewCode('')}>Dismiss</Action>
        </div></Card>}
      <NotificationSettings/>
      {user.role === 'admin' && <OperatorMailPanel/>}
    </main>
  </div>;
}
