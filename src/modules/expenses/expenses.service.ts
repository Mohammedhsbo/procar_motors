import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    branchId: string,
    query: { page?: number; limit?: number; category?: string },
  ) {
    await this.assertBranch(organizationId, branchId);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const where: Prisma.ExpenseWhereInput = {
      branchId,
      ...(query.category ? { category: query.category } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((e) => this.toDto(e)),
      meta: { page, limit, total, hasMore: page * limit < total },
    };
  }

  async create(
    organizationId: string,
    branchId: string,
    actorId: string,
    dto: {
      category: string;
      amount: number;
      expenseDate: string;
      notes?: string;
      status?: string;
    },
  ) {
    await this.assertBranch(organizationId, branchId);
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Amount must be > 0',
      });
    }
    const created = await this.prisma.expense.create({
      data: {
        branchId,
        category: dto.category,
        amount: dto.amount,
        expenseDate: new Date(dto.expenseDate),
        notes: dto.notes,
        status: dto.status ?? 'confirmed',
        createdBy: actorId,
      },
    });
    const result = this.toDto(created);
    await this.audit.log({
      organizationId,
      branchId,
      actorId,
      action: 'expense.create',
      entity: 'Expense',
      entityId: created.id,
      after: result,
    });
    return result;
  }

  private async assertBranch(organizationId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Branch not found',
      });
    }
  }

  private toDto(e: {
    id: string;
    branchId: string;
    category: string;
    amount: Prisma.Decimal;
    expenseDate: Date;
    status: string;
    notes: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: e.id,
      branchId: e.branchId,
      category: e.category,
      amount: Number(e.amount),
      expenseDate: e.expenseDate,
      status: e.status,
      notes: e.notes,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
}
