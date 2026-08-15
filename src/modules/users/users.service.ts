import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { hashPassword } from '../auth/password.util';
import { AuditService } from '../audit/audit.service';

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    employee: true;
    roles: { include: { role: true } };
    branches: { include: { branch: true } };
  };
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, page = 1, limit = 50) {
    const take = Math.min(100, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;
    const where: Prisma.UserWhereInput = {
      organizationId,
      userType: 'staff',
      deletedAt: null,
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: {
          employee: true,
          roles: { include: { role: true } },
          branches: { include: { branch: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
    ]);
    return {
      data: rows.map((u) => this.toDto(u)),
      meta: {
        page: Math.max(1, page),
        limit: take,
        total,
        hasMore: skip + take < total,
      },
    };
  }

  async getById(organizationId: string, id: string) {
    const user = await this.findOrFail(organizationId, id);
    return this.toDto(user);
  }

  async create(
    organizationId: string,
    actorId: string,
    dto: {
      email: string;
      password: string;
      nameEn: string;
      nameAr: string;
      phone?: string;
      roleKey: string;
      branchIds: string[];
      locale?: string;
    },
  ) {
    if (!dto.branchIds.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one branchId is required',
      });
    }

    const role = await this.prisma.role.findFirst({
      where: { organizationId, key: dto.roleKey },
    });
    if (!role) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown role: ${dto.roleKey}`,
      });
    }

    const branches = await this.prisma.branch.findMany({
      where: {
        organizationId,
        id: { in: dto.branchIds },
        deletedAt: null,
      },
    });
    if (branches.length !== dto.branchIds.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more branchIds are invalid',
      });
    }

    const primaryBranchId = dto.branchIds[0];
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employee.create({
          data: {
            organizationId,
            branchId: primaryBranchId,
            nameEn: dto.nameEn,
            nameAr: dto.nameAr,
            phone: dto.phone,
            status: 'active',
          },
        });

        const created = await tx.user.create({
          data: {
            organizationId,
            employeeId: employee.id,
            email: dto.email.toLowerCase(),
            passwordHash,
            userType: 'staff',
            status: 'active',
            locale: dto.locale ?? 'en',
            roles: {
              create: { roleId: role.id },
            },
            branches: {
              create: dto.branchIds.map((branchId) => ({ branchId })),
            },
          },
          include: {
            employee: true,
            roles: { include: { role: true } },
            branches: { include: { branch: true } },
          },
        });
        return created;
      });

      const dtoUser = this.toDto(user);
      await this.audit.log({
        organizationId,
        actorId,
        action: 'user.create',
        entity: 'User',
        entityId: user.id,
        after: dtoUser,
      });
      return dtoUser;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message: 'Email already exists',
        });
      }
      throw e;
    }
  }

  async update(
    organizationId: string,
    actorId: string,
    id: string,
    dto: {
      nameEn?: string;
      nameAr?: string;
      phone?: string;
      roleKey?: string;
      branchIds?: string[];
      locale?: string;
      password?: string;
    },
  ) {
    const before = await this.findOrFail(organizationId, id);

    if (dto.branchIds && dto.branchIds.length === 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one branchId is required',
      });
    }

    let roleId: string | undefined;
    if (dto.roleKey) {
      const role = await this.prisma.role.findFirst({
        where: { organizationId, key: dto.roleKey },
      });
      if (!role) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Unknown role: ${dto.roleKey}`,
        });
      }
      roleId = role.id;
    }

    if (dto.branchIds) {
      const branches = await this.prisma.branch.findMany({
        where: {
          organizationId,
          id: { in: dto.branchIds },
          deletedAt: null,
        },
      });
      if (branches.length !== dto.branchIds.length) {
        throw new BadRequestException({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'One or more branchIds are invalid',
        });
      }
    }

    const passwordHash = dto.password
      ? await hashPassword(dto.password)
      : undefined;

    const user = await this.prisma.$transaction(async (tx) => {
      if (
        before.employeeId &&
        (dto.nameEn || dto.nameAr || dto.phone || dto.branchIds)
      ) {
        await tx.employee.update({
          where: { id: before.employeeId },
          data: {
            nameEn: dto.nameEn,
            nameAr: dto.nameAr,
            phone: dto.phone,
            branchId: dto.branchIds?.[0],
          },
        });
      }

      if (roleId) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({ data: { userId: id, roleId } });
      }

      if (dto.branchIds) {
        await tx.userBranchAccess.deleteMany({ where: { userId: id } });
        await tx.userBranchAccess.createMany({
          data: dto.branchIds.map((branchId) => ({ userId: id, branchId })),
        });
      }

      return tx.user.update({
        where: { id },
        data: {
          locale: dto.locale,
          passwordHash,
        },
        include: {
          employee: true,
          roles: { include: { role: true } },
          branches: { include: { branch: true } },
        },
      });
    });

    const after = this.toDto(user);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'user.update',
      entity: 'User',
      entityId: id,
      before: this.toDto(before),
      after,
    });
    return after;
  }

  async updateStatus(
    organizationId: string,
    actorId: string,
    id: string,
    status: UserStatus,
  ) {
    if (actorId === id) {
      throw new UnprocessableEntityException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Cannot change your own status',
      });
    }
    if (status !== 'active' && status !== 'suspended') {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Status must be active or suspended',
      });
    }

    const before = await this.findOrFail(organizationId, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status },
      include: {
        employee: true,
        roles: { include: { role: true } },
        branches: { include: { branch: true } },
      },
    });

    const after = this.toDto(user);
    await this.audit.log({
      organizationId,
      actorId,
      action: 'user.status',
      entity: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: user.status },
    });
    return after;
  }

  private async findOrFail(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId, userType: 'staff', deletedAt: null },
      include: {
        employee: true,
        roles: { include: { role: true } },
        branches: { include: { branch: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'User not found',
      });
    }
    return user;
  }

  private toDto(user: UserWithRelations) {
    const primaryRole = user.roles[0]?.role;
    const primaryBranch = user.branches[0]?.branch;
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      locale: user.locale,
      lastLoginAt: user.lastLoginAt,
      nameEn: user.employee?.nameEn ?? null,
      nameAr: user.employee?.nameAr ?? null,
      phone: user.employee?.phone ?? null,
      role: primaryRole
        ? {
            key: primaryRole.key,
            nameEn: primaryRole.nameEn,
            nameAr: primaryRole.nameAr,
          }
        : null,
      branch: primaryBranch
        ? {
            id: primaryBranch.id,
            code: primaryBranch.code,
            nameEn: primaryBranch.nameEn,
            nameAr: primaryBranch.nameAr,
          }
        : null,
      branchIds: user.branches.map((b) => b.branchId),
      roles: user.roles.map((r) => r.role.key),
    };
  }
}
