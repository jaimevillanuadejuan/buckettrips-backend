# Proposal: Move Trip Generation Workflow To Backend

## Why
Trip itinerary generation is currently initiated from the frontend, which exposes provider selection and model execution flow outside the backend boundary. Moving LLM calls server-side improves API key security, centralizes validation and error handling, and gives consistent control over retries, latency limits, and cost observability.

## What Changes
- Add backend generation endpoint `POST /api/api-trips` for inputs: `location`, `startDate`, `endDate`, `theme`, and optional `followUpAnswers`.
- Port the existing frontend generation workflow into a backend orchestration service inside the Trips module.
- Keep sensitive provider credentials in backend environment variables and remove any requirement for frontend-held model API secrets.
- Add structured error mapping for generation failures (`400` for invalid inputs, `503` for upstream generation failures, `504` for generation timeout).
- Preserve existing persistence/list/detail/delete endpoints:
  - `POST /api/trips`
  - `GET /api/trips`
  - `GET /api/trips/:tripId`
  - `DELETE /api/trips/:tripId`
- Update API and local setup documentation to describe backend generation configuration and request/response contract for `POST /api/api-trips`.

## Impact
- Frontend shifts from direct LLM invocation to a single backend API call for itinerary generation.
- Security posture improves by removing LLM secrets from browser runtime.
- Backend gains ownership of prompt/version rollout, provider failover behavior, and generation observability.
- Existing persisted trip retrieval flows remain intact with minimal frontend changes outside itinerary generation call targets.
