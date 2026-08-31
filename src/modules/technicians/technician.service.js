import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

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
            zone: { select: { id: true, name: true } },
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

  async update(id, data) {
    await this.getById(id);
    return prisma.technician.update({ where: { id }, data, include: withUser });
  },

  async remove(id) {
    await this.getById(id);
    await prisma.technician.delete({ where: { id } });
  },

  // --- Coverage assignments ---

  async addAssignment(technicianId, { clientId, zoneId }) {
    await this.getById(technicianId);
    return prisma.technicianAssignment.create({ data: { technicianId, clientId, zoneId } });
  },

  async removeAssignment(technicianId, assignmentId) {
    const assignment = await prisma.technicianAssignment.findFirst({
      where: { id: assignmentId, technicianId },
    });
    if (!assignment) throw ApiError.notFound('Assignment not found');
    await prisma.technicianAssignment.delete({ where: { id: assignmentId } });
  },
};
