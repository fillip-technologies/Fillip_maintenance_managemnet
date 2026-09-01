import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { verifyPassword } from '../../utils/password.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshExpiry,
} from '../../utils/jwt.js';
import { zoneService } from '../zones/zone.service.js';

function accessClaims(user, technicianId) {
  return {
    sub: user.id,
    role: user.role,
    clientId: user.clientId,
    technicianId: technicianId ?? null,
  };
}

async function issueTokens(user, technicianId) {
  const accessToken = signAccessToken(accessClaims(user, technicianId));
  const { raw, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: refreshExpiry() },
  });
  return { accessToken, refreshToken: raw };
}

export const authService = {
  async login({ email, password }) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { technicianProfile: { select: { id: true } } },
    });
    // Uniform error to avoid leaking which half was wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (user.accountStatus === 'suspended') throw ApiError.forbidden('Account suspended');
    if (user.accountStatus === 'removed') throw ApiError.forbidden('Account no longer active');

    // First successful login flips an invited account to active.
    if (user.accountStatus === 'invited') {
      await prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'active' } });
    }

    const technicianId = user.technicianProfile?.id ?? null;
    const tokens = await issueTokens(user, technicianId);

    // Primary zone + its tree, for zone-scoped clients (cached client-side).
    const assignment = await prisma.zoneAssignment.findFirst({
      where: { userId: user.id, unassignedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    const zoneId = assignment?.zoneId ?? null;
    const [zoneDescendants, zoneAncestors] = zoneId
      ? await Promise.all([zoneService.descendants(zoneId), zoneService.ancestors(zoneId)])
      : [[], []];

    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        clientId: user.clientId,
        zoneId,
      },
      zoneDescendants,
      zoneAncestors,
    };
  },

  async refresh(rawToken) {
    if (!rawToken) throw ApiError.unauthorized('Refresh token required');
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { include: { technicianProfile: { select: { id: true } } } } },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw ApiError.unauthorized('Invalid or expired refresh token', 'REFRESH_INVALID');
    }

    // Rotate: revoke the presented token and issue a fresh pair.
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const technicianId = record.user.technicianProfile?.id ?? null;
    return issueTokens(record.user, technicianId);
  },

  async logout(rawToken) {
    if (!rawToken) return;
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async saveDeviceToken(userId, { token, platform }) {
    await prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
    return { saved: true };
  },
};
