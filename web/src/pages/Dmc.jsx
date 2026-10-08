import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n, LangSwitcher } from '../context/I18nContext';
import ReportMap from '../components/ReportMap';

const TABS = ['Verify', 'Alerts', 'Users'];
const LEVELS = ['WATCH', 'WARNING', 'EVACUATE', 'ALL_CLEAR'];
const MESSAGE_LANGS = [
  { id: 'en', label: 'English', head: 'en', body: 'enBody' },
  { id: 'si', label: 'Sinhala', head: 'si', body: 'siBody' },
  { id: 'ta', label: 'Tamil', head: 'ta', body: 'taBody' }
];

function textOf(value, lang) {
  if (typeof value === 'string') return lang === 'en' ? value : '';
  return value?.[lang] || '';
}

function languageGaps(form) {
  return MESSAGE_LANGS
    .filter((lang) => !form[lang.head].trim() || !form[lang.body].trim())
    .map((lang) => `${lang.label} headline and body are required.`);
}

function draftMatchesForm(alert, form) {
  if (!alert) return false;
  if (alert.level !== form.level) return false;
  const areaId = typeof alert.targetAreaId === 'object' ? alert.targetAreaId?._id : alert.targetAreaId;
  if (areaId && form.targetAreaId && String(areaId) !== String(form.targetAreaId)) return false;
  return MESSAGE_LANGS.every(
    (lang) => textOf(alert.headline, lang.id) === form[lang.head].trim() && textOf(alert.body, lang.id) === form[lang.body].trim()
  );
}

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
            <h4>Location (OpenStreetMap — free)</h4>
            <ReportMap lat={r.lat} lng={r.lng} refLabel={`${r.ref} · ${r.hazardType}`} />
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
  const [f, setF] = useState({
    eventId: '',
    targetAreaId: '',
    level: 'WARNING',
    en: '',
    enBody: '',
    si: '',
    siBody: '',
    ta: '',
    taBody: '',
    hours: 2,
    secondBy: ''
  });
  const [messageLang, setMessageLang] = useState('en');
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
        headline: { en: f.en.trim(), si: f.si.trim(), ta: f.ta.trim() },
        body: { en: f.enBody.trim(), si: f.siBody.trim(), ta: f.taBody.trim() },
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
      loadIntoComposer(data.alert);
      setMsg(`Reissued as v${data.alert.version} draft — review, then Publish below.`);
      load();
    } catch (e) {
      setMsg(err(e));
    }
  }

  const curEvent = events.find((e) => e._id === f.eventId);
  const gaps = languageGaps(f);
  const complete = Boolean(f.eventId && f.targetAreaId && gaps.length === 0);
  const target = created || null;
  const savedMatches = draftMatchesForm(target, f);
  const activeLang = MESSAGE_LANGS.find((lang) => lang.id === messageLang) || MESSAGE_LANGS[0];

  function loadIntoComposer(alert) {
    const eventId = typeof alert.eventId === 'object' ? alert.eventId?._id : alert.eventId;
    const targetAreaId = typeof alert.targetAreaId === 'object' ? alert.targetAreaId?._id : alert.targetAreaId;
    setF({
      ...f,
      eventId: eventId || f.eventId,
      targetAreaId: targetAreaId || '',
      level: alert.level || f.level,
      en: textOf(alert.headline, 'en'),
      enBody: textOf(alert.body, 'en'),
      si: textOf(alert.headline, 'si'),
      siBody: textOf(alert.body, 'si'),
      ta: textOf(alert.headline, 'ta'),
      taBody: textOf(alert.body, 'ta')
    });
    setCreated(alert);
    setMsg('Loaded into composer — review, then Publish below.');
  }

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
            {areas.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name} ({Array.isArray(a.districts) && a.districts.length ? a.districts.join(', ') : a.district})
              </option>
            ))}
          </select>
          {reach && (
            <div>
              <p className="reach">{Number(reach.reach || 0).toLocaleString()} eligible recipients</p>
              <p>Opted out in this area: {Number(reach.excluded || 0).toLocaleString()}</p>
              {reach.estPopulation != null && <p>Estimated population {Number(reach.estPopulation).toLocaleString()}</p>}
              <p><b>Districts</b></p>
              <ul className="reach-list">
                {(reach.districts || []).map((row) => (
                  <li key={row.district}>{row.district}: {Number(row.eligible || 0).toLocaleString()}</li>
                ))}
              </ul>
              <p><b>Languages</b></p>
              <ul className="reach-list">
                <li>English: {Number(reach.languages?.en || 0).toLocaleString()}</li>
                <li>Sinhala: {Number(reach.languages?.si || 0).toLocaleString()}</li>
                <li>Tamil: {Number(reach.languages?.ta || 0).toLocaleString()}</li>
              </ul>
            </div>
          )}
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
          <h4>Message</h4>
          <nav className="tabs" aria-label="Warning language">
            {MESSAGE_LANGS.map((lang) => (
              <button key={lang.id} type="button" disabled={messageLang === lang.id} onClick={() => setMessageLang(lang.id)}>
                {lang.label}
              </button>
            ))}
          </nav>
          <div className="form">
            <label htmlFor="alert-headline">{activeLang.label} headline</label>
            <input id="alert-headline" value={f[activeLang.head]} onChange={set(activeLang.head)} />
            <label htmlFor="alert-body">{activeLang.label} body</label>
            <input id="alert-body" value={f[activeLang.body]} onChange={set(activeLang.body)} />
            {MESSAGE_LANGS.map((lang) => (
              <span key={lang.id} className={`smscount ${(f[lang.body] || '').length > 160 ? 'over' : ''}`}>
                {lang.label} SMS {(f[lang.body] || '').length}/160
              </span>
            ))}
          </div>
          {gaps.map((gap) => <p key={gap} className="error">{gap}</p>)}
        </div>
      </div>
      <div className="commitbar">
        <button onClick={create}>Save draft{reach ? ` — reaches ${Number(reach.reach || 0).toLocaleString()}` : ''}</button>
        <button onClick={publishTarget} disabled={!target || !complete || !savedMatches}>
          Publish{target ? ` v${target.version}` : ''}
        </button>
        {!target && <span className="error">Save a draft first.</span>}
        {target && !complete && <span className="error">Publish stays disabled until every language has a headline and a body.</span>}
        {target && complete && !savedMatches && <span className="error">Save a new draft before publishing so these languages are stored.</span>}
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
              {a.status === 'DRAFT' && <button onClick={() => loadIntoComposer(a)}>Load into composer</button>}
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
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="container wide">
      <header className="header">
        <h1>{t('appName')}</h1>
        <span className="badge">{user?.role}</span>
        <span>{user?.fullName}</span>
        <LangSwitcher />
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
