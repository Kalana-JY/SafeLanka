import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';

const TABS = ['Verify', 'Alerts', 'Users'];
const LEVELS = ['WATCH', 'WARNING', 'EVACUATE', 'ALL_CLEAR'];

function err(e) {
  return e?.response?.data?.error || 'Request failed';
}

function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- Verify tab ---------------- */

function VerifyTab() {
  const [queue, setQueue] = useState([]);
  const [sel, setSel] = useState(null); // {report, evidence}
  const [lock, setLock] = useState(null);
  const [lockErr, setLockErr] = useState('');
  const [score, setScore] = useState(50);
  const [remarks, setRemarks] = useState('');
  const [station, setStation] = useState('ARANAYAKE-RG-01');
  const [readAt, setReadAt] = useState('');
  const [decision, setDecision] = useState('VERIFIED');
  const [escalate, setEscalate] = useState('');
  const [secondIds, setSecondIds] = useState('');
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/reports/queue');
      setQueue(data.queue || []);
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stale = !readAt || Date.now() - new Date(readAt).getTime() > 30 * 60 * 1000;

  async function open(id) {
    setResult(null);
    setMsg('');
    setLockErr('');
    try {
      const { data } = await api.get(`/reports/${id}`);
      setSel(data);
      setScore(Math.min(data.report.credibility, 60));
      try {
        const l = await api.post(`/reports/${id}/lock`);
        setLock(l.data);
      } catch (e) {
        setLock(null);
        setLockErr(e?.response?.status === 423 ? 'Locked by another officer — read-only' : err(e));
      }
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function close() {
    if (sel && lock) {
      try {
        await api.delete(`/reports/${sel.report._id}/lock`);
      } catch {
        // lease expiry covers failures
      }
    }
    setSel(null);
    setLock(null);
    setRemarks('');
    setEscalate('');
    setSecondIds('');
    setResult(null);
  }

  async function verify() {
    setMsg('');
    try {
      const body = {
        decision,
        score: Number(score),
        remarks,
        secondReportIds: secondIds.split(',').map((s) => s.trim()).filter(Boolean)
      };
      if (escalate) body.escalate = escalate;
      if (station) body.sensorStationId = station;
      if (readAt) body.sensorReadAt = new Date(readAt).toISOString();
      const { data } = await api.post(`/reports/${sel.report._id}/verify`, body);
      setResult(data);
      setLock(null);
      load();
    } catch (e) {
      setMsg(err(e) + (e?.response?.data?.sources ? ` (sources: ${e.response.data.sources.join(',') || 'none'})` : ''));
    }
  }

  if (sel) {
    const r = sel.report;
    const hasPhoto = sel.evidence.some((ev) => ev.mediaType === 'PHOTO');
    return (
      <div>
        <button onClick={close}>← Back to queue</button>
        <h3>
          {r.ref} · {r.hazardType} · {r.status}
        </h3>
        {lock ? (
          <p className="ok">🔒 Lock held until {new Date(lock.lockedUntil).toLocaleTimeString()}</p>
        ) : (
          <p className="error">{lockErr}</p>
        )}
        {stale && (
          <div className="banner-fail">Stale/missing gauge reading — judging on photographic evidence alone. Score ≤ 60.</div>
        )}
        <div className="composer-grid">
          <div className="rail">
            <h4>Queue</h4>
            {queue.filter((q) => q.report._id !== r._id).slice(0, 8).map((q) => (
              <button key={q.report._id} className="rail-item" onClick={() => open(q.report._id)}>
                {q.report.ref} ({q.report.credibility}){q.slaBreached ? ' ⚠' : ''}
              </button>
            ))}
          </div>
          <div>
            <div className="alert-card">
              <b>Credibility {r.credibility}</b> · photo {hasPhoto ? '✓' : '✗'} ·{' '}
              {r.sensorCorroborated ? 'sensor agrees (+15)' : 'no sensor agreement'}
              <br />
              Reporter: {r.reporterId?.fullName} <span className="amber-tag">{r.reporterId?.role}</span>
            </div>
            <p>{r.description}</p>
            {sel.evidence.map((ev) => (
              <div key={ev._id}>
                {ev.mediaType === 'PHOTO' && ev.data ? (
                  <img src={`data:image/jpeg;base64,${ev.data}`} alt="evidence" style={{ maxWidth: 320 }} />
                ) : (
                  <p>
                    [{ev.mediaType}] {ev.sizeKb}KB · {new Date(ev.capturedAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
            <h4>Gauge (stub ARANAYAKE-RG-01)</h4>
            <div className="form">
              <input placeholder="Station ID" value={station} onChange={(e) => setStation(e.target.value)} />
              <input type="datetime-local" value={readAt} onChange={(e) => setReadAt(e.target.value)} />
              {stale ? (
                <p className="error">STALE — score ≤ 60, remarks must note STALE_SENSOR</p>
              ) : (
                <p className="ok">Fresh reading — counts as escalation source</p>
              )}
            </div>
          </div>
          <div>
            <h4>Decision</h4>
            <div className="form">
              <input type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
              {stale && Number(score) > 60 && <p className="error">Over the stale cap — lower it or add a fresh reading</p>}
              <input placeholder="Remarks (reasoning + evidence refs)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option>VERIFIED</option>
                <option>UNDER_REVIEW</option>
                <option>REJECTED</option>
              </select>
              <select value={escalate} onChange={(e) => setEscalate(e.target.value)}>
                <option value="">No escalation</option>
                <option value="WARNING">Escalate → WARNING</option>
                <option value="EVACUATE">Escalate → EVACUATE</option>
              </select>
              {escalate && <p>Escalation needs ≥2 sources (photo / fresh sensor / second report / volunteer).</p>}
              <input placeholder="Second report IDs (comma separated)" value={secondIds} onChange={(e) => setSecondIds(e.target.value)} />
            </div>
            <div className="commitbar">
              <button onClick={verify} disabled={!lock}>Record decision</button>
            </div>
            {msg && <p className="error">{msg}</p>}
            {result && (
              <p className="ok">
                Recorded {result.record.decision} (score {result.record.score}, sources: {result.sources.join(',') || 'none'})
                {result.event ? ` · event now ${result.event.level}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={load}>Refresh queue</button>
      {msg && <p className="error">{msg}</p>}
      <table>
        <thead>
          <tr><th>Ref</th><th>Type</th><th>Status</th><th>Cred</th><th>Wait</th><th>Flags</th><th></th></tr>
        </thead>
        <tbody>
          {queue.map((q) => (
            <tr key={q.report._id}>
              <td>{q.report.ref}</td>
              <td>{q.report.hazardType}</td>
              <td>{q.report.status}</td>
              <td>{q.report.credibility}</td>
              <td>{q.waitingMin}m</td>
              <td>
                {q.slaBreached ? '⚠SLA ' : ''}
                {q.report.lockedBy ? '🔒locked' : ''}
              </td>
              <td><button onClick={() => open(q.report._id)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Alerts tab ---------------- */

function AlertsTab() {
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [areas, setAreas] = useState([]);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ eventId: '', targetAreaId: '', level: 'WARNING', en: '', si: '', ta: '', enBody: '', siBody: '', taBody: '', hours: 2, secondBy: '' });
  const [reach, setReach] = useState(null);
  const [created, setCreated] = useState(null);

  async function load() {
    try {
      const [a, e] = await Promise.all([api.get('/alerts'), api.get('/events')]);
      setAlerts(a.data.alerts || []);
      setEvents(e.data.events || []);
    } catch (e2) {
      setMsg(err(e2));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!f.eventId) return;
    api.get(`/areas?eventId=${f.eventId}`).then(({ data }) => setAreas(data.areas || [])).catch(() => {});
  }, [f.eventId]);

  useEffect(() => {
    if (!f.targetAreaId) {
      setReach(null);
      return;
    }
    api.get(`/areas/${f.targetAreaId}/reach`).then(({ data }) => setReach(data)).catch(() => setReach(null));
  }, [f.targetAreaId]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setMsg('');
    try {
      const exp = new Date(Date.now() + Number(f.hours) * 3600 * 1000).toISOString();
      const { data } = await api.post('/alerts', {
        eventId: f.eventId,
        targetAreaId: f.targetAreaId,
        level: f.level,
        headline: { en: f.en, si: f.si, ta: f.ta },
        body: { en: f.enBody, si: f.siBody, ta: f.taBody },
        expiresAt: exp
      });
      setMsg(`Draft created — reach ${data.reach}`);
      setCreated(data.alert);
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function act(id, action, body) {
    setMsg('');
    try {
      const { data } = await api.post(`/alerts/${id}/${action}`, body || {});
      setMsg(`${action}: ${JSON.stringify(data.summary || data.alert?.status || 'ok')}`);
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  async function reissue(id) {
    setMsg('');
    try {
      const exp = new Date(Date.now() + 3600 * 1000).toISOString();
      const { data } = await api.post(`/alerts/${id}/reissue`, { expiresAt: exp });
      setCreated(data.alert);
      setMsg(`Reissued as v${data.alert.version} draft — review, then Publish below.`);
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  const curEvent = events.find((e) => e._id === f.eventId);
  const complete =
    f.eventId && f.targetAreaId && f.en.trim() && f.si.trim() && f.ta.trim() &&
    f.enBody.trim() && f.siBody.trim() && f.taBody.trim();
  const blockReason = !complete ? 'Headline + body required in EN, SI and TA' : '';
  const sms = (s) => s.length;
  const target = created || null;

  async function publishTarget() {
    if (!target) return;
    await act(target._id, 'publish', f.level === 'EVACUATE' && f.secondBy ? { secondConfirmedBy: f.secondBy } : {});
    setCreated(null);
  }

  return (
    <div>
      <h3>Alert composer</h3>
      <div className="composer-grid">
        <div className="rail">
          <h4>Hazard events</h4>
          {events.map((e) => (
            <button
              key={e._id}
              className={`rail-item ${f.eventId === e._id ? 'active' : ''} sev-${e.level}`}
              onClick={() => setF({ ...f, eventId: e._id, targetAreaId: '' })}
            >
              {e.name} ({e.level})
            </button>
          ))}
        </div>
        <div>
          <h4>Target area {curEvent && <span className="amber-tag">current: {curEvent.level}</span>}</h4>
          <select value={f.targetAreaId} onChange={set('targetAreaId')}>
            <option value="">Area…</option>
            {areas.map((a) => <option key={a._id} value={a._id}>{a.name} ({a.district})</option>)}
          </select>
          {reach && <p className="reach">{reach.reach.toLocaleString()} recipients</p>}
          {reach && <p>District {reach.district} · est. population {reach.estPopulation?.toLocaleString()}</p>}
          <h4>Severity</h4>
          <div className="ladder">
            {LEVELS.map((l) => (
              <button
                key={l}
                className={`ladder-step sev-${l} ${curEvent?.level === l ? 'current' : ''} ${f.level === l ? 'proposed' : ''}`}
                onClick={() => setF({ ...f, level: l })}
                title={curEvent?.level === l ? 'Current event level' : l}
              >
                {l}
              </button>
            ))}
          </div>
          <p>Proposing <b>{f.level}</b>{curEvent ? ` (event now ${curEvent.level})` : ''}</p>
          <label>Expires in (hours, max 12): <input type="number" min="1" max="12" value={f.hours} onChange={set('hours')} /></label>
          {f.level === 'EVACUATE' && (
            <div className="form">
              <input placeholder="Second officer user ID (maker-checker)" value={f.secondBy} onChange={set('secondBy')} />
            </div>
          )}
        </div>
        <div>
          <h4>Message (3 languages required)</h4>
          {[['en', 'EN'], ['si', 'SI'], ['ta', 'TA']].map(([k, label]) => (
            <div key={k} className="form">
              <input placeholder={`Headline ${label}`} value={f[k]} onChange={set(k)} />
              <input placeholder={`Body ${label}`} value={f[k + 'Body']} onChange={set(k + 'Body')} />
              <span className={`smscount ${(f[k + 'Body'] || '').length > 160 ? 'over' : ''}`}>
                SMS {sms(f[k + 'Body'] || '')}/160
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="commitbar">
        <button onClick={create}>Save draft{reach ? ` — reaches ${reach.reach.toLocaleString()}` : ''}</button>
        <button onClick={publishTarget} disabled={!target || !complete}>
          Publish{target ? ` v${target.version}` : ''}
        </button>
        {(!target || !complete) && <span className="error">{!target ? 'Save a draft first. ' : ''}{blockReason}</span>}
      </div>
      {msg && <p className={msg.startsWith('Draft') || msg.startsWith('publish') || msg.startsWith('retry') ? 'ok' : 'error'}>{msg}</p>}
      <h3>Alerts</h3>
      {alerts.map((a) => {
        const d = a.delivery || {};
        const failed = d.failed ?? 0;
        const channels = d.perChannel || [];
        return (
          <div key={a._id} className={`alert-card sev-${a.level}`}>
            <b>{a.level}</b> · v{a.version} · {a.status}
            {channels.map((c) => (
              <div key={c.channel}>
                {c.channel}: {c.delivered}/{c.attempted}
                <div className="channelbar">
                  <div style={{ width: c.attempted ? `${Math.round((100 * c.delivered) / c.attempted)}%` : '0%' }} />
                </div>
              </div>
            ))}
            {a.status === 'PUBLISHED' && failed > 0 && (
              <div className="banner-fail">
                {failed} queued on failed channels.
                <button onClick={() => act(a._id, 'retry', {})}>Retry now</button>
              </div>
            )}
            {a.status === 'PUBLISHED' && (d.attempted ?? 0) > 0 && failed === 0 && (
              <p className="coverage">Every citizen received at least one channel.</p>
            )}
            <div className="row">
              {a.status === 'DRAFT' && <button onClick={() => { setCreated(a); setMsg('Loaded into composer — review, then Publish below.'); }}>Load into composer</button>}
              {a.status === 'PUBLISHED' && <button onClick={() => reissue(a._id)}>Reissue update</button>}
              <button onClick={() => act(a._id, 'cancel', { reason: 'withdrawn by DMC' })}>Cancel</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Users tab ---------------- */

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/users');
      setUsers(data.users || []);
    } catch (e) {
      setMsg(err(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(id) {
    try {
      await api.patch(`/users/${id}/role`, { role: 'VOLUNTEER' });
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  return (
    <div>
      <button onClick={load}>Refresh</button>
      {msg && <p className="error">{msg}</p>}
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>District</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u._id}>
              <td>{u.fullName}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.district}</td>
              <td>{u.role === 'CITIZEN' && <button onClick={() => approve(u._id)}>Make volunteer</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function Dmc() {
  const [tab, setTab] = useState('Verify');
  const { user, signout } = useAuth();
  const { t } = useI18n();
  return (
    <div className="container wide">
      <header className="header">
        <h1>{t('appName')}</h1>
        <span className="badge">{user?.role}</span>
        <span>{user?.fullName}</span>
        <LangSwitcher />
        <button onClick={signout}>{t('signOut')}</button>
      </header>
      <nav className="tabs">
        {TABS.map((tb) => (
          <button key={tb} disabled={tab === tb} onClick={() => setTab(tb)}>{t(tb.toLowerCase())}</button>
        ))}
      </nav>
      {tab === 'Verify' && <VerifyTab />}
      {tab === 'Alerts' && <AlertsTab />}
      {tab === 'Users' && <UsersTab />}
    </div>
  );
}
