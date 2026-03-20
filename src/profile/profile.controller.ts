import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { UpsertProfileDto } from './profile.service';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // Called by NextAuth signIn callback to upsert the profile
  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: UpsertProfileDto) {
    return this.profileService.upsert(dto);
  }
}
