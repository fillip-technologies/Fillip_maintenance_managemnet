import { ApiError } from './ApiError.js';

// All statuses a non-closed issue can transition INTO.
const ANY_OPEN = ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'reopened', 'closed'];

/**
 * Allowed issue status transitions. Any non-closed issue may move to any other
 * status so operators can correct mistakes or skip steps. `closed` is the only
 * terminal state — once closed an issue cannot be re-opened.
 */
export const ISSUE_TRANSITIONS = {
  open:        ANY_OPEN,
  assigned:    ANY_OPEN,
  in_progress: ANY_OPEN,
  on_hold:     ANY_OPEN,
  resolved:    ANY_OPEN,
  reopened:    ANY_OPEN,
  closed:      [],   // terminal
};

export const ISSUE_STATUSES = Object.keys(ISSUE_TRANSITIONS);

/** Throws unless `from → to` is a legal issue transition. */
export function assertIssueTransition(from, to) {
  const allowed = ISSUE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.badRequest(
      `Illegal issue transition: ${from} → ${to}`,
      allowed.length ? [{ path: 'status', message: `Allowed: ${allowed.join(', ')}` }] : undefined
    );
  }
}

/**
 * A device is "occupied" (→ under_maintenance) while it has any actively
 * worked issue. `resolved` is NOT included: the work is done, so the device
 * returns to `active` immediately on resolve. Only `reopened` puts it back.
 * `closed` is terminal and never re-occupies a device.
 */
export const OPEN_ISSUE_STATES = [
  'open',
  'assigned',
  'in_progress',
  'on_hold',
  'reopened',
];
