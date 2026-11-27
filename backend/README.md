# Backend Starter for School Management System

## Setup

1. Copy `.env.example` to `.env`
2. Set `APP_DATABASE_URL` to a restricted runtime login and `JWT_SECRET`. Keep owner credentials in a separate migration environment; the API does not read `DATABASE_URL`.
3. Run `npm install`
4. From the repository root, initialize the empty database with `npm run db:init`, then apply the protected timetable and learning-assignment migrations with their dedicated `npm run db:migrate:*` commands when approved. These guarded commands verify the configured target and connected migration identity. Do not execute `sql/schema.sql` or migration files directly with `psql`; direct SQL execution bypasses those safeguards.
5. Start the server:
   - `npm run dev`

## API Overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/students`
- `POST /api/students`
- `PUT /api/students/:id`
- `DELETE /api/students/:id`
- `GET /api/classes`
- `POST /api/classes`
- `POST /api/attendance`
- `GET /api/attendance/:classId`
- `POST /api/fees`
- `GET /api/fees/:studentId`
- `POST /api/results`
- `GET /api/results/:studentId`

## Notes

- Authenticated routes require a bearer token in `Authorization: Bearer <token>`.
- The `register` route can create a new school when `school_name` is provided.
- Users are scoped to one school via `school_id`.
