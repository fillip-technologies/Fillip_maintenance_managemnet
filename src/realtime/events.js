import { EventEmitter } from 'node:events';

/**
 * In-process domain event bus. Services emit here without knowing about
 * Socket.IO; the realtime layer (and, later, push) subscribes. Decoupling this
 * way keeps services transport-agnostic and easy to test.
 */
export const domainEvents = new EventEmitter();

export const DOMAIN_EVENT = {
  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',
  LOG_SUBMITTED: 'log:submitted',
};

/** Emit an issue lifecycle event. `issue` should include `device.zoneId`. */
export function emitIssueEvent(type, issue) {
  domainEvents.emit('issue', { type, issue });
}

/** Emit a daily-log event; `zoneId` is the logged device's zone. */
export function emitLogEvent(log, zoneId) {
  domainEvents.emit('log', { type: DOMAIN_EVENT.LOG_SUBMITTED, log, zoneId });
}
