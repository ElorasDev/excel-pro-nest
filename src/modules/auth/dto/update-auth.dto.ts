import { PartialType } from '@nestjs/swagger';
import { CreateAuthDto } from './create-auth.dto';
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAuthDto extends PartialType(CreateAuthDto) {
  @ApiProperty({
    description: 'Current password for validation',
    required: false,
  })
  @IsString()
  @IsOptional()
  currentPassword?: string;
}
