import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

function err(e) {
  return e?.response?.data?.error || 'Request failed';
}

export default function ShelterOps() {
  const { user, signout } = useAuth();
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [id, setId] = useState('');
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ name: '', contactNo: '', householdSize: 1, specialNeeds: '' });

  async function loadList() {
    try {
      const { data } = await api.get(`/shelters/open?district=${encodeURIComponent(user.district)}`);
      setList(data.shelters || []);
      if (!id && data.shelters?.length) setId(data.shelters[0].shelter._id);
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function loadDetail(sid) {
    try {
      const { data } = await api.get(`/shelters/${sid}`);
      setDetail(data);
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (id) loadDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function checkin(e) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post(`/shelters/${id}/checkin`, {
        ...f,
        householdSize: Number(f.householdSize),
        clientUUID: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      setF({ name: '', contactNo: '', householdSize: 1, specialNeeds: '' });
      loadDetail(id);
    } catch (e2) {
      setMsg(err(e2));
    }
  }

  async function checkout(recordId) {
    setMsg('');
    try {
      await api.post(`/shelters/${id}/checkout`, { recordId });
      loadDetail(id);
    } catch (e) {
      setMsg(err(e));
    }
  }

  return (
    <div className="container wide">
      <header className="header">
        <h1>{t('shelters')}</h1>
        <span className="badge">{user?.role}</span>
        <LangSwitcher />
        <button onClick={signout}>{t('signOut')}</button>
      </header>
      <select value={id} onChange={(e) => setId(e.target.value)}>
        {list.map((s) => (
          <option key={s.shelter._id} value={s.shelter._id}>
            {s.shelter.buildingName} ({s.occupancy}/{s.capacity} {s.shelter.status})
          </option>
        ))}
      </select>
      {detail && (
        <>
          <h2>
            {detail.shelter.buildingName}: {detail.occupancy}/{detail.capacity} ({detail.shelter.status})
          </h2>
          <div className={`gauge ${detail.shelter.status === 'FULL' ? 'full' : detail.shelter.status === 'NEARLY_FULL' ? 'warn' : ''}`}>
            <div style={{ width: `${detail.capacity ? Math.round((100 * detail.occupancy) / detail.capacity) : 0}%` }} />
          </div>
          {detail.specialNeedsCount > 0 && (
            <p><span className="tag-needs">{detail.specialNeedsCount} need priority dispatch</span></p>
          )}
        </>
      )}
      <h3>Check in</h3>
      <form onSubmit={checkin} className="form">
        <input placeholder="Head of household" value={f.name} onChange={set('name')} />
        <input placeholder="Contact number" value={f.contactNo} onChange={set('contactNo')} />
        <input type="number" min="1" value={f.householdSize} onChange={set('householdSize')} title="Household size" />
        <input placeholder="Special needs (optional)" value={f.specialNeeds} onChange={set('specialNeeds')} />
        <button type="submit">Check in</button>
      </form>
      {msg && <p className="error">{msg}</p>}
      <h3>Checked in ({detail?.activeRecords?.length || 0})</h3>
      <table>
        <thead>
          <tr><th>Name</th><th>Size</th><th>Needs</th><th>In</th><th></th></tr>
        </thead>
        <tbody>
          {(detail?.activeRecords || []).map((r) => (
            <tr key={r._id}>
              <td>{r.evacueeId?.fullName}</td>
              <td>{r.evacueeId?.householdSize}</td>
              <td>{r.specialNeeds ? <span className="tag-needs">{r.specialNeeds}</span> : '—'}</td>
              <td>{new Date(r.checkInAt).toLocaleString()}</td>
              <td><button onClick={() => checkout(r._id)}>Check out</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
