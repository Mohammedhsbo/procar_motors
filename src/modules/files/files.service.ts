import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AttachmentKind, AttachmentPhase } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes';
import { LocalStorageProvider } from './storage/local-storage.provider';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
]);

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageProvider,
  ) {}

  async createUpload(
    organizationId: string,
    actorId: string,
    dto: {
      filename: string;
      mimeType: string;
      size: number;
      entityType?: string;
      entityId?: string;
    },
    baseUrl: string,
  ) {
    if (!ALLOWED_MIME.has(dto.mimeType)) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unsupported mime type: ${dto.mimeType}`,
        details: { allowed: [...ALLOWED_MIME] },
      });
    }
    if (dto.size <= 0 || dto.size > MAX_SIZE) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `File size must be between 1 and ${MAX_SIZE} bytes`,
      });
    }

    const id = randomUUID();
    const ext = dto.filename.includes('.')
      ? dto.filename.slice(dto.filename.lastIndexOf('.'))
      : '';
    const key = `${organizationId}/${id}${ext}`;

    const file = await this.prisma.storedFile.create({
      data: {
        id,
        organizationId,
        key,
        filename: dto.filename,
        mime: dto.mimeType,
        size: dto.size,
        status: 'pending',
        uploadedBy: actorId,
      },
    });

    return {
      fileId: file.id,
      uploadUrl: this.storage.buildUploadUrl(file.id, baseUrl),
      method: 'PUT' as const,
      headers: { 'Content-Type': dto.mimeType },
      key: file.key,
      maxSize: MAX_SIZE,
      meta: {
        entityType: dto.entityType ?? null,
        entityId: dto.entityId ?? null,
      },
    };
  }

  async putContent(
    organizationId: string,
    fileId: string,
    buffer: Buffer,
    contentType?: string,
  ) {
    const file = await this.findOwned(organizationId, fileId);
    if (file.status === 'confirmed') {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'File already confirmed',
      });
    }
    if (buffer.length > MAX_SIZE) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Uploaded file exceeds max size',
      });
    }
    if (contentType && contentType !== file.mime) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Content-Type does not match declared mime type',
      });
    }

    await this.storage.writeBuffer(file.key, buffer);
    await this.prisma.storedFile.update({
      where: { id: fileId },
      data: { size: buffer.length },
    });

    return { fileId, uploaded: true, size: buffer.length };
  }

  async confirm(organizationId: string, fileId: string) {
    const file = await this.findOwned(organizationId, fileId);
    const exists = await this.storage.exists(file.key);
    if (!exists) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Upload not found — PUT file content first',
      });
    }
    const actualSize = await this.storage.size(file.key);
    if (actualSize <= 0) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Uploaded file is empty',
      });
    }

    const confirmed = await this.prisma.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        size: actualSize,
      },
    });

    return {
      fileId: confirmed.id,
      key: confirmed.key,
      mime: confirmed.mime,
      size: confirmed.size,
      status: confirmed.status,
      confirmedAt: confirmed.confirmedAt,
    };
  }

  async createAttachment(
    organizationId: string,
    actorId: string,
    dto: {
      fileId: string;
      entityType: string;
      entityId: string;
      kind: AttachmentKind;
      phase?: AttachmentPhase;
    },
  ) {
    const file = await this.findOwned(organizationId, dto.fileId);
    if (file.status !== 'confirmed') {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'File must be confirmed before attaching',
      });
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        organizationId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        fileKey: file.key,
        mime: file.mime,
        size: file.size,
        kind: dto.kind,
        phase: dto.phase ?? 'other',
        uploadedBy: actorId,
      },
    });

    return {
      id: attachment.id,
      fileId: file.id,
      fileKey: attachment.fileKey,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      kind: attachment.kind,
      phase: attachment.phase,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
    };
  }

  private async findOwned(organizationId: string, fileId: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, organizationId },
    });
    if (!file) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'File not found',
      });
    }
    return file;
  }
}
