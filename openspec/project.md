# Project Overview

## Purpose
BucketTrips backend provides persistence APIs for saving, listing, viewing, and deleting AI-generated trip itineraries.

## Stack
- NestJS (TypeScript)
- Prisma ORM (v6)
- PostgreSQL

## Conventions
- All public APIs are exposed under `/api`.
- Request validation is enforced with DTOs and `class-validator`.
- API responses use clear status codes (`400`, `404`, `204`) for predictable frontend handling.
- Itinerary payloads are stored as JSON in Postgres for flexible schema evolution.
