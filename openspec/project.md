# Project Overview

## Purpose
BucketTrips backend provides both conversational trip-intake APIs and trip persistence APIs.

## Stack
- NestJS (TypeScript)
- OpenRouter chat completions for itinerary generation
- Prisma ORM (v6)
- PostgreSQL

## Conventions
- All public APIs are exposed under `/api`.
- Request validation is enforced with DTOs and `class-validator`.
- Conversational endpoints (`/api/trips/parse-intent`, `/api/trips/contextual-questions`, `/api/trips/confirm`) feed itinerary generation.
- Persistence endpoints (`POST/GET/DELETE /api/trips`) store and manage generated trips.
