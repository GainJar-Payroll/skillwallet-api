import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DelegationGrant, DelegationGrantSchema } from './schemas/delegation-grant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DelegationGrant.name, schema: DelegationGrantSchema }]),
  ],
  providers: [],
  controllers: [],
  exports: [MongooseModule],
})
export class DelegationsModule {}
