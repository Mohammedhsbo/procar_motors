import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

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
