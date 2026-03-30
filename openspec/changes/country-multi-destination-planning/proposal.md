# Proposal: Country-Level Multi-Destination Planning API

## Why

Current trip generation is effectively single-destination (`location` + itinerary JSON). That works for city trips, but not for requests like "I want to visit Japan for 12 days" where users expect:
- multiple stop suggestions inside the country
- flight suggestions per leg
- hotel suggestions per stop
- an ordered route that can be drawn in a map overview

## What Changes

- Extend conversational interpretation to classify destination scope:
  - `CITY` (existing behavior)
  - `COUNTRY` (new multi-destination behavior)
- In `POST /api/trips/confirm`, when scope is `COUNTRY`:
  - generate ordered destination stops (2 to 6, duration-aware)
  - generate inter-stop transport legs (flight-first, rail where practical)
  - return grouped suggestion payloads:
    - `flightSuggestionsByLeg[]`
    - `hotelSuggestionsByDestination[]`
  - return route geometry for map rendering:
    - `routeGeoJson` (`LineString`)
- Keep existing city-trip behavior unchanged and backward compatible.

## Lightweight Prisma Proposal (Recommended)

Persist only curated selections and display graph metadata, not raw provider responses.

```prisma
enum TripScope {
  CITY
  COUNTRY
}

model Trip {
  id                  String   @id @default(cuid())
  location            String
  startDate           DateTime
  endDate             DateTime
  provider            String?
  model               String?
  itinerary           Json
  profileId           String
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  accommodationBudget Json?
  accommodationType   String?
  flightBudget        Json?
  originCity          String?

  // New lightweight multi-destination fields
  scope               TripScope @default(CITY)
  countryCode         String?
  routeGeoJson        Json?

  profile             Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  destinations        TripDestination[]
  legs                TripLeg[]

  @@index([createdAt(sort: Desc)])
  @@index([location])
  @@index([profileId])
  @@index([scope, countryCode])
}

model TripDestination {
  id                    String   @id @default(cuid())
  tripId                 String
  stopOrder              Int
  cityName               String
  countryCode            String
  latitude               Float
  longitude              Float
  startDate              DateTime?
  endDate                DateTime?
  nights                 Int?
  selectedHotelSnapshot  Json?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  trip Trip @relation(fields: [tripId], references: [id], onDelete: Cascade)

  @@unique([tripId, stopOrder])
  @@index([tripId])
}

model TripLeg {
  id                     String   @id @default(cuid())
  tripId                 String
  legOrder               Int
  fromStopOrder          Int
  toStopOrder            Int
  mode                   String   @default("flight")
  departureDate          DateTime?
  selectedFlightSnapshot Json?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  trip Trip @relation(fields: [tripId], references: [id], onDelete: Cascade)

  @@unique([tripId, legOrder])
  @@index([tripId])
}
```

### Why this schema is lightweight

- Uses small normalized rows for stops/legs.
- Stores only selected snapshots as `Json` for future display and rehydration.
- Avoids storing full vendor payloads and avoids provider-coupled tables.

## Alternative (Even Lighter, Fewer Migrations)

Keep only `Trip.scope`, `Trip.countryCode`, and `Trip.routeGeoJson`; store all stops/legs/suggestions inside `Trip.itinerary` JSON.

Tradeoff:
- Faster to ship.
- Harder to query/order/filter stops/legs later.

## Impact

- Country-level trip planning becomes first-class in backend contract.
- Frontend can render leg/stop cards and a map route directly from API payload.
- Persistence remains practical and queryable without over-modeling external provider data.
