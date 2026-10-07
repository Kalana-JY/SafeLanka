import { useEffect, useState } from 'react';
import { api } from '../api/client';

function err(e) {
  return e?.response?.data?.error || 'Request failed';
}

const RTYPES = ['TEAM', 'VEHICLE', 'RELIEF', 'OTHER'];

export default function DispatchTab({ district }) {
  const [resources, setResources] = useState([]);
  const [orders, setOrders] = useState([]);
  const [teams, setTeams] = useState([]);
  const [msg, setMsg] = useState('');
  const [rf, setRf] = useState({ name: '', type: 'TEAM', capacity: '' });
  const [of, setOf] = useState({ priority: 'MEDIUM', items: [{ resourceId: '', description: '' }] });
  const [assign, setAssign] = useState({});
  const [abortReason, setAbortReason] = useState({});

  async function load() {
    try {
      const [r, o, u] = await Promise.all([
        api.get(`/resources?district=${encodeURIComponent(district)}`),
        api.get(`/dispatch?district=${encodeURIComponent(district)}`),
        api.get('/users')
      ]);
      setResources(r.data.resources || []);
      setOrders(o.data.orders || []);
      setTeams((u.data.users || []).filter((x) => x.role === 'TEAM_LEADER' && x.active));
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createResource() {
    setMsg('');
    try {
      await api.post('/resources', {
        name: rf.name,
        type: rf.type,
        district,
        ...(rf.capacity ? { capacity: Number(rf.capacity) } : {})
      });
      setRf({ name: '', type: 'TEAM', capacity: '' });
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  function addItem() {
    setOf({ ...of, items: [...of.items, { resourceId: '', description: '' }] });
  }

  function setItem(i, k, v) {
    const items = of.items.map((it, j) => (j === i ? { ...it, [k]: v } : it));
    setOf({ ...of, items });
  }

  async function createOrder() {
    setMsg('');
    try {
      await api.post('/dispatch', {
        district,
        priority: of.priority,
        items: of.items.map((it) => ({ type: 'OTHER', description: it.description, ...(it.resourceId ? { resourceId: it.resourceId } : {}) })),
        clientUUID: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      setOf({ priority: 'MEDIUM', items: [{ resourceId: '', description: '' }] });
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function op(id, action, body) {
    setMsg('');
    try {
      await api.post(`/dispatch/${id}/${action}`, body || {});
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  return (
    <div>
      <h3>Resources</h3>
      <div className="form">
        <input placeholder="Name" value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} />
        <select value={rf.type} onChange={(e) => setRf({ ...rf, type: e.target.value })}>
          {RTYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input placeholder="Capacity (optional)" type="number" value={rf.capacity} onChange={(e) => setRf({ ...rf, capacity: e.target.value })} />
        <button onClick={createResource}>Add resource</button>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Status</th></tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r._id}><td>{r.name}</td><td>{r.type}</td><td>{r.status}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>New dispatch order</h3>
      <div className="form">
        <select value={of.priority} onChange={(e) => setOf({ ...of, priority: e.target.value })}>
          <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
        </select>
        {of.items.map((it, i) => (
          <div key={i} className="row">
            <select value={it.resourceId} onChange={(e) => setItem(i, 'resourceId', e.target.value)}>
              <option value="">Partner/no resource</option>
              {resources.filter((r) => r.status === 'AVAILABLE').map((r) => (
                <option key={r._id} value={r._id}>{r.name} ({r.type})</option>
              ))}
            </select>
            <input placeholder="Need description" value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} />
          </div>
        ))}
        <button onClick={addItem}>+ line</button>
        <button onClick={createOrder}>Create order</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      <h3>Orders</h3>
      <table>
        <thead>
          <tr><th>Ref</th><th>Priority</th><th>Status</th><th>Fulfil</th><th>Team</th><th></th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o._id}>
              <td>{o.ref}</td>
              <td>{o.priority}</td>
              <td>{o.status}{o.unacked ? ' ⚠unacked' : ''}</td>
              <td>{o.fulfillment === 'PARTIAL' ? <span className="amber-tag">PARTIAL — partner lines</span> : 'FULL'}</td>
              <td>{o.teamLeadId?.fullName || '—'}</td>
              <td className="row">
                {o.status === 'CREATED' && <button onClick={() => op(o._id, 'reserve')}>Reserve</button>}
                {o.status === 'RESERVED' && (
                  <>
                    <select value={assign[o._id] || ''} onChange={(e) => setAssign({ ...assign, [o._id]: e.target.value })}>
                      <option value="">Team…</option>
                      {teams.map((t) => <option key={t._id} value={t._id}>{t.fullName}</option>)}
                    </select>
                    <button disabled={!assign[o._id]} onClick={() => op(o._id, 'assign', { teamLeadId: assign[o._id] })}>Assign</button>
                  </>
                )}
                <input placeholder="Abort reason" value={abortReason[o._id] || ''} onChange={(e) => setAbortReason({ ...abortReason, [o._id]: e.target.value })} />
                <button onClick={() => op(o._id, 'abort', { reason: abortReason[o._id] || 'withdrawn' })}>Abort</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
