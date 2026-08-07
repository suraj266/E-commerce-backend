/**
 * Grievance / CP-EC redressal constants (Phase 4, P4-01).
 *
 * ⚠️  The SLA windows below are the workflow's operational encoding of the CP-EC
 *     Rules 2020 "reasonable time" + acknowledgement obligation. They are
 *     PROVISIONAL and legally load-bearing — every one carries a
 *     `// NEEDS LEGAL SIGN-OFF` marker and MUST be confirmed by Legal against the
 *     current Consumer Protection (E-Commerce) Rules + the published grievance
 *     policy before go-live. Nothing here files anything; the monthly compliance
 *     report is a MANUAL Legal filing action (see grievance.service.ts).
 */

import { GrievanceStatus, GrievancePriority, GrievanceCategory } from '@prisma/client';

/**
 * Resolution SLA in HOURS, keyed by priority. CP-EC requires acknowledgement
 * within a short window and redressal within a "reasonable time" (commonly read
 * as up to one month); marketplaces target far tighter internal SLAs. These are
 * the internal targets the breach cron escalates against.
 *
 * // NEEDS LEGAL SIGN-OFF — the exact acknowledgement + resolution windows and
 *    whether they must vary by category (e.g. DATA_PRIVACY / DPDP timelines).
 */
export const GRIEVANCE_SLA_HOURS: Record<GrievancePriority, number> = {
  URGENT: 24,
  HIGH: 48,
  NORMAL: 72,
  LOW: 120,
};

/**
 * Default priority inferred from the complaint category at file time. Data-
 * privacy complaints are routed HIGH given DPDP sensitivity; everything else
 * defaults NORMAL and an officer can re-prioritise on assignment.
 *
 * // NEEDS LEGAL SIGN-OFF — the category→priority routing.
 */
export function defaultPriorityForCategory(
  category: GrievanceCategory,
): GrievancePriority {
  if (category === GrievanceCategory.DATA_PRIVACY) return GrievancePriority.HIGH;
  return GrievancePriority.NORMAL;
}

/** SLA deadline for a priority, measured from `from` (default now). */
export function computeSlaDueAt(
  priority: GrievancePriority,
  from: Date = new Date(),
): Date {
  const hours = GRIEVANCE_SLA_HOURS[priority] ?? GRIEVANCE_SLA_HOURS.NORMAL;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Legal GrievanceStatus transitions. A move not listed here is rejected by the
 * service (defence in depth alongside the conditional status flip).
 */
export const GRIEVANCE_TRANSITIONS: Record<GrievanceStatus, GrievanceStatus[]> = {
  OPEN: [
    GrievanceStatus.IN_PROGRESS,
    GrievanceStatus.RESOLVED,
    GrievanceStatus.ESCALATED,
  ],
  IN_PROGRESS: [
    GrievanceStatus.RESOLVED,
    GrievanceStatus.ESCALATED,
  ],
  // A senior can push an escalated ticket back into active handling, or resolve it.
  ESCALATED: [
    GrievanceStatus.IN_PROGRESS,
    GrievanceStatus.RESOLVED,
  ],
  // A resolved ticket re-opens if the customer replies, or is closed out.
  RESOLVED: [
    GrievanceStatus.IN_PROGRESS,
    GrievanceStatus.CLOSED,
  ],
  CLOSED: [],
};

export function isValidGrievanceTransition(
  from: GrievanceStatus,
  to: GrievanceStatus,
): boolean {
  return GRIEVANCE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses the SLA-breach cron considers still "open" (escalatable). */
export const GRIEVANCE_OPEN_STATUSES: GrievanceStatus[] = [
  GrievanceStatus.OPEN,
  GrievanceStatus.IN_PROGRESS,
];

/**
 * Outbox event types owned by the GRIEVANCE surface.
 *
 * These are declared HERE (not in outbox.constants.ts) because that file +
 * outbox.processors.ts are wired CENTRALLY — the orchestrator merges these
 * literals into OUTBOX_EVENT and adds the matching EmailsProcessor cases (see
 * the CENTRAL-WIRING report). The string VALUES are the contract: the enqueue
 * uses these constants and the processor switches on the same literals.
 *
 * // CENTRAL-WIRING (outbox): add to OUTBOX_EVENT and route on the EMAILS queue:
 *   GRIEVANCE_FILED:  'email.grievance_filed'
 *     → GrievanceService.sendGrievanceFiledEmail(payload.grievanceId)
 *   GRIEVANCE_STATUS: 'email.grievance_status'
 *     → GrievanceService.sendGrievanceStatusEmail(payload.grievanceId, payload.status)
 *   GRIEVANCE_REPLY:  'email.grievance_reply'
 *     → GrievanceService.sendGrievanceReplyEmail(payload.grievanceId, payload.messageId)
 */
export const GRIEVANCE_OUTBOX_EVENT = {
  FILED: 'email.grievance_filed',
  STATUS: 'email.grievance_status',
  REPLY: 'email.grievance_reply',
} as const;

/** Ticket-number generator: GRV-YYYY-MM-XXXXXXX (Crockford-ish, no ambiguous chars). */
const TICKET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateTicketNumber(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  let rnd = '';
  for (let i = 0; i < 7; i++) {
    rnd += TICKET_ALPHABET[Math.floor(Math.random() * TICKET_ALPHABET.length)];
  }
  return `GRV-${yyyy}-${mm}-${rnd}`;
}

/**
 * A banner embedded in the monthly compliance report so a downstream consumer
 * can never mistake this operational roll-up for a filed statutory return.
 *
 * // NEEDS LEGAL SIGN-OFF — the report's exact schema + the statutory filing
 *    cadence/authority the marketplace must publish it to.
 */
export const GRIEVANCE_REPORT_DISCLAIMER =
  'PROVISIONAL — operational grievance-redressal roll-up (CP-EC Rules 2020, ' +
  'P4-01). SLA windows, category routing, the report schema and its filing ' +
  'cadence NEED LEGAL SIGN-OFF before this is published or filed.';
