import pino from 'pino';
import { env, isProduction } from './env.js';

/**
 * Structured JSON logger. In development we pretty-print for readability;
 * in production we emit raw JSON that log aggregators can parse.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
    remove: true,
  },
});
