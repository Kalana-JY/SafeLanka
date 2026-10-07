import { distanceM } from './geo.js';

// Stub sensor network (UC-02/UC-03): one demo rain gauge near Aranayake.
// Real Hazard Sensor Network polling arrives in a later step.
export const DEMO_GAUGE = { stationId: 'ARANAYAKE-RG-01', lat: 7.05, lng: 80.23 };
export const SENSOR_RADIUS_M = 1000;

// usecase.md UC-02 credibility seed. Transparent: reasons returned for the officer UI.
export function scoreCredibility({ role, hasEvidence, lat, lng }) {
  let score = 50;
  const reasons = ['base:50'];
  if (role === 'VOLUNTEER') {
    score += 20;
    reasons.push('volunteer:+20');
  }
  if (!hasEvidence) {
    score -= 30;
    reasons.push('no-evidence:-30');
  }
  const nearSensor = distanceM(lat, lng, DEMO_GAUGE.lat, DEMO_GAUGE.lng) <= SENSOR_RADIUS_M;
  if (nearSensor) {
    score += 15;
    reasons.push('sensor-nearby:+15');
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, nearSensor };
}

export function generateReportRef() {
  return 'GR-' + Math.floor(1000 + Math.random() * 9000);
}
