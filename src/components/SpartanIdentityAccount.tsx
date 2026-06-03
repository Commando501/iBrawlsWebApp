import React, { useState } from 'react';
import {
  AccountInfo,
  register as apiRegister,
  login as apiLogin,
  logout as apiLogout,
  recover as apiRecover,
  changeUsername as apiChangeUsername,
  changeEmail as apiChangeEmail,
  changePassword as apiChangePassword,
} from '../services/account';

/**
 * Account block rendered inside the Spartan Pilot Identity card. Accounts are
 * optional; logged-out users keep playing normally. This component owns its form
 * state and calls the account service directly, then notifies the parent (App) so
 * it can run the cloud-settings sync side effects.
 */

interface Props {
  account: AccountInfo | null;
  /** Register succeeded — App pushes the current local settings up as the first cloud save. */
  onRegistered: (account: AccountInfo) => void;
  /** Login succeeded — App pulls the account's cloud settings down (cloud overwrites local). */
  onLoggedIn: (account: AccountInfo) => void;
  /** Logout / session cleared. */
  onLoggedOut: () => void;
  /** Username/email edited — App refreshes its account state. */
  onAccountChanged: (account: AccountInfo) => void;
}

const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type LoggedOutMode = 'menu' | 'login' | 'register' | 'recover';
type EditField = null | 'username' | 'email' | 'password';

function cooldownRemaining(changedAt: number | null, windowMs: number): number {
  if (!changedAt) return 0;
  const elapsed = Date.now() - changedAt;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}

function formatRemaining(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin >= 1440) return `${Math.ceil(totalMin / 1440)}d`;
  if (totalMin >= 60) return `${Math.ceil(totalMin / 60)}h`;
  return `${totalMin}m`;
}

const inputCls =
  'w-full h-10 bg-black/60 border border-white/10 rounded px-3 text-sm text-white placeholder:text-white/25 focus:border-[#38bdf8] outline-none transition-all font-sans';
const primaryBtn =
  'flex-1 h-10 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 border border-[#38bdf8]/40 hover:border-[#38bdf8]/60 text-[#38bdf8] text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const ghostBtn =
  'flex-1 h-10 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 text-white/70 text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-all';

const SpartanIdentityAccount: React.FC<Props> = ({
  account,
  onRegistered,
  onLoggedIn,
  onLoggedOut,
  onAccountChanged,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  // Logged-out flow
  const [mode, setMode] = useState<LoggedOutMode>('menu');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [recoverCode, setRecoverCode] = useState('');
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  // Logged-in flow
  const [revealCode, setRevealCode] = useState(false);
  const [editField, setEditField] = useState<EditField>(null);
  const [editValue, setEditValue] = useState('');
  const [editCode, setEditCode] = useState('');

  const resetMessages = () => {
    setError('');
    setNotice('');
  };

  const resetLoggedOutForms = () => {
    setEmail('');
    setUsername('');
    setIdentifier('');
    setPassword('');
    setRecoverCode('');
  };

  // ── Logged-out actions ──────────────────────────────────────────────────────
  const handleRegister = async () => {
    resetMessages();
    setBusy(true);
    const res = await apiRegister(email, username, password);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || 'Registration failed.');
      return;
    }
    setNewRecoveryCode(res.data.recoveryCode || res.data.account.recoveryCode);
    resetLoggedOutForms();
    setMode('menu');
    onRegistered(res.data.account);
  };

  const handleLogin = async () => {
    resetMessages();
    setBusy(true);
    const res = await apiLogin(identifier, password);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || 'Login failed.');
      return;
    }
    resetLoggedOutForms();
    setMode('menu');
    onLoggedIn(res.data.account);
  };

  const handleRecover = async () => {
    resetMessages();
    setBusy(true);
    const res = await apiRecover(email, username, recoverCode, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Recovery failed.');
      return;
    }
    resetLoggedOutForms();
    setMode('login');
    setNotice('Password reset. You can now log in.');
  };

  // ── Logged-in actions ───────────────────────────────────────────────────────
  const openEdit = (field: EditField) => {
    resetMessages();
    setEditField(field);
    setEditValue('');
    setEditCode('');
  };

  const handleLogout = async () => {
    resetMessages();
    setBusy(true);
    await apiLogout();
    setBusy(false);
    setEditField(null);
    setRevealCode(false);
    onLoggedOut();
  };

  const handleSubmitEdit = async () => {
    if (!editField) return;
    resetMessages();
    setBusy(true);
    let res;
    if (editField === 'username') res = await apiChangeUsername(editCode, editValue);
    else if (editField === 'email') res = await apiChangeEmail(editCode, editValue);
    else res = await apiChangePassword(editCode, editValue);
    setBusy(false);

    if (!res.ok) {
      setError(res.error || 'Update failed.');
      return;
    }
    if ((editField === 'username' || editField === 'email') && res.data && 'account' in res.data) {
      onAccountChanged((res.data as { account: AccountInfo }).account);
    }
    setNotice(
      editField === 'password' ? 'Password updated.' : `${editField === 'email' ? 'Email' : 'Username'} updated.`
    );
    setEditField(null);
  };

  // Recovery-code banner shown after registration. Rendered in BOTH the logged-out
  // and logged-in views because registering immediately signs the user in — without
  // this they'd never see the assigned code.
  const recoveryBanner = newRecoveryCode ? (
    <div className="bg-amber-950/40 border border-amber-500/40 rounded-lg p-3 flex flex-col gap-1.5">
      <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">
        ⚠ Save Your Recovery Code
      </span>
      <span className="text-2xl font-mono font-black text-amber-200 tracking-[0.4em] text-center py-1">
        {newRecoveryCode}
      </span>
      <span className="text-[10px] text-amber-200/70 leading-snug">
        You need this 4-digit code (plus your email and username) to recover or change your
        account. It won't be shown again here — store it somewhere safe.
      </span>
      <button
        onClick={() => setNewRecoveryCode(null)}
        className="mt-1 h-8 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-bold uppercase rounded cursor-pointer transition-all"
      >
        I've Saved It
      </button>
    </div>
  ) : null;

  // ── Render: logged out ──────────────────────────────────────────────────────
  if (!account) {
    return (
      <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-white/5">
        {recoveryBanner}

        {error && <span className="text-[11px] text-red-400 leading-snug">{error}</span>}
        {notice && <span className="text-[11px] text-emerald-400 leading-snug">{notice}</span>}

        {mode === 'menu' && (
          <>
            <span className="text-[10px] text-white/40 leading-snug">
              Optional: create an account to sync your settings across devices.
            </span>
            <div className="flex gap-2">
              <button onClick={() => { resetMessages(); setMode('login'); }} className={primaryBtn}>
                Log In
              </button>
              <button onClick={() => { resetMessages(); setMode('register'); }} className={ghostBtn}>
                Create Account
              </button>
            </div>
            <button
              onClick={() => { resetMessages(); setMode('recover'); }}
              className="text-[10px] text-white/40 hover:text-[#38bdf8] underline underline-offset-2 transition-colors cursor-pointer self-start"
            >
              Recover account
            </button>
          </>
        )}

        {mode === 'register' && (
          <>
            <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <input className={inputCls} type="text" placeholder="Username (3–16 chars)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <input className={inputCls} type="password" placeholder="Password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <div className="flex gap-2">
              <button onClick={handleRegister} disabled={busy} className={primaryBtn}>{busy ? '…' : 'Create'}</button>
              <button onClick={() => { resetMessages(); setMode('menu'); }} className={ghostBtn}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'login' && (
          <>
            <input className={inputCls} type="text" placeholder="Email or username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
            <input className={inputCls} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <div className="flex gap-2">
              <button onClick={handleLogin} disabled={busy} className={primaryBtn}>{busy ? '…' : 'Log In'}</button>
              <button onClick={() => { resetMessages(); setMode('menu'); }} className={ghostBtn}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'recover' && (
          <>
            <span className="text-[10px] text-white/40 leading-snug">
              Enter your email, username, and 4-digit recovery code to set a new password.
            </span>
            <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={inputCls} type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className={inputCls} type="text" inputMode="numeric" maxLength={4} placeholder="4-digit code" value={recoverCode} onChange={(e) => setRecoverCode(e.target.value.replace(/\D/g, ''))} />
            <input className={inputCls} type="password" placeholder="New password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <div className="flex gap-2">
              <button onClick={handleRecover} disabled={busy} className={primaryBtn}>{busy ? '…' : 'Reset'}</button>
              <button onClick={() => { resetMessages(); setMode('menu'); }} className={ghostBtn}>Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Render: logged in ───────────────────────────────────────────────────────
  const usernameCd = cooldownRemaining(account.usernameChangedAt, USERNAME_COOLDOWN_MS);
  const emailCd = cooldownRemaining(account.emailChangedAt, EMAIL_COOLDOWN_MS);
  const passwordCd = cooldownRemaining(account.passwordChangedAt, PASSWORD_COOLDOWN_MS);

  const editLabel: Record<Exclude<EditField, null>, string> = {
    username: 'New username',
    email: 'New email',
    password: 'New password (8+ chars)',
  };

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-white/5">
      {recoveryBanner}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-emerald-400 uppercase tracking-widest font-mono">● Signed In</span>
        <button
          onClick={handleLogout}
          disabled={busy}
          className="text-[10px] text-white/40 hover:text-red-400 uppercase tracking-wider cursor-pointer transition-colors"
        >
          Log Out
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <span className="text-white/40 uppercase tracking-wider">User</span>
        <span className="text-white font-semibold truncate">{account.username}</span>
        <span className="text-white/40 uppercase tracking-wider">Email</span>
        <span className="text-white/80 truncate">{account.email}</span>
        <span className="text-white/40 uppercase tracking-wider">Code</span>
        <span className="flex items-center gap-2">
          <span className="font-mono tracking-[0.3em] text-[#38bdf8]">
            {revealCode ? account.recoveryCode : '••••'}
          </span>
          <button
            onClick={() => setRevealCode((v) => !v)}
            className="text-[10px] text-white/40 hover:text-[#38bdf8] cursor-pointer transition-colors"
            title={revealCode ? 'Hide recovery code' : 'Reveal recovery code'}
          >
            {revealCode ? '🙈 Hide' : '👁 Show'}
          </button>
        </span>
      </div>

      {error && <span className="text-[11px] text-red-400 leading-snug">{error}</span>}
      {notice && <span className="text-[11px] text-emerald-400 leading-snug">{notice}</span>}

      {!editField && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => openEdit('username')}
            disabled={usernameCd > 0}
            title={usernameCd > 0 ? `Available in ${formatRemaining(usernameCd)}` : undefined}
            className={ghostBtn}
          >
            {usernameCd > 0 ? `User (${formatRemaining(usernameCd)})` : 'Edit User'}
          </button>
          <button
            onClick={() => openEdit('email')}
            disabled={emailCd > 0}
            title={emailCd > 0 ? `Available in ${formatRemaining(emailCd)}` : undefined}
            className={ghostBtn}
          >
            {emailCd > 0 ? `Email (${formatRemaining(emailCd)})` : 'Edit Email'}
          </button>
          <button
            onClick={() => openEdit('password')}
            disabled={passwordCd > 0}
            title={passwordCd > 0 ? `Available in ${formatRemaining(passwordCd)}` : undefined}
            className={ghostBtn}
          >
            {passwordCd > 0 ? `Pass (${formatRemaining(passwordCd)})` : 'Edit Pass'}
          </button>
        </div>
      )}

      {editField && (
        <div className="flex flex-col gap-2 mt-1 bg-black/30 border border-white/5 rounded-lg p-2.5">
          <span className="text-[10px] text-white/40 leading-snug">
            Changing your {editField} requires your 4-digit security code.
          </span>
          <input
            className={inputCls}
            type={editField === 'password' ? 'password' : editField === 'email' ? 'email' : 'text'}
            placeholder={editLabel[editField]}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
          />
          <input
            className={inputCls}
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="4-digit security code"
            value={editCode}
            onChange={(e) => setEditCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex gap-2">
            <button onClick={handleSubmitEdit} disabled={busy} className={primaryBtn}>
              {busy ? '…' : 'Save'}
            </button>
            <button onClick={() => { setEditField(null); resetMessages(); }} className={ghostBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpartanIdentityAccount;
