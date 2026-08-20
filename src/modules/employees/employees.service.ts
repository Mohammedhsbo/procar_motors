import { Prisma } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff directory for the active organisation. */
  async list(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      branchId?: string;
      status?: string;
    },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);

    const where: Prisma.EmployeeWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search } },
              { phone: { contains: query.search } },
              { jobTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          branch: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          user: { select: { id: true, email: true, status: true } },
        },
        orderBy: { nameEn: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: rows.map((e) => ({
        id: e.id,
        code: e.code,
        nameEn: e.nameEn,
        nameAr: e.nameAr,
        phone: e.phone,
        jobTitle: e.jobTitle,
        hireDate: e.hireDate,
        status: e.status,
        branch: e.branch,
        hasLogin: Boolean(e.user),
        email: e.user?.email ?? null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async create(params: {
    organizationId: string;
    branchId: string;
    nameEn: string;
    nameAr: string;
    phone?: string;
    jobTitle?: string;
  }) {
    return this.prisma.employee.create({
      data: {
        organizationId: params.organizationId,
        branchId: params.branchId,
        nameEn: params.nameEn,
        nameAr: params.nameAr,
        phone: params.phone,
        jobTitle: params.jobTitle,
        status: 'active',
      },
    });
  }

  async update(
    organizationId: string,
    employeeId: string,
    data: {
      nameEn?: string;
      nameAr?: string;
      phone?: string;
      branchId?: string;
      jobTitle?: string;
      status?: string;
    },
  ) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!emp) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Employee not found',
      });
    }
    return this.prisma.employee.update({
      where: { id: employeeId },
      data,
    });
  }
}
