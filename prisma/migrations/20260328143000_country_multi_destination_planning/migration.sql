-- Trip scope enum
DO $$
BEGIN
  CREATE TYPE "TripScope" AS ENUM ('CITY', 'COUNTRY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Extend Trip table
ALTER TABLE "Trip"
  ADD COLUMN IF NOT EXISTS "scope" "TripScope" NOT NULL DEFAULT 'CITY',
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "routeGeoJson" JSONB;

CREATE INDEX IF NOT EXISTS "Trip_scope_countryCode_idx" ON "Trip"("scope", "countryCode");

-- Ordered destination stops per trip
CREATE TABLE IF NOT EXISTS "TripDestination" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "stopOrder" INTEGER NOT NULL,
  "cityName" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "nights" INTEGER,
  "selectedHotelSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TripDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TripDestination_tripId_stopOrder_key" ON "TripDestination"("tripId", "stopOrder");
CREATE INDEX IF NOT EXISTS "TripDestination_tripId_idx" ON "TripDestination"("tripId");

DO $$
BEGIN
  ALTER TABLE "TripDestination"
    ADD CONSTRAINT "TripDestination_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ordered transport legs between stops
CREATE TABLE IF NOT EXISTS "TripLeg" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "legOrder" INTEGER NOT NULL,
  "fromStopOrder" INTEGER NOT NULL,
  "toStopOrder" INTEGER NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'flight',
  "departureDate" TIMESTAMP(3),
  "selectedFlightSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TripLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TripLeg_tripId_legOrder_key" ON "TripLeg"("tripId", "legOrder");
CREATE INDEX IF NOT EXISTS "TripLeg_tripId_idx" ON "TripLeg"("tripId");

DO $$
BEGIN
  ALTER TABLE "TripLeg"
    ADD CONSTRAINT "TripLeg_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
