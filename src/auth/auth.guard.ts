import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('INTERNAL_API_KEY') ?? '';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const incomingKey = request.headers['x-api-key'];
    const profileId = request.headers['x-profile-id'];

    if (!incomingKey || incomingKey !== this.apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!profileId) {
      throw new UnauthorizedException('Missing profile ID');
    }

    request.user = { profileId };
    return true;
  }
}
