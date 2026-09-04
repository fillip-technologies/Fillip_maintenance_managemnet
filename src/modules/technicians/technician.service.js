import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { hashPassword } from '../../utils/password.js';
import { sendCredentialsEmail } from '../../lib/mailer.js';
import { logger } from '../../config/logger.js';

const withUser = { user: { select: { id: true, name: true, email: true, role: true } } };

export const technicianService = {
  async list({ page, limit, search }) {
    const where = search
      ? { user: { name: { contains: search, mode: 'insensitive' } } }
      : {};
    const total = await prisma.technician.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.technician.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: withUser,
    });
    return { items, meta };
  },

  async getById(id) {
    const technician = await prisma.technician.findUnique({
      where: { id },
      include: {
        ...withUser,
        assignments: {
          include: {
            client: { select: { id: true, name: true } },
            zone: {
              select: {
                id: true,
                name: true,
                client: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!technician) throw ApiError.notFound('Technician not found');
    return technician;
  },

  async create({ userId, specialization }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.badRequest('User does not exist');
    const existing = await prisma.technician.findUnique({ where: { userId } });
    if (existing) throw ApiError.conflict('This user is already a technician');
    return prisma.technician.create({ data: { userId, specialization }, include: withUser });
  },

  /**
   * Provision a brand-new technician end-to-end: create the login user
   * (role=technician) AND the technician profile atomically, then email the
   * credentials. Done in one transaction so a failure can never leave an orphan
   * user — and the credential email fires only after BOTH rows commit (unlike
   * the plain user-create path, which emails immediately).
   */
  async provision({ name, email, password, specialization, clientId, zoneId }) {
    const normalizedEmail = email.toLowerCase().trim();
    const clash = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (clash) {
      throw ApiError.conflict('A user with this email already exists', undefined, 'EMAIL_TAKEN');
    }
    const passwordHash = await hashPassword(password);

    const technician = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          role: 'technician',
          accountStatus: 'active',
          passwordHash,
        },
      });
      const tech = await tx.technician.create({
        data: { userId: user.id, specialization: specialization ?? null },
        include: withUser,
      });
      // Create the coverage assignment atomically if a scope was provided.
      if (clientId || zoneId) {
        await tx.technicianAssignment.create({
          data: { technicianId: tech.id, clientId: clientId ?? null, zoneId: zoneId ?? null },
        });
      }
      return tech;
    });

    // Fire-and-forget after commit — delivery must not fail the request, and the
    // mailer no-ops when SMTP isn't configured.
    sendCredentialsEmail({
      to: normalizedEmail,
      name,
      email: normalizedEmail,
      password,
    }).catch((err) => logger.error({ err, to: normalizedEmail }, 'Technician credential email error'));

    return technician;
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.technician.update({ where: { id }, data, include: withUser });
  },

  async remove(id) {
    const technician = await this.getById(id);
    // Delete the underlying USER, not just the profile — otherwise the login
    // account lingers (role=technician, no profile, can still authenticate).
    // The technician profile, coverage assignments and tokens all cascade off
    // the user (schema `onDelete: Cascade`), removing the technician entirely.
    await prisma.user.delete({ where: { id: technician.userId } });
  },

  // --- Coverage assignments ---

  async addAssignment(technicianId, { clientId, zoneId }) {
    const tech = await this.getById(technicianId);
    const existing = tech.assignments;

    if (clientId) {
      if (existing.some((a) => a.clientId === clientId)) {
        throw ApiError.conflict(
          'This technician is already assigned to this organization.',
          undefined,
          'DUPLICATE_ASSIGNMENT'
        );
      }
    }

    if (zoneId) {
      if (existing.some((a) => a.zoneId === zoneId)) {
        throw ApiError.conflict(
          'This technician is already assigned to this zone.',
          undefined,
          'DUPLICATE_ASSIGNMENT'
        );
      }

      const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { clientId: true } });
      if (!zone) throw ApiError.badRequest('Zone not found');

      // Block if org-level coverage already covers this zone (org is higher = already covers it).
      if (existing.some((a) => a.clientId === zone.clientId)) {
        throw ApiError.conflict(
          'This technician already has organization-level coverage for the client this zone belongs to. Cannot assign to a lower unit.',
          undefined,
          'COVERED_BY_ORG'
        );
      }

      // Block if any existing zone assignment is an ancestor of the new zone
      // (new zone is a descendant = lower unit of an existing assignment).
      const existingZoneIds = existing.filter((a) => a.zoneId).map((a) => a.zoneId);
      if (existingZoneIds.length > 0) {
        // Walk the new zone's ancestor chain and check for overlap.
        const ancestors = await prisma.$queryRaw`
          WITH RECURSIVE up AS (
            SELECT id, parent_zone_id FROM zones WHERE id = ${zoneId}::uuid
            UNION ALL
            SELECT z.id, z.parent_zone_id FROM zones z JOIN up u ON z.id = u.parent_zone_id
          )
          SELECT id::text FROM up WHERE id != ${zoneId}::uuid
        `;
        const ancestorIds = ancestors.map((r) => r.id);
        if (existingZoneIds.some((id) => ancestorIds.includes(id))) {
          throw ApiError.conflict(
            'This technician is already assigned to a parent zone that covers this zone. Cannot assign to a lower unit.',
            undefined,
            'COVERED_BY_PARENT_ZONE'
          );
        }
      }
    }

    return prisma.technicianAssignment.create({
      data: { technicianId, clientId: clientId ?? null, zoneId: zoneId ?? null },
      include: {
        client: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });
  },

  async removeAssignment(technicianId, assignmentId) {
    const assignment = await prisma.technicianAssignment.findFirst({
      where: { id: assignmentId, technicianId },
    });
    if (!assignment) throw ApiError.notFound('Assignment not found');
    await prisma.technicianAssignment.delete({ where: { id: assignmentId } });
  },
};
