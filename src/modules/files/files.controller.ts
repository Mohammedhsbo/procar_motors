import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentKind, AttachmentPhase } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../rbac/decorators/request.decorators';
import type { AuthUserContext } from '../auth/auth.types';
import { ErrorCodes } from '../../common/constants/error-codes';
import { FilesService } from './files.service';

class CreateUploadDto {
  @IsString()
  @MinLength(1)
  filename!: string;

  @IsString()
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  size!: number;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;
}

class PutContentDto {
  @IsOptional()
  @IsString()
  base64?: string;
}

class CreateAttachmentDto {
  @IsUUID()
  fileId!: string;

  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsUUID()
  entityId!: string;

  @IsEnum(AttachmentKind)
  kind!: AttachmentKind;

  @IsOptional()
  @IsEnum(AttachmentPhase)
  phase?: AttachmentPhase;
}

class ListAttachmentsQuery {
  @IsString()
  @MinLength(1)
  entityType!: string;

  @IsUUID()
  entityId!: string;

  @IsOptional()
  @IsEnum(AttachmentPhase)
  phase?: AttachmentPhase;
}

@ApiTags('files')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Branch-Id', required: true })
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('files/uploads')
  @ApiOperation({ summary: 'Create upload intent (local URL in dev)' })
  createUpload(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: CreateUploadDto,
    @Req() req: Request,
  ) {
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
    const host = req.get('host') ?? 'localhost:3000';
    const baseUrl = `${proto}://${host}`;
    return this.files.createUpload(user.orgId, user.sub, dto, baseUrl);
  }

  @Put('files/:id/content')
  @ApiOperation({
    summary: 'Upload file binary (multipart field "file" or JSON base64)',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async putContent(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string } | undefined,
    @Body() body: PutContentDto,
  ) {
    let buffer: Buffer | undefined = file?.buffer;
    if (!buffer && body?.base64) {
      buffer = Buffer.from(body.base64, 'base64');
    }
    if (!buffer?.length) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Provide multipart file or JSON { base64 }',
      });
    }
    return this.files.putContent(user.orgId, id, buffer, file?.mimetype);
  }

  @Post('files/:id/confirm')
  @ApiOperation({ summary: 'Confirm uploaded file' })
  confirm(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.files.confirm(user.orgId, id);
  }

  @Get('files/:id/content')
  @ApiOperation({ summary: 'Download a confirmed file' })
  async getContent(
    @CurrentUser() user: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.files.getContent(user.orgId, id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.filename)}"`,
    );
    // Private: these are customer vehicle photos.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  }

  @Get('attachments')
  @ApiOperation({ summary: 'List attachments for one entity' })
  listAttachments(
    @CurrentUser() user: AuthUserContext,
    @Query() query: ListAttachmentsQuery,
  ) {
    return this.files.listAttachments(
      user.orgId,
      query.entityType,
      query.entityId,
      query.phase,
    );
  }

  @Post('attachments')
  @ApiOperation({ summary: 'Link confirmed file to an entity' })
  createAttachment(
    @CurrentUser() user: AuthUserContext,
    @Body() dto: CreateAttachmentDto,
  ) {
    return this.files.createAttachment(user.orgId, user.sub, dto);
  }
}
