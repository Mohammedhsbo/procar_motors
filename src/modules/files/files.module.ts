import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { StorageProvider } from './storage/storage.provider';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    LocalStorageProvider,
    // Swap this binding for an S3/R2 provider in phase 04 — nothing else changes.
    { provide: StorageProvider, useExisting: LocalStorageProvider },
  ],
  exports: [FilesService, StorageProvider],
})
export class FilesModule {}
