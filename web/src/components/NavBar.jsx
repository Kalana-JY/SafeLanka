import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

const HOME = { DMC_OFFICER: '/dmc', DISTRICT_OFFICER: '/district', WARDEN: '/shelter', TEAM_LEADER: '/team' };

export default function NavBar() {
  const { user, signout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  function out() {
    signout();
    navigate('/', { replace: true });
  }

  return (
    <nav className="navbar">
      <Link to="/" className="brand">
        <span className="brand-dot" /> SafeLanka
      </Link>
      <span className="nav-links">
        {user && HOME[user.role] && <Link to={HOME[user.role]}>{t('dashboard')}</Link>}
      </span>
      <span className="nav-right">
        <LangSwitcher />
        {user ? (
          <>
            <span className="badge">{user.role}</span>
            <button onClick={out}>{t('signOut')}</button>
          </>
        ) : (
          <Link to="/login">{t('signIn')}</Link>
        )}
      </span>
    </nav>
  );
}
