import React, {useState} from 'react';
import {ArrowRight, FlagTriangleRight} from 'lucide-react';
import {post} from '../api';
import {TextInput, Notice} from '../shared/ui';
/** Render account registration and sign-in, with session cookies handled exclusively by the API. */
export function AuthScreen({onLogin}: {onLogin: (data: any) => void}) {

  const [mode, setMode] = useState<'login' | 'register'>('login'), [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  /**
 * Validate and submit the participant’s form or authentication request.
 * @param e - Input to this operation.
 */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await post(`/auth/${mode}`, mode === 'register' ? {email, name, password, bootstrapKey: key} : {email, password});
      onLogin(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="auth-shell"><div className="auth-decoration"><div className="race-stripes" /><div className="auth-brand"><FlagTriangleRight size={36} /><span>GRID<span className="red-text">LOCK</span></span></div><div className="auth-hero"><span className="eyebrow">YOUR SEASON. YOUR CALL.</span><h1>Every lap.<br />Every point.<br /><em>Every prediction.</em></h1><p>A private Formula 1 prediction championship. Make your calls before lights out, follow the leaderboards, and race for the top step.</p><div className="hero-graphic"><span>01</span><div className="line" /><span>02</span><div className="line" /><span>03</span></div></div><div className="auth-bottom">PREDICT THE UNPREDICTABLE. <span>© GRIDLOCK</span></div></div><div className="auth-right"><form className="auth-card" onSubmit={submit}><div className="eyebrow">THE PADDOCK AWAITS</div><h2>{mode === 'login' ? 'Welcome back.' : 'Join the grid.'}</h2><p className="muted">{mode === 'login' ? 'Sign in to manage your predictions.' : 'Create your player account to get started.'}</p>{error && <Notice kind="error">{error}</Notice>}{mode === 'register' && <TextInput label="DISPLAY NAME" value={name} onChange={setName} placeholder="Your name" />}<TextInput label="EMAIL ADDRESS" value={email} onChange={setEmail} type="email" placeholder="you@example.com" /><TextInput label="PASSWORD" value={password} onChange={setPassword} type="password" placeholder={mode === 'register' ? 'Minimum 12 characters' : 'Your password'} />{mode === 'register' && <TextInput label="PLATFORM OPERATOR KEY (SPECIAL ACCOUNTS ONLY)" value={key} onChange={setKey} type="password" placeholder="Regular users create tournaments without a key" />}<button className="btn primary auth-submit" disabled={busy} type="submit">{busy ? 'Working...' : mode === 'login' ? 'Enter the paddock' : 'Create account'}<ArrowRight size={18} /></button><div className="auth-switch">{mode === 'login' ? 'New to the pool?' : 'Already racing?'} <button type="button" className="text-button" onClick={() => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('')
  }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button></div></form></div></div>
}
