import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { UpsertProfileDto } from './profile.service';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: UpsertProfileDto) {
    return this.profileService.upsert(dto);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@Req() req: { user: { profileId: string } }) {
    const currency = await this.profileService.getPreferredCurrency(
      req.user.profileId,
    );
    return { preferredCurrency: currency };
  }

  @UseGuards(AuthGuard)
  @Post('currency')
  async setCurrency(
    @Body() body: { currency: string },
    @Req() req: { user: { profileId: string } },
  ) {
    return this.profileService.setPreferredCurrency(
      req.user.profileId,
      body.currency,
    );
  }
}
