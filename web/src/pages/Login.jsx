import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

const HOME = { DMC_OFFICER: '/dmc', DISTRICT_OFFICER: '/district', WARDEN: '/shelter', TEAM_LEADER: '/team' };

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { signin } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const user = await signin(email, password);
      navigate(HOME[user.role] || '/unauthorized', { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || 'Sign in failed');
    }
  }

  return (
    <div className="container narrow">
      <h1>{t('signIn')}</h1>
      <LangSwitcher />
      <form onSubmit={submit} className="form">
        <input placeholder={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder={t('password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button type="submit">{t('signIn')}</button>
      </form>
    </div>
  );
}
