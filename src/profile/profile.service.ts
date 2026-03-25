import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertProfileDto {
  oauthProvider: string;
  oauthId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  preferredCurrency?: string | null;
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
        preferredCurrency: dto.preferredCurrency ?? null,
      },
      update: {
        updatedAt: new Date(),
        // Only set preferredCurrency if not already set
        ...(dto.preferredCurrency ? { preferredCurrency: dto.preferredCurrency } : {}),
      },
      select: { id: true, email: true, name: true, avatarUrl: true, preferredCurrency: true },
    });
  }

  async getPreferredCurrency(profileId: string): Promise<string | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { preferredCurrency: true },
    });
    return profile?.preferredCurrency?.trim() ?? null;
  }

  async setPreferredCurrency(profileId: string, currency: string) {
    await this.prisma.profile.update({
      where: { id: profileId },
      data: { preferredCurrency: currency },
    });
    return { ok: true };
  }
}
