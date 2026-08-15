import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Organization not found',
      });
    }
    return {
      id: org.id,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      taxId: org.taxId,
      phone: org.phone,
      email: org.email,
      status: org.status,
    };
  }
}
