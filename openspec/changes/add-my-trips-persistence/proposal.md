# Proposal: Add My Trips Persistence API

## Why
The current frontend can generate and refine itineraries, but persistence requires backend storage so users can access a `my-trips` list and detail view later. A dedicated backend API is needed to save generated plans reliably in PostgreSQL.

## What Changes
- Add Prisma `Trip` model for itinerary persistence.
- Add NestJS `TripsModule` with CRUD endpoints for MVP:
  - `POST /api/trips`
  - `GET /api/trips`
  - `GET /api/trips/:tripId`
  - `DELETE /api/trips/:tripId`
- Validate incoming save payloads with DTO rules and itinerary shape guards.
- Keep backend CORS and API prefix compatible with current frontend (`http://localhost:3000` by default).

## Impact
- Enables frontend `Save Trip` flow with real database persistence.
- Supports `my-trips` list/detail/delete experiences in a separate frontend counterpart change.
- Keeps MVP intentionally simple (single portfolio user, no authentication).
