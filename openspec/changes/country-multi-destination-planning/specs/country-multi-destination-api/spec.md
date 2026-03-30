## ADDED Requirements

### Requirement: Support Country-Level Trip Scope
The system SHALL detect and support country-level trip requests in addition to existing city-level requests.

#### Scenario: Detect country scope
- **WHEN** a user expresses destination intent as a country in conversational trip intake
- **THEN** the backend marks the trip scope as `COUNTRY`
- **AND** preserves the resolved country code for downstream planning

#### Scenario: Preserve city scope behavior
- **WHEN** destination intent is city-level
- **THEN** the backend keeps scope as `CITY`
- **AND** existing itinerary behavior remains unchanged

### Requirement: Generate Ordered Multi-Destination Plans For Country Scope
The system SHALL generate a practical, ordered stop sequence for country-level trips.

#### Scenario: Country trip with sufficient duration
- **WHEN** `POST /api/trips/confirm` receives country-scoped context with valid dates
- **THEN** the response includes `destinations[]` in stop order
- **AND** each destination includes city name, country code, coordinates, and stay window metadata

#### Scenario: Trip too short for many stops
- **WHEN** the trip window is short relative to country travel complexity
- **THEN** the backend limits destination count to a feasible number
- **AND** avoids overpacked stop sequencing

### Requirement: Return Leg-Level Flight Suggestions
The system SHALL return flight suggestions grouped by transport leg for country-scoped itineraries.

#### Scenario: Leg flight suggestions available
- **WHEN** inter-stop legs are generated
- **THEN** the response includes `flightSuggestionsByLeg[]`
- **AND** each group is keyed by leg order with normalized top options

#### Scenario: Flight suggestions unavailable for a leg
- **WHEN** a provider returns no results or errors for one leg
- **THEN** the backend returns an empty suggestion group for that leg
- **AND** itinerary generation still succeeds

### Requirement: Return Destination-Level Hotel Suggestions
The system SHALL return hotel suggestions grouped by destination stop for country-scoped itineraries.

#### Scenario: Destination hotel suggestions available
- **WHEN** destination stops are generated
- **THEN** the response includes `hotelSuggestionsByDestination[]`
- **AND** each group is keyed by stop order with normalized top options

#### Scenario: Hotel suggestions unavailable for a stop
- **WHEN** a provider returns no results or errors for one destination
- **THEN** the backend returns an empty suggestion group for that destination
- **AND** itinerary generation still succeeds

### Requirement: Provide Route Geometry For Map Rendering
The system SHALL provide route geometry for client-side itinerary map visualization.

#### Scenario: Country route generated
- **WHEN** destinations are ordered for a country-scoped trip
- **THEN** the backend returns `routeGeoJson` as a valid GeoJSON `LineString`
- **AND** coordinate order follows destination stop order

### Requirement: Persist Multi-Destination Metadata Lightweightly
The system SHALL persist country itinerary graph data without storing full provider payloads.

#### Scenario: Save country-scoped trip
- **WHEN** a country-scoped trip is saved
- **THEN** the database stores scope and country metadata on `Trip`
- **AND** ordered stops and legs are stored in lightweight relational rows
- **AND** only selected suggestion snapshots are saved as JSON

#### Scenario: Save city-scoped trip
- **WHEN** a city-scoped trip is saved
- **THEN** destination/leg child tables remain optional
- **AND** save behavior remains compatible with current city-trip persistence
