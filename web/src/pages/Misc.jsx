import { Link } from 'react-router-dom';

export function Unauthorized() {
  return (
    <div className="container">
      <h1>403 — Not authorized</h1>
      <p>Your role cannot access this page.</p>
      <Link to="/">Back to home</Link>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="container">
      <h1>404 — Not found</h1>
      <Link to="/">Back to home</Link>
    </div>
  );
}

export function ComingSoon() {
  return (
    <div className="container">
      <h1>Dashboard coming soon</h1>
      <p>This role dashboard arrives in Step 5/6 (shelters, dispatch).</p>
      <Link to="/">Back to home</Link>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div>
        <b>SafeLanka</b> — Smart Disaster Early-Warning &amp; Emergency Coordination · SE3070 Group 01
      </div>
      <div className="foot-row">
        <span>DMC hotline: 117</span>
        <span>Emergency: 118 / 1919</span>
        <span>Citizen alerts: EN / SI / TA</span>
      </div>
      <div className="foot-row">
        <span>© 2026 SafeLanka · Assignment demo build</span>
      </div>
    </footer>
  );
}
