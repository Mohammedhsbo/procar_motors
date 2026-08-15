import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { normalizePlate } from '../../common/utils/plate.util';
import { normalizePhone } from '../portal/portal-auth.service';
import type { SyncOpResult } from './sync.types';

type VisitCapture = {
  complaint?: string;
  mileage?: number;
  fuelLevelPct?: number;
  damagePoints?: Array<{
    xPct: number;
    yPct: number;
    labelEn: string;
    labelAr: string;
    severity?: string;
  }>;
  version?: number;
};

/**
 * Architecture §21.3 — no last-write-wins for everything.
 */
@Injectable()
export class ConflictResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async findCustomerByPhone(organizationId: string, phone: string) {
    const trimmed = phone.trim();
    const exact = await this.prisma.customer.findFirst({
      where: { organizationId, deletedAt: null, phone: trimmed },
    });
    if (exact) return exact;

    const digits = normalizePhone(trimmed);
    if (digits.length < 8) return null;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM core.customers
      WHERE organization_id = ${organizationId}::uuid
        AND deleted_at IS NULL
        AND regexp_replace(phone, '\D', '', 'g') = ${digits}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return this.prisma.customer.findFirst({
      where: { id: rows[0].id, organizationId, deletedAt: null },
    });
  }

  async findVehicleByPlate(organizationId: string, plate: string) {
    const plateNormalized = normalizePlate(plate);
    return this.prisma.vehicle.findFirst({
      where: { organizationId, plateNormalized, deletedAt: null },
    });
  }

  mergeVisitCapture(params: {
    server: {
      id: string;
      version: number;
      complaint: string | null;
      mileageIn: number | null;
      fuelLevelPct: number | null;
      updatedAt: Date;
    };
    client: VisitCapture;
    clientTimestamp: Date;
  }):
    | { kind: 'conflict'; result: SyncOpResult }
    | {
        kind: 'merge';
        data: {
          complaint?: string;
          mileageIn?: number;
          fuelLevelPct?: number;
        };
        damagePoints?: VisitCapture['damagePoints'];
      } {
    const { server, client, clientTimestamp } = params;

    if (client.version !== undefined && client.version !== server.version) {
      return {
        kind: 'conflict',
        result: {
          operationId: '',
          status: 'conflict',
          serverEntityId: server.id,
          conflict: {
            code: ErrorCodes.OPTIMISTIC_LOCK,
            message: 'Visit was modified by another request',
            server: {
              version: server.version,
              updatedAt: server.updatedAt,
              complaint: server.complaint,
            },
            client: { version: client.version },
          },
        },
      };
    }

    const serverNewer = server.updatedAt.getTime() > clientTimestamp.getTime();
    const data: {
      complaint?: string;
      mileageIn?: number;
      fuelLevelPct?: number;
    } = {};

    if (client.complaint?.trim()) {
      const incoming = client.complaint.trim();
      if (!server.complaint) {
        data.complaint = incoming;
      } else if (server.complaint === incoming) {
        // unchanged
      } else if (serverNewer || server.complaint.includes(incoming)) {
        // Append-only on complaint conflict (§21.3)
        if (!server.complaint.includes(incoming)) {
          data.complaint = `${server.complaint}\n${incoming}`;
        }
      } else {
        data.complaint = incoming;
      }
    }

    if (typeof client.mileage === 'number') {
      const current = server.mileageIn ?? 0;
      data.mileageIn = Math.max(current, client.mileage);
    }

    if (typeof client.fuelLevelPct === 'number') {
      if (
        serverNewer &&
        server.fuelLevelPct != null &&
        server.fuelLevelPct !== client.fuelLevelPct
      ) {
        return {
          kind: 'conflict',
          result: {
            operationId: '',
            status: 'conflict',
            serverEntityId: server.id,
            conflict: {
              code: ErrorCodes.CONFLICT,
              message:
                'Concurrent fuel-level update requires manual resolution',
              server: {
                fuelLevelPct: server.fuelLevelPct,
                updatedAt: server.updatedAt,
              },
              client: { fuelLevelPct: client.fuelLevelPct },
            },
          },
        };
      }
      data.fuelLevelPct = client.fuelLevelPct;
    }

    return {
      kind: 'merge',
      data,
      damagePoints: client.damagePoints,
    };
  }
}
