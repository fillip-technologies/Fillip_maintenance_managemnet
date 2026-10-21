import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is acting, for code far from the request (the lifecycle event writer):
 * the Fixly user behind a Fixly-token request, so history rows name them.
 */
export const actorContext = new AsyncLocalStorage();
export const currentLegacyUserId = () => actorContext.getStore()?.legacyUserId ?? null;
