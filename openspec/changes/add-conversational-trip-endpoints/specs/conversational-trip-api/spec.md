## ADDED Requirements

### Requirement: Parse Destination Intent
The system SHALL parse free-text destination intent into a normalized region signal for conversational trip intake.

#### Scenario: Parse intent
- **WHEN** a client sends raw destination text to `POST /api/trips/parse-intent`
- **THEN** the API returns normalized region candidates and a confidence score

### Requirement: Generate Contextual Follow-Up Questions
The system SHALL produce contextual follow-up prompts from accumulated trip context.

#### Scenario: Follow-up generation
- **WHEN** a client sends current `TripContext` to `POST /api/trips/contextual-questions`
- **THEN** the API returns 2-3 high-signal follow-up questions
- **AND** each question includes answer shape metadata (`yes_no`, `a_b`, or `free_text`)

### Requirement: Provide Accommodation Style Options
The system SHALL provide style-filtered accommodation options.

#### Scenario: Style filter request
- **WHEN** a client requests `GET /api/accommodations/style-filter` with destination/style/budget hints
- **THEN** the API returns style options filtered by those hints

### Requirement: Confirm Conversational Context Into Itinerary
The system SHALL generate itinerary drafts from confirmed conversational context.

#### Scenario: Confirm and generate
- **WHEN** a client sends `TripContext` with exact dates to `POST /api/trips/confirm`
- **THEN** the API validates the payload and calls the configured OpenRouter model
- **AND** returns structured itinerary output compatible with frontend rendering

#### Scenario: Confirm with refinement answers
- **WHEN** a client includes `followUpAnswers` in `POST /api/trips/confirm`
- **THEN** those answers influence regenerated itinerary output
