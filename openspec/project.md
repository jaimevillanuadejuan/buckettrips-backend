# Project Overview

## Purpose
BucketTrips backend provides APIs for itinerary generation and trip persistence (save, list, view, delete).

## Stack
- NestJS (TypeScript)
- OpenRouter chat completions for itinerary generation
- Prisma ORM (v6)
- PostgreSQL

## Conventions
- All public APIs are exposed under `/api`.
- Request validation is enforced with DTOs and `class-validator`.
- Generation endpoint is `POST /api/api-trips`.
- Persistence endpoints are `POST/GET /api/trips`, `GET /api/trips/:tripId`, and `DELETE /api/trips/:tripId`.
- Itinerary payloads are stored as JSON in Postgres for flexible schema evolution.
