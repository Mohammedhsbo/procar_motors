import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageProvider } from './storage/local-storage.provider';

@Module({
  controllers: [FilesController],
  providers: [FilesService, LocalStorageProvider],
  exports: [FilesService],
})
export class FilesModule {}
