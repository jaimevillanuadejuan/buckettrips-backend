## ADDED Requirements

### Requirement: Persist Generated Trip Itineraries
The system SHALL persist generated trip itineraries in PostgreSQL so trips can be retrieved later.

#### Scenario: Save trip successfully
- **WHEN** a client sends valid `location`, `startDate`, `endDate`, `theme`, and `itinerary` to `POST /api/trips`
- **THEN** the API creates a trip record
- **AND** responds with `id` and `createdAt`

#### Scenario: Reject invalid save payload
- **WHEN** required fields are missing, theme is outside `nature|historic`, or itinerary shape is invalid
- **THEN** the API responds with HTTP `400`
- **AND** includes an actionable error message

#### Scenario: Reject invalid date range
- **WHEN** `startDate` is after `endDate`
- **THEN** the API responds with HTTP `400`

### Requirement: List Saved Trips For My Trips View
The system SHALL expose a summary list of saved trips ordered from newest to oldest.

#### Scenario: Fetch trip summaries
- **WHEN** a client requests `GET /api/trips`
- **THEN** the API returns a list sorted by `createdAt` descending
- **AND** each item includes `id`, `location`, `theme`, `startDate`, `endDate`, `createdAt`, `provider`, and `model`

### Requirement: Retrieve A Saved Trip By ID
The system SHALL return full saved trip data for a valid trip ID.

#### Scenario: Trip exists
- **WHEN** a client requests `GET /api/trips/:tripId` for an existing record
- **THEN** the API returns the full trip including `itinerary`

#### Scenario: Trip missing
- **WHEN** a client requests `GET /api/trips/:tripId` for a missing record
- **THEN** the API responds with HTTP `404`

### Requirement: Delete Saved Trips
The system SHALL support hard-delete for saved trips in MVP.

#### Scenario: Delete existing trip
- **WHEN** a client sends `DELETE /api/trips/:tripId` for an existing record
- **THEN** the API deletes the record
- **AND** responds with HTTP `204`

#### Scenario: Delete missing trip
- **WHEN** a client sends `DELETE /api/trips/:tripId` for a missing record
- **THEN** the API responds with HTTP `404`

### Requirement: Keep Backend Contract Compatible With Current Frontend
The system SHALL keep runtime conventions that match the current local frontend setup.

#### Scenario: Local development defaults
- **WHEN** the backend starts with default configuration
- **THEN** it listens on port `8080`
- **AND** serves routes under `/api`
- **AND** allows CORS from `http://localhost:3000` unless overridden by `FRONTEND_URL`

### Requirement: Support Local Docker Startup For Backend Stack
The system SHALL provide a Docker-based local workflow that starts API and PostgreSQL together.

#### Scenario: Start backend stack with Docker Compose
- **WHEN** a developer runs `docker compose up --build` from the project root
- **THEN** a Postgres service is available on `localhost:5432`
- **AND** the API service is available on `http://localhost:8080`
