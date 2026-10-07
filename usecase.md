# SafeLanka — Use Cases (Reviewed + Improved)

Source: `SE3070-Group01-Assignment01-Report.pdf` (75p, Group 01, 5 business UCs).
Perspective: system / actor-goal level, not website/UI level. No screens, buttons, or layouts below — only actor intent, system responsibilities, and business rules.

## UC-01 Issue Hazard Warning — DMC Duty Officer

Original scenario: Issue Flood Warning for Kalu Ganga Basin. Strong points: 4-level decomposition, per-citizen-per-channel `DeliveryReceipt`, E1 partial-failure as designed state.

Gaps:
- No mandatory expiry; stale WARNING can live forever.
- Single officer can raise to EVACUATE alone.
- No minimum-coverage rule; 60% delivered still looks like success.
- Reissue overwrites rather than versions.

Improved UC-01:
- **Trigger:** `HazardEvent.level` needs raise + officer decision.
- **Pre:** officer has `issueAuthority(district)`, `HazardEvent` exists, `TargetArea` valid + population > 0, ≥1 `AlertChannel.enabled`.
- **Main:** 1. create `Alert(v+1)` linked to `HazardEvent` 2. define `TargetArea` 3. `resolveRecipients()` → show count 4. set `level`, `headline/body[si,ta,en]`, `expiresAt` (mandatory) 5. `publish()` → `raiseLevel()` → `broadcast()` per channel → `DeliveryReceipt` per recipient/channel → `DeliverySummary`.
- **Add rules:**
  1. `expiresAt` required, max 12h; expired alerts auto-transition to `EXPIRED`, never deleted.
  2. EVACUATE requires 2-officer confirm (maker-checker). Second confirm logged in `VerificationRecord`-style audit.
  3. Coverage SLA: if `successRate < 95%` in 10 min → auto `retryFailed()` + escalate to backup channel (siren → SMS).
  4. Versioning: `Alert.version` increments on reissue; citizens see "Update 2/3", old version retained for audit.
  5. Overlap guard: if active alert overlaps >30% area + same hazard → block + force merge/confirm.
- **Improvement summary:** expiry + 4-eyes for EVACUATE + coverage SLA + versioning. Same flow, safer legal record.

## UC-02 Submit Citizen Ground Report — Citizen / Volunteer

Original: Report Landslide Crack at Aranayake. Strong: offline queue, sensor correlation, E1 blocked-state.

Gaps:
- Photo mandatory blocks legitimate reports at night / in danger / low-battery.
- No spam throttle; one user can flood queue.
- No privacy handling for faces / plates in evidence.
- Volunteer higher credibility is implicit, not quantified.

Improved UC-02:
- **Trigger:** citizen observes hazard.
- **Pre:** registered `Citizen`, app authenticated, location available (GPS or manual pin).
- **Main:** `captureReport()` → pin `GeoLocation` → `classifyHazard()` → attach `Evidence[0..*]` → `submitReport()` → `correlateSensor()` → status `SUBMITTED` → enqueue for UC-03.
- **Add rules:**
  1. Evidence optional but scored: 0-evidence allowed → auto `credibility -= 30`, status `UNDER_REVIEW`, system prompts follow-up in 1h. 1+ photo/voice required for auto-prioritise.
  2. Throttle: max 5 reports / user / hour, max 3 pending offline; beyond → warn + merge suggestion.
  3. Privacy: server-side blur faces/plates in `Evidence.thumbnail()` before officer view; original retained encrypted.
  4. Credibility seed: `Volunteer +20`, `Citizen +0`, 0-evidence `-30`, sensor-nearby `+15`. Transparent, shown to officer in UC-03, not to citizen as score.
  5. Dedupe assist: if report within `duplicateRadiusM=500m` + same `hazardType` + 6h → offer "support existing" client-side before creating new.
- **Improvement summary:** allow no-evidence low-trust reports instead of blocking, throttle + privacy + explicit scoring. Increases coverage without flooding verifiers.

## UC-03 Verify Citizen Ground Report — DMC Duty Officer

Original: Verify Landslide Report vs Aranayake rain gauge. Strong: stale-sensor E1 as allowed-degraded path, escalation as separate confirm.

Gaps:
- Stale sensor + single photo can still escalate to EVACUATE.
- No verification SLA; queue can starve.
- Concurrent open by 2 officers causes late conflict (E3) instead of preventing it.
- Credibility score assignment is opaque.

Improved UC-03:
- **Trigger:** `GroundReport.status == QUEUED/SUBMITTED` enters queue.
- **Pre:** officer has `verifyAuthority`, report has `GeoLocation`, ≥0 `Evidence`, sensor feed known (fresh or stale-flagged).
- **Main:** open queue → lock report → review `Evidence` + `SensorReading.trend(2h)` → assign `credibility[0-100]` with reason codes → `verifyReport()` → create `VerificationRecord(officer, decision, sensorId, score)` → `markVerified()` → optional `escalate()`.
- **Add rules:**
  1. Two-source rule for escalation: `EVACUATE/WARNING` escalation requires ≥2 of {clear photo, fresh sensor breach, 2nd independent report, volunteer corroboration}. Else max decision = `UNDER_REVIEW`.
  2. Pessimistic lock: opening report sets `lockedBy + 5min lease`; second officer sees read-only + waiter count. Eliminates E3 overwrite.
  3. SLA: `QUEUED > 15min` (WARNING area) auto-bumps priority + notifies senior officer. Queue ordered by `severity × credibility × age`.
  4. Score rubric (stored, auditable): photo clarity 0-30 + sensor agreement 0-30 + reporter history 0-20 + proximity/recency 0-20. Officer adjusts, system shows breakdown.
  5. Stale-sensor cap: if `readAt > 30min` → max credibility 60, `VerificationRecord.remarks` must note `STALE_SENSOR`.
- **Improvement summary:** escalation needs corroboration, lock prevents conflicts, SLA + rubric make decisions consistent and auditable.

## UC-04 Coordinate Emergency Shelter — District Officer / Warden

Original: Open Ratnapura Central College (480) + 90% alarm + E4 redirect-chain. Strong: live occupancy, special-needs flag feeding UC-05.

Gaps:
- Binary OPEN/FULL misses the "nearly full" citizen-facing state machine.
- No reconciliation; drift between warden tally and system count grows.
- No close/return flow; shelter stays OPEN forever.
- Offline check-ins can double-count on sync.

Improved UC-04:
- **Trigger:** `HazardEvent.level == EVACUATE` for district.
- **Pre:** officer has `coordinateAuthority(district)`, building registered with `capacity`, warden assigned.
- **Main:** `openShelter()` → publish status (reuse `resolveRecipients`) → `checkIn(Evacuee)` loop → `occupancy()` → at 90% `raiseCapacityAlarm()` → `findAlternate()` → republish `NEARLY_FULL/FULL` + redirect.
- **Add rules:**
  1. Explicit lifecycle: `PLANNED → OPEN → NEARLY_FULL(≥90%) → FULL(100%) → CLOSED`. Publish on every transition; citizens subscribed to area get delta push.
  2. Reconciliation: every 2h (or 50 check-ins) warden confirms headcount; mismatch → `OccupancySummary.disputed=true` + officer review task. Prevents silent drift.
  3. Idempotent offline sync: each `EvacueeRecord` carries `clientUUID`; server dedupes on `flush()`. Duplicate NIC+name within 6h → warn, don't auto-create (keeps E3 but without double count).
  4. Close flow: `closeShelter()` requires `occupancy==0` or explicit transfer of remaining to alternate + checkout timestamps. Closed shelter retains records for audit.
  5. Vulnerability priority: `specialNeeds` flag auto-creates prioritised need entry for UC-05 (elderly/medical/mobility), with consent flag, not free text.
- **Improvement summary:** state machine + reconcile + idempotent sync + close flow. Same check-in loop, no lost or double-counted evacuees.

## UC-05 Dispatch Response Resources — District Officer / Team Leader

Original: Dispatch team + consignment to Kuruwita. Strong: reserve-before-assign, E1 conflict as recoverable state, partner fallback.

Gaps:
- No team-ack timeout; order can hang as SENT forever.
- No en-route / safety gate; team dispatched into blocked road.
- Resources never show return-to-available; E5 notes stuck DEPLOYED.
- Partial fulfilment not modelled; whole order blocks on one missing item.

Improved UC-05:
- **Trigger:** verified need (shelter alarm, UC-03 escalation, or direct request).
- **Pre:** officer authorised, `HazardEvent` active, resource registry fresh (<1h).
- **Main:** `createOrder(priority, needs)` → `checkAvailability()` → `reserve()` (hold 15min) → `assignTeam()` → `notifyResponder()` → ack → `enRoute → onSite` → `logDistribution(beneficiaries)` → `release()`.
- **Add rules:**
  1. Resource state machine enforced: `AVAILABLE → RESERVED → EN_ROUTE → ON_SITE → RELEASED/MAINTENANCE`. No direct `AVAILABLE → ON_SITE`. `abortOrder()` always `release()`s.
  2. Ack timeout: if no `acceptOrder()` in 5 min → auto-unassign, notify officer, suggest next-best team. Order never stuck in SENT.
  3. Safety gate: team must confirm route + weather checklist before `EN_ROUTE`; blocked route → `abort(reason=ROUTE_BLOCKED)` + auto-suggest alternate team/route instead of silent fail.
  4. Split fulfilment: order lines independent; available lines dispatch now, missing lines spawn child `PartnerRequest` (A1) without blocking the rest. Officer sees `PARTIALLY_FULFILLED`.
  5. Offline field sync: `confirmArrival` / `captureDistribution` stamped with device time + `clientUUID`; server orders by event time, not arrival time, idempotent replay.
- **Improvement summary:** state machine + ack timeout + safety check + split fulfilment. Reduces stuck orders and lets partial help move immediately.

---

### Cross-cutting deltas (apply once, benefit all 5)

1. Every mutating action writes `WriteAuditLogEntry(actor, action, before→after, at)` — already in report §2.5, enforce for draft/escalate/merge/abort too.
2. All IDs + `clientUUID` idempotency on create paths (report, check-in, distribution) so retries/offline never duplicate.
3. `WarningLevel` and `ReportStatus` transitions whitelisted (e.g., never `EVACUATE → WATCH` in one jump, never `VERIFIED → QUEUED`).
