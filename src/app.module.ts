import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccommodationsModule } from './accommodations/accommodations.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FlightsModule } from './flights/flights.module';
import { HotelsModule } from './hotels/hotels.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { TripsModule } from './trips/trips.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProfileModule,
    TripsModule,
    AccommodationsModule,
    FlightsModule,
    HotelsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
