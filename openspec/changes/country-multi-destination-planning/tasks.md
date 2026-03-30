## 1. DTO and Contract Updates
- [x] 1.1 Add destination scope fields in trip context/confirm contract (`scope`, `countryCode`, `destinations`)
- [x] 1.2 Extend confirm response DTO with `routeGeoJson`, `flightSuggestionsByLeg`, `hotelSuggestionsByDestination`
- [x] 1.3 Keep response backward-compatible for existing single-city consumers

## 2. Conversational Intelligence
- [x] 2.1 Update intent parsing to detect country-level input and emit `COUNTRY` scope
- [x] 2.2 Add guardrails for destination count by trip length (avoid overpacked plans)
- [x] 2.3 Ensure city-level requests still follow current flow unchanged

## 3. Multi-Destination Generation
- [x] 3.1 Build destination sequencing logic for country scope (ordered 2 to 6 stops)
- [x] 3.2 Build leg generation logic between consecutive stops
- [x] 3.3 Build compact `routeGeoJson` (`LineString`) for map rendering

## 4. Suggestion Aggregation
- [x] 4.1 Reuse Flights service to fetch top leg suggestions per leg
- [x] 4.2 Reuse Hotels service to fetch top destination suggestions per stop
- [x] 4.3 Normalize and cap results (e.g., top 3 flights, top 5 hotels)
- [x] 4.4 Do not persist raw provider payloads

## 5. Prisma and Persistence
- [x] 5.1 Add `TripScope` enum and new fields on `Trip` (`scope`, `countryCode`, `routeGeoJson`)
- [x] 5.2 Add `TripDestination` model with ordered stop rows
- [x] 5.3 Add `TripLeg` model with ordered leg rows
- [x] 5.4 Add migration and update trip create/read logic

## 6. Validation and Safety
- [x] 6.1 Validate `routeGeoJson` shape and coordinate order
- [x] 6.2 Validate stop/leg continuity (no gaps in order)
- [x] 6.3 Fallback gracefully if flights/hotels unavailable for one stop or leg

## 7. Verification
- [x] 7.1 Run `npm run prisma:generate`
- [x] 7.2 Run `npm run prisma:migrate:dev`
- [x] 7.3 Run `npm run build`
- [ ] 7.4 Manual test: one city trip + one country trip with 3+ stops
