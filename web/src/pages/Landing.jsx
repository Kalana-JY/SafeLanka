import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

const HOME = { DMC_OFFICER: '/dmc', DISTRICT_OFFICER: '/district', WARDEN: '/shelter', TEAM_LEADER: '/team', CITIZEN: '/unauthorized', VOLUNTEER: '/unauthorized' };

export default function Landing() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="container">
      <h1>{t('appName')}</h1>
      <LangSwitcher />
      <p>Smart Disaster Early-Warning and Emergency Coordination System .</p>
      {user ? (
        <p>
          Signed in as {user.fullName} ({user.role}). <Link to={HOME[user.role] || '/unauthorized'}>Go to dashboard</Link>
        </p>
      ) : (
        <p>
          <Link to="/login">{t('signIn')}</Link>
        </p>
      )}
    </div>
  );
}
