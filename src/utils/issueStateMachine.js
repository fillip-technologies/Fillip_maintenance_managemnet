import { ApiError } from './ApiError.js';

/**
 * Allowed issue status transitions (section 3.3 of the spec). A transition not
 * present here is rejected. `closed` is terminal.
 */
export const ISSUE_TRANSITIONS = {
  open: ['assigned'],
  assigned: ['in_progress', 'on_hold'],
  in_progress: ['resolved', 'on_hold'],
  on_hold: ['in_progress'],
  resolved: ['closed', 'reopened'],
  closed: [],
  reopened: ['assigned'],
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
 * A device is "occupied" (→ under_maintenance) while it has any issue that is
 * not yet `closed`. It only returns to `active` once every issue is closed
 * (section 3.2: active when "an issue is resolved and closed").
 */
export const OPEN_ISSUE_STATES = [
  'open',
  'assigned',
  'in_progress',
  'on_hold',
  'resolved',
  'reopened',
];
