import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentPhase,
  CustomerStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import {
  VehicleVisitsService,
  type CheckInDto,
} from '../vehicle-visits/vehicle-visits.service';
import { FilesService } from '../files/files.service';
import { ConflictResolverService } from './conflict-resolver.service';
import {
  SYNC_ALLOWED,
  SYNC_FORBIDDEN_ENTITIES,
  syncKey,
  type SyncOpInput,
  type SyncOpResult,
} from './sync.types';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly vehicles: VehiclesService,
    private readonly visits: VehicleVisitsService,
    private readonly files: FilesService,
    private readonly conflicts: ConflictResolverService,
  ) {}

  async processBatch(params: {
    organizationId: string;
    branchId: string;
    actorId: string;
    clientId: string;
    operations: SyncOpInput[];
  }) {
    const idMap = new Map<string, string>();
    const results: SyncOpResult[] = [];

    for (const op of params.operations) {
      const result = await this.processOne(params, op, idMap);
      results.push(result);
      if (result.serverEntityId && result.status === 'applied') {
        const clientGenerated = asString(op.payload.clientId);
        if (clientGenerated) idMap.set(clientGenerated, result.serverEntityId);
        idMap.set(result.serverEntityId, result.serverEntityId);
      }
    }

    await this.audit.log({
      organizationId: params.organizationId,
      branchId: params.branchId,
      actorId: params.actorId,
      action: 'sync.batch',
      entity: 'SyncOperation',
      after: {
        clientId: params.clientId,
        total: results.length,
        applied: results.filter((r) => r.status === 'applied').length,
        conflict: results.filter((r) => r.status === 'conflict').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
    });

    return { results };
  }

  async getStatus(params: {
    organizationId: string;
    actorId: string;
    roles: string[];
    operationId: string;
    clientId?: string;
  }) {
    const where: Prisma.SyncOperationWhereInput = {
      organizationId: params.organizationId,
      operationId: params.operationId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.roles.includes('super_admin')
        ? {}
        : { actorId: params.actorId }),
    };
    const row = await this.prisma.syncOperation.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Sync operation not found',
      });
    }
    return (
      (row.result as SyncOpResult | null) ?? {
        operationId: row.operationId,
        status: row.status,
        serverEntityId: row.serverEntityId,
        conflict: row.conflictInfo as SyncOpResult['conflict'],
      }
    );
  }

  private async processOne(
    ctx: {
      organizationId: string;
      branchId: string;
      actorId: string;
      clientId: string;
    },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const existing = await this.prisma.syncOperation.findUnique({
      where: {
        clientId_operationId: {
          clientId: ctx.clientId,
          operationId: op.operationId,
        },
      },
    });
    if (existing && existing.status !== 'pending') {
      return (
        (existing.result as SyncOpResult | null) ?? {
          operationId: op.operationId,
          status: existing.status,
          serverEntityId: existing.serverEntityId,
          conflict: existing.conflictInfo as SyncOpResult['conflict'],
        }
      );
    }

    const result = await this.applyOperation(ctx, op, idMap);
    await this.persistResult(ctx, op, result, existing?.id);
    return result;
  }

  private async persistResult(
    ctx: {
      organizationId: string;
      branchId: string;
      actorId: string;
      clientId: string;
    },
    op: SyncOpInput,
    result: SyncOpResult,
    existingId?: string,
  ) {
    const data = {
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      branchId: ctx.branchId,
      clientId: ctx.clientId,
      operationId: op.operationId,
      entityType: op.entityType,
      action: op.action,
      payload: op as unknown as Prisma.InputJsonValue,
      status: result.status,
      conflictInfo: result.conflict
        ? (result.conflict as Prisma.InputJsonValue)
        : Prisma.DbNull,
      result: result as unknown as Prisma.InputJsonValue,
      serverEntityId: result.serverEntityId ?? null,
      processedAt: new Date(),
    };

    if (existingId) {
      await this.prisma.syncOperation.update({
        where: { id: existingId },
        data,
      });
      return;
    }

    try {
      await this.prisma.syncOperation.create({ data });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  private async applyOperation(
    ctx: {
      organizationId: string;
      branchId: string;
      actorId: string;
    },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const entity = op.entityType.trim().toLowerCase();
    const action = op.action.trim().toLowerCase();
    const key = syncKey(entity, action);

    if (SYNC_FORBIDDEN_ENTITIES.has(entity)) {
      return {
        operationId: op.operationId,
        status: 'failed',
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: `${entity} is not allowed in offline sync`,
        },
      };
    }
    if (!SYNC_ALLOWED.has(key)) {
      return {
        operationId: op.operationId,
        status: 'failed',
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Unsupported sync operation ${key}`,
        },
      };
    }

    try {
      if (key === 'customer:create') {
        return this.applyCustomerCreate(ctx, op);
      }
      if (key === 'vehicle:create') {
        return this.applyVehicleCreate(ctx, op, idMap);
      }
      if (key === 'vehicle_visit:create') {
        return this.applyVisitCreate(ctx, op, idMap);
      }
      if (key === 'vehicle_visit:update') {
        return this.applyVisitUpdate(ctx, op, idMap);
      }
      return this.applyAttachmentCreate(ctx, op, idMap);
    } catch (e) {
      return this.mapThrown(op.operationId, e);
    }
  }

  private async applyCustomerCreate(
    ctx: { organizationId: string; actorId: string },
    op: SyncOpInput,
  ): Promise<SyncOpResult> {
    const phone = asString(op.payload.phone);
    const nameEn = asString(op.payload.nameEn);
    const nameAr = asString(op.payload.nameAr);
    if (!phone || !nameEn || !nameAr) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'nameEn, nameAr, and phone are required',
      });
    }

    const existing = await this.conflicts.findCustomerByPhone(
      ctx.organizationId,
      phone,
    );
    if (existing) {
      return {
        operationId: op.operationId,
        status: 'applied',
        serverEntityId: existing.id,
        merged: true,
      };
    }

    const created = await this.customers.create(
      ctx.organizationId,
      ctx.actorId,
      {
        nameEn,
        nameAr,
        phone,
        whatsapp: asString(op.payload.whatsapp) ?? undefined,
        email: asString(op.payload.email) ?? undefined,
        status:
          (asString(op.payload.status) as CustomerStatus | undefined) ??
          'active',
      },
    );
    return {
      operationId: op.operationId,
      status: 'applied',
      serverEntityId: created.id,
      merged: false,
    };
  }

  private async applyVehicleCreate(
    ctx: { organizationId: string; actorId: string },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const plate = asString(op.payload.plate);
    const make = asString(op.payload.make);
    const model = asString(op.payload.model);
    const year = asNumber(op.payload.year);
    const customerId = this.resolveId(op.payload.customerId, idMap);
    if (!plate || !make || !model || !year || !customerId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'customerId, plate, make, model, and year are required',
      });
    }

    const existing = await this.conflicts.findVehicleByPlate(
      ctx.organizationId,
      plate,
    );
    if (existing) {
      if (existing.customerId === customerId) {
        return {
          operationId: op.operationId,
          status: 'applied',
          serverEntityId: existing.id,
          merged: true,
        };
      }
      return {
        operationId: op.operationId,
        status: 'conflict',
        serverEntityId: existing.id,
        conflict: {
          code: ErrorCodes.CONFLICT,
          message: 'Plate already exists for another customer',
          server: { vehicleId: existing.id, customerId: existing.customerId },
          client: { customerId, plate },
        },
      };
    }

    const created = await this.vehicles.create(
      ctx.organizationId,
      ctx.actorId,
      {
        customerId,
        plate,
        make,
        model,
        year,
        vin: asString(op.payload.vin) ?? undefined,
        color: asString(op.payload.color) ?? undefined,
        mileageCurrent: asNumber(op.payload.mileageCurrent) ?? undefined,
      },
    );
    return {
      operationId: op.operationId,
      status: 'applied',
      serverEntityId: created.id,
    };
  }

  private async applyVisitCreate(
    ctx: { organizationId: string; branchId: string; actorId: string },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const dto = this.toCheckInDto(op.payload, idMap);
    try {
      const visit = await this.visits.checkIn(
        ctx.organizationId,
        ctx.branchId,
        ctx.actorId,
        dto,
      );
      return {
        operationId: op.operationId,
        status: 'applied',
        serverEntityId: visit.id,
      };
    } catch (e) {
      if (e instanceof ConflictException) {
        return this.mapThrown(op.operationId, e, 'conflict');
      }
      throw e;
    }
  }

  private async applyVisitUpdate(
    ctx: { organizationId: string; branchId: string; actorId: string },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const visitId = this.resolveId(op.payload.visitId ?? op.payload.id, idMap);
    if (!visitId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'visitId is required',
      });
    }

    const visit = await this.prisma.vehicleVisit.findFirst({
      where: {
        id: visitId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!visit) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Visit not found',
      });
    }
    if (visit.branchId !== ctx.branchId) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: 'Cross-branch visit updates are not allowed offline',
      });
    }

    const clientTimestamp = new Date(op.clientTimestamp);
    const merged = this.conflicts.mergeVisitCapture({
      server: visit,
      client: {
        complaint: asString(op.payload.complaint) ?? undefined,
        mileage:
          asNumber(op.payload.mileage ?? op.payload.mileageIn) ?? undefined,
        fuelLevelPct: asNumber(op.payload.fuelLevelPct) ?? undefined,
        damagePoints: asDamagePoints(op.payload.damagePoints),
        version: asNumber(op.payload.version) ?? undefined,
      },
      clientTimestamp: Number.isNaN(clientTimestamp.getTime())
        ? new Date(0)
        : clientTimestamp,
    });

    if (merged.kind === 'conflict') {
      return { ...merged.result, operationId: op.operationId };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.vehicleVisit.updateMany({
        where: { id: visitId, version: visit.version },
        data: {
          complaint:
            typeof merged.data.complaint === 'string'
              ? merged.data.complaint
              : undefined,
          mileageIn:
            typeof merged.data.mileageIn === 'number'
              ? merged.data.mileageIn
              : undefined,
          fuelLevelPct:
            typeof merged.data.fuelLevelPct === 'number'
              ? merged.data.fuelLevelPct
              : undefined,
          version: { increment: 1 },
          updatedBy: ctx.actorId,
        },
      });
      if (rows.count === 0) {
        throw new ConflictException({
          code: ErrorCodes.OPTIMISTIC_LOCK,
          message: 'Visit was modified by another request',
        });
      }
      if (merged.damagePoints?.length) {
        await tx.visitDamagePoint.createMany({
          data: merged.damagePoints.map((p) => ({
            visitId,
            xPct: p.xPct,
            yPct: p.yPct,
            labelEn: p.labelEn,
            labelAr: p.labelAr,
            severity: p.severity,
          })),
        });
      }
      return tx.vehicleVisit.findFirstOrThrow({ where: { id: visitId } });
    });

    return {
      operationId: op.operationId,
      status: 'applied',
      serverEntityId: updated.id,
    };
  }

  private async applyAttachmentCreate(
    ctx: { organizationId: string; actorId: string; branchId: string },
    op: SyncOpInput,
    idMap: Map<string, string>,
  ): Promise<SyncOpResult> {
    const fileId = asString(op.payload.fileId);
    const entityType = asString(op.payload.entityType) ?? 'VehicleVisit';
    const entityId = this.resolveId(op.payload.entityId, idMap);
    const kind =
      (asString(op.payload.kind) as AttachmentKind | null) ?? 'photo';
    if (!fileId || !entityId) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'fileId and entityId are required',
      });
    }

    if (entityType === 'VehicleVisit' || entityType === 'vehicle_visit') {
      const visit = await this.prisma.vehicleVisit.findFirst({
        where: {
          id: entityId,
          organizationId: ctx.organizationId,
          branchId: ctx.branchId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!visit) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Visit not found in this branch',
        });
      }
    }

    const attached = await this.files.createAttachment(
      ctx.organizationId,
      ctx.actorId,
      {
        fileId,
        entityType,
        entityId,
        kind,
        phase:
          (asString(op.payload.phase) as AttachmentPhase | undefined) ??
          'before',
      },
    );
    return {
      operationId: op.operationId,
      status: 'applied',
      serverEntityId: attached.id,
    };
  }

  private toCheckInDto(
    payload: Record<string, unknown>,
    idMap: Map<string, string>,
  ): CheckInDto {
    const nested =
      payload.checkIn && typeof payload.checkIn === 'object'
        ? (payload.checkIn as Record<string, unknown>)
        : payload;

    const customerId = this.resolveId(nested.customerId, idMap);
    const vehicleId = this.resolveId(nested.vehicleId, idMap);
    const newCustomer =
      nested.newCustomer && typeof nested.newCustomer === 'object'
        ? (nested.newCustomer as CheckInDto['newCustomer'])
        : undefined;
    const newVehicle =
      nested.newVehicle && typeof nested.newVehicle === 'object'
        ? (nested.newVehicle as CheckInDto['newVehicle'])
        : undefined;

    return {
      customerId: customerId ?? undefined,
      vehicleId: vehicleId ?? undefined,
      newCustomer,
      newVehicle,
      mileage: asNumber(nested.mileage) ?? 0,
      fuelLevelPct: asNumber(nested.fuelLevelPct) ?? 0,
      exteriorCondition: asString(nested.exteriorCondition) ?? undefined,
      complaint: asString(nested.complaint) ?? '',
      priority:
        (asString(nested.priority) as CheckInDto['priority']) ?? 'normal',
      expectedDeliveryAt:
        asString(nested.expectedDeliveryAt) ??
        new Date(Date.now() + 8 * 3600_000).toISOString(),
      notes: asString(nested.notes) ?? undefined,
      damagePoints: asDamagePoints(nested.damagePoints),
    };
  }

  private resolveId(raw: unknown, idMap: Map<string, string>) {
    const id = asString(raw);
    if (!id) return null;
    return idMap.get(id) ?? id;
  }

  private mapThrown(
    operationId: string,
    e: unknown,
    forceStatus?: 'conflict' | 'failed',
  ): SyncOpResult {
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const code =
        typeof body === 'object' && body && 'code' in body
          ? String((body as { code: string }).code)
          : ErrorCodes.INTERNAL_ERROR;
      const message =
        typeof body === 'object' && body && 'message' in body
          ? String((body as { message: string }).message)
          : e.message;
      const isConflict =
        forceStatus === 'conflict' ||
        e.getStatus() === 409 ||
        code === ErrorCodes.CONFLICT ||
        code === ErrorCodes.OPTIMISTIC_LOCK;
      if (isConflict) {
        return {
          operationId,
          status: 'conflict',
          conflict: { code, message },
        };
      }
      return {
        operationId,
        status: 'failed',
        error: { code, message },
      };
    }
    return {
      operationId,
      status: 'failed',
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: e instanceof Error ? e.message : 'Unknown sync error',
      },
    };
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function asDamagePoints(value: unknown): CheckInDto['damagePoints'] {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const row = p as Record<string, unknown>;
      return {
        xPct: asNumber(row.xPct) ?? 0,
        yPct: asNumber(row.yPct) ?? 0,
        labelEn: asString(row.labelEn) ?? '',
        labelAr: asString(row.labelAr) ?? '',
        severity: asString(row.severity) ?? undefined,
      };
    });
}
