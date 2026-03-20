import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertProfileDto {
  oauthProvider: string;
  oauthId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(dto: UpsertProfileDto) {
    return this.prisma.profile.upsert({
      where: { oauthProvider_oauthId: { oauthProvider: dto.oauthProvider, oauthId: dto.oauthId } },
      create: {
        oauthProvider: dto.oauthProvider,
        oauthId: dto.oauthId,
        email: dto.email,
        name: dto.name,
        avatarUrl: dto.avatarUrl,
      },
      update: {
        updatedAt: new Date(),
      },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
  }
}
