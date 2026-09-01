import { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { zoneService } from '../modules/zones/zone.service.js';
import { domainEvents } from './events.js';

const roomForZone = (id) => `zone:${id}`;
const roomForClient = (id) => `client:${id}`;
const PLATFORM_ROOM = 'platform:all';

/**
 * Attaches Socket.IO to the HTTP server. Clients authenticate with their access
 * token in the handshake; the server derives which rooms they may join from
 * their identity (never trusting client-supplied room names).
 */
export function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()) },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    try {
      if (user.clientId) socket.join(roomForClient(user.clientId));
      if (user.role === 'super_admin') socket.join(PLATFORM_ROOM);

      // Join every zone the user is actively assigned to; events emitted to a
      // device's zone + ancestors will reach an incharge assigned higher up.
      const assignments = await prisma.zoneAssignment.findMany({
        where: { userId: user.sub, unassignedAt: null },
        select: { zoneId: true },
      });
      assignments.forEach((a) => socket.join(roomForZone(a.zoneId)));

      // Technicians are scoped via technician_assignments (client- or
      // zone-level), NOT zone_assignments — join those coverage rooms too, or a
      // technician's issue queue would never receive live issue:created /
      // issue:updated events (screen-flow contract).
      if (user.technicianId) {
        const coverage = await prisma.technicianAssignment.findMany({
          where: { technicianId: user.technicianId },
          select: { clientId: true, zoneId: true },
        });
        coverage.forEach((c) => {
          if (c.zoneId) socket.join(roomForZone(c.zoneId));
          if (c.clientId) socket.join(roomForClient(c.clientId));
        });
      }
    } catch (err) {
      logger.error({ err }, 'Socket room join failed');
    }
  });

  // Fan domain events out to the relevant rooms.
  domainEvents.on('issue', ({ type, issue }) => {
    broadcastForZone(io, issue?.device?.zoneId, type, issue).catch((err) =>
      logger.error({ err }, 'issue broadcast failed')
    );
  });
  domainEvents.on('log', ({ type, log, zoneId }) => {
    broadcastForZone(io, zoneId, type, log).catch((err) =>
      logger.error({ err }, 'log broadcast failed')
    );
  });

  logger.info('Realtime (Socket.IO) initialized');
  return io;
}

/** Emit `event` to the zone, all its ancestors, the owning client, and platform. */
async function broadcastForZone(io, zoneId, event, payload) {
  if (!zoneId) return;
  const [ancestors, zone] = await Promise.all([
    zoneService.ancestors(zoneId),
    prisma.zone.findUnique({ where: { id: zoneId }, select: { clientId: true } }),
  ]);

  const rooms = ancestors.map((a) => roomForZone(a.id));
  if (zone?.clientId) rooms.push(roomForClient(zone.clientId));
  rooms.push(PLATFORM_ROOM);

  io.to(rooms).emit(event, payload);
}
