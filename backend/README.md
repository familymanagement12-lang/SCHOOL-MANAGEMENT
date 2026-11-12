# Backend Starter for School Management System

## Setup

1. Copy `.env.example` to `.env`
2. Update `DATABASE_URL` and `JWT_SECRET`
3. Run `npm install`
4. Create a PostgreSQL database and run `psql -d <your-db> -f sql/schema.sql`
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
