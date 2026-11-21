import {useState, type FormEvent} from 'react';
import {ArrowRight, FlagTriangleRight, Globe2} from 'lucide-react';
import {post} from '../api';
import {Action, Notice, TextInput} from '../shared/ui';

/** Display account registration/sign-in and retain invitations through authentication. */
export function AuthScreen({onLogin, invitation = false, onBrowse = () => {}}: {
  onLogin: (data: any) => void;
  invitation?: boolean;
  onBrowse?: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(invitation ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Submit the selected form without reading or writing JavaScript-visible auth tokens. */
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const payload = mode === 'register' ? {email, name, username, password, bootstrapKey: key} : {email, password};
      const data = await post(`/auth/${mode}`, payload);
      onLogin(data);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  /** Switch between account creation and existing-user authentication. */
  function switchMode() {
    setMode(current => current === 'login' ? 'register' : 'login'); setError('');
  }

  return <div className="auth-shell">
    <div className="auth-decoration">
      <div className="race-stripes"/>
      <div className="auth-brand"><FlagTriangleRight size={36}/><span>GRID<span className="red-text">LOCK</span></span></div>
      <div className="auth-hero"><span className="eyebrow">YOUR SEASON. YOUR CALL.</span>
        <h1>Every lap.<br/>Every point.<br/><em>Every prediction.</em></h1>
        <p>Run your own Formula 1 tournament, join friends, or discover a public competition.</p>
      </div>
      <div className="auth-bottom">PREDICT THE UNPREDICTABLE. <span>© GRIDLOCK</span></div>
    </div>
    <div className="auth-right"><form className="auth-card" onSubmit={submit}>
      <div className="eyebrow">THE PADDOCK AWAITS</div>
      <h2>{mode === 'login' ? 'Welcome back.' : 'Join the grid.'}</h2>
      {invitation ? <Notice>Your tournament invitation is ready. {mode === 'login' ? 'Sign in to enter it.' : 'Create an account to enter it automatically.'}</Notice>
        : <p className="muted">{mode === 'login' ? 'Sign in to manage your predictions.' : 'Create an account to get started.'}</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {mode === 'register' && <><TextInput label="DISPLAY NAME" value={name} onChange={setName} placeholder="Your name"/>
        <TextInput label="USERNAME (USED FOR INVITATIONS)" value={username} onChange={setUsername} placeholder="your_username"/></>}
      <TextInput label="EMAIL ADDRESS" value={email} onChange={setEmail} type="email" placeholder="you@example.com"/>
      <TextInput label="PASSWORD" value={password} onChange={setPassword} type="password" placeholder={mode === 'register' ? 'Minimum 12 characters' : 'Your password'}/>
      {mode === 'register' && <TextInput label="PLATFORM OPERATOR KEY (SPECIAL ACCOUNTS ONLY)" value={key} onChange={setKey} type="password" placeholder="Leave empty for a normal account"/>}
      <button className="btn primary auth-submit" disabled={busy} type="submit">{busy ? 'Working…' : mode === 'login' ? 'Enter the paddock' : 'Create account'} <ArrowRight size={18}/></button>
      <div className="auth-switch">{mode === 'login' ? 'New to the pool?' : 'Already racing?'} <button type="button" className="text-button" onClick={switchMode}>{mode === 'login' ? 'Create account' : 'Sign in'}</button></div>
      <Action kind="ghost" onClick={onBrowse}><Globe2 size={16}/> Browse public tournaments</Action>
    </form></div>
  </div>;
}
