import {useState} from 'react';
import {Copy, Globe2, LockKeyhole, Search, Shield, UserPlus} from 'lucide-react';
import {get, patch, post} from '../api';
import {Action, Card, Notice, TextInput, FieldHelp} from '../shared/ui';
import type {Tournament} from '../pages/TournamentLobby';

/** Minimal username directory record (email addresses are not exposed). */
type UserResult = {id: string; username: string; display_name: string};

/** Tournament-scoped settings and invite controls for commissioners and global operators. */
export function TournamentManagement({tournament, onChanged}: {
  tournament: Tournament;
  onChanged: (value: Tournament) => void;
}) {
  const [visibility, setVisibility] = useState(tournament.visibility);
  const [status, setStatus] = useState(tournament.status);
  const [name, setName] = useState(tournament.name);
  const [description, setDescription] = useState(tournament.description);
  const [username, setUsername] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /** Persist tournament settings; backend enforces local/global management permission. */
  async function save() {
    setBusy(true); setError(''); setSuccess('');
    try {
      const updated = await patch<Tournament>(`/tournaments/${tournament.id}`, {name, description, visibility, status});
      onChanged(updated); setSuccess('Tournament settings saved.');
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  /** Search only by username and only within the commissioner-authorized directory. */
  async function search() {
    setError('');
    try {setResults(await get<UserResult[]>(`/tournaments/${tournament.id}/users?q=${encodeURIComponent(username)}`));}
    catch (e) {setError((e as Error).message);}
  }

  /** Create a pending invitation; do not silently add the invited person. */
  async function invite(user: UserResult) {
    setBusy(true); setError('');
    try {
      await post(`/tournaments/${tournament.id}/invite-user`, {userId: user.id});
      setResults(previous => previous.filter(item => item.id !== user.id));
      setSuccess(`Invitation sent to @${user.username} in GRIDLOCK${' — email delivery depends on their notification settings.'}`);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  /** Rotate the invitation secret and present a copyable joining URL once. */
  async function makeLink() {
    setBusy(true); setError('');
    try {
      const response = await post<{inviteCode: string}>(`/tournaments/${tournament.id}/rotate-invite`, {});
      setLink(`${window.location.origin}/?invite=${encodeURIComponent(response.inviteCode)}`);
      setSuccess('Joining link generated. Previous links are now invalid.');
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  return <div className="settings-grid">
    <Card><h3><Shield size={18}/> Tournament settings</h3>
      <TextInput label="NAME" value={name} onChange={setName}/>
      <TextInput label="DESCRIPTION" value={description} onChange={setDescription}/>
      <label className="field-label">Who can join? <FieldHelp label="Who can join?" detail="Public competitions appear in the catalogue and accept invitations. Invite-only competitions are hidden and require an invite link or invitation."/></label>
      <select aria-label="Tournament visibility" value={visibility} onChange={e => setVisibility(e.target.value as Tournament['visibility'])}>
        <option value="invite_only">Invite-only — hidden from catalogue</option><option value="public">Public — visible to everyone</option>
      </select>
      <label className="field-label">Tournament availability <FieldHelp label="Tournament availability" detail="Active pools accept eligible entries. Archived pools stay visible to members but do not accept new participants."/></label>
      <select aria-label="Tournament status" value={status} onChange={e => setStatus(e.target.value as Tournament['status'])}>
        <option value="active">Active</option><option value="archived">Archived — no new entrants</option>
      </select>
      <Action onClick={() => void save()} disabled={busy}>Save settings</Action>
    </Card>
    <Card><h3><UserPlus size={18}/> Invite players</h3>
      <p className="muted">Search an existing GRIDLOCK account by username. The person can accept or decline.</p>
      <div className="invite-lookup"><TextInput label="USERNAME" value={username} onChange={setUsername} placeholder="player_username"/><Action kind="outline" disabled={busy || username.length < 2} onClick={() => void search()}><Search size={16}/> Find</Action></div>
      {results.map(result => <div className="invitation-row" key={result.id}>
        <span><strong>@{result.username}</strong><span className="muted"> {result.display_name}</span></span>
        <Action disabled={busy} onClick={() => void invite(result)}>Invite</Action>
      </div>)}
      <hr/><h3>{visibility === 'public' ? <Globe2 size={18}/> : <LockKeyhole size={18}/>} Share joining link</h3>
      <p className="muted">Generate a new secret link for private invitations. Everyone holding an active link can join; never post it publicly.</p>
      <Action kind="outline" disabled={busy} onClick={() => void makeLink()}>Generate new link</Action>
      {link && <div className="copy-invite"><code>{link}</code><Action kind="outline" onClick={() => void navigator.clipboard.writeText(link)}><Copy size={16}/> Copy link</Action></div>}
    </Card>
    {error && <Notice kind="error">{error}</Notice>}
    {success && <Notice kind="success">{success}</Notice>}
  </div>;
}
