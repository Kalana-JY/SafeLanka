import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import DispatchTab from './DispatchTab';
import { useI18n, LangSwitcher } from '../context/I18nContext';

function err(e) {
  return e?.response?.data?.error || 'Request failed';
}

export default function District() {
  const { user, signout } = useAuth();
  const { t } = useI18n();
  const [shelters, setShelters] = useState([]);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ buildingName: '', capacity: 100, address: '' });
  const [alts, setAlts] = useState({});
  const [transferTo, setTransferTo] = useState({});
  const [tab, setTab] = useState('Shelters');

  async function load() {
    try {
      const { data } = await api.get(`/shelters?district=${encodeURIComponent(user.district)}`);
      setShelters(data.shelters || []);
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setMsg('');
    try {
      await api.post('/shelters', { ...f, capacity: Number(f.capacity), district: user.district });
      setF({ buildingName: '', capacity: 100, address: '' });
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function op(id, action, body) {
    setMsg('');
    try {
      await api.post(`/shelters/${id}/${action}`, body || {});
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function alternate(id) {
    try {
      const { data } = await api.get(`/shelters/${id}/alternate`);
      setAlts({ ...alts, [id]: data.alternate.shelter });
    } catch {
      setAlts({ ...alts, [id]: null });
    }
  }

  return (
    <div className="container wide">
      <header className="header">
        <h1>{t('appName')} — {user?.district}</h1>
        <span className="badge">{user?.role}</span>
        <LangSwitcher />
        <button onClick={signout}>{t('signOut')}</button>
      </header>
      <nav className="tabs">
        <button disabled={tab === 'Shelters'} onClick={() => setTab('Shelters')}>{t('shelters')}</button>
        <button disabled={tab === 'Dispatch'} onClick={() => setTab('Dispatch')}>{t('dispatch')}</button>
      </nav>
      {tab === 'Dispatch' ? (
        <DispatchTab district={user?.district} />
      ) : (
      <>
      <h3>Register shelter</h3>
      <div className="form">
        <input placeholder="Building name" value={f.buildingName} onChange={set('buildingName')} />
        <input placeholder="Address" value={f.address} onChange={set('address')} />
        <input type="number" min="1" value={f.capacity} onChange={set('capacity')} title="Capacity" />
        <button onClick={create}>Register (PLANNED)</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      <h3>Shelters</h3>
      {shelters.filter((s) => ['NEARLY_FULL', 'FULL'].includes(s.status)).map((s) => (
        <div key={s._id} className="alarm">
          {s.buildingName}: {s.capacity - s.occupancy} places remaining — route arrivals elsewhere.
        </div>
      ))}
      <table>
        <thead>
          <tr><th>Building</th><th>Status</th><th>Occupancy</th><th></th></tr>
        </thead>
        <tbody>
          {shelters.map((s) => (
            <tr key={s._id}>
              <td>{s.buildingName}</td>
              <td>{s.status}</td>
              <td>
                {s.occupancy}/{s.capacity}
                <div className={`gauge ${s.status === 'FULL' ? 'full' : s.status === 'NEARLY_FULL' ? 'warn' : ''}`}>
                  <div style={{ width: `${s.capacity ? Math.round((100 * s.occupancy) / s.capacity) : 0}%` }} />
                </div>
              </td>
              <td className="row">
                {s.status === 'PLANNED' && <button onClick={() => op(s._id, 'open')}>Open</button>}
                {['OPEN', 'NEARLY_FULL', 'FULL'].includes(s.status) && (
                  <>
                    <button onClick={() => alternate(s._id)}>Alternate</button>
                    <button onClick={() => op(s._id, 'close', transferTo[s._id] ? { transferTo: transferTo[s._id] } : {})}>Close</button>
                    <select value={transferTo[s._id] || ''} onChange={(e) => setTransferTo({ ...transferTo, [s._id]: e.target.value })} title="Transfer target">
                      <option value="">No transfer</option>
                      {shelters.filter((o) => o._id !== s._id && ['OPEN', 'NEARLY_FULL'].includes(o.status)).map((o) => (
                        <option key={o._id} value={o._id}>{o.buildingName}</option>
                      ))}
                    </select>
                  </>
                )}
                {alts[s._id] && <span>→ {alts[s._id].buildingName} ({alts[s._id].capacity - alts[s._id].occupancy} free)</span>}
                {alts[s._id] === null && <span>no alternate</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </>
      )}
    </div>
  );
}
