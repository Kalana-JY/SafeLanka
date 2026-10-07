import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

function err(e) {
  return e?.response?.data?.error || 'Request failed';
}

export default function Team() {
  const { user, signout } = useAuth();
  const { t } = useI18n();
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState('');
  const [check, setCheck] = useState({});
  const [ben, setBen] = useState({});
  const [detail, setDetail] = useState({});

  async function load() {
    try {
      const { data } = await api.get('/dispatch/mine');
      setOrders(data.orders || []);
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function op(id, action, body) {
    setMsg('');
    try {
      await api.post(`/dispatch/${id}/${action}`, body || {});
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function toggle(id) {
    if (detail[id]) {
      setDetail({ ...detail, [id]: null });
      return;
    }
    try {
      const { data } = await api.get(`/dispatch/${id}`);
      setDetail({ ...detail, [id]: data });
    } catch (e) {
      setMsg(err(e));
    }
  }

  return (
    <div className="container wide">
      <header className="header">
        <h1>{t('dispatch')}</h1>
        <span className="badge">{user?.role}</span>
        <span>{user?.fullName}</span>
        <LangSwitcher />
        <button onClick={signout}>{t('signOut')}</button>
      </header>
      {msg && <p className="error">{msg}</p>}
      <table>
        <thead>
          <tr><th>Ref</th><th>Priority</th><th>Status</th><th>District</th><th></th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o._id}>
              <td>{o.ref}</td>
              <td>{o.priority}</td>
              <td>{o.status}</td>
              <td>{o.district}</td>
              <td className="row">
                <button onClick={() => toggle(o._id)}>Details</button>
                {o.status === 'SENT' && <button onClick={() => op(o._id, 'ack')}>Accept</button>}
                {o.status === 'ACKED' && (
                  <>
                    <label><input type="checkbox" checked={!!check[o._id]?.route} onChange={(e) => setCheck({ ...check, [o._id]: { ...check[o._id], route: e.target.checked } })} /> route</label>
                    <label><input type="checkbox" checked={!!check[o._id]?.weather} onChange={(e) => setCheck({ ...check, [o._id]: { ...check[o._id], weather: e.target.checked } })} /> weather</label>
                    <button onClick={() => op(o._id, 'arrive', { routeChecked: !!check[o._id]?.route, weatherChecked: !!check[o._id]?.weather })}>Depart</button>
                  </>
                )}
                {o.status === 'EN_ROUTE' && (
                  <>
                    <input placeholder="Beneficiaries" type="number" value={ben[o._id] || ''} onChange={(e) => setBen({ ...ben, [o._id]: e.target.value })} />
                    <button onClick={() => op(o._id, 'distribute', { beneficiaries: Number(ben[o._id]) })}>Record distribution</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.entries(detail).map(([id, d]) => d && (
        <div key={id}>
          <h4>{d.order.ref} lines</h4>
          <ul>
            {d.order.items.map((it, i) => (
              <li key={i}>{it.description || it.type} — {it.status}{it.partnerNote ? ` (${it.partnerNote})` : ''}</li>
            ))}
          </ul>
          {d.distribution && <p>Distributed to {d.distribution.beneficiaries} beneficiaries.</p>}
        </div>
      ))}
    </div>
  );
}
