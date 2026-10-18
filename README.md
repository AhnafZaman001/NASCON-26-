# NASCON '26

Monorepo (npm workspaces) for the NASCON '26 web platform.

```
apps/web        Next.js (App Router, TypeScript, Tailwind) - UI + API routes
apps/worker     BullMQ consumer: sends queued emails with nodemailer
packages/ui     Shared constants and UI primitives
packages/queue  Shared BullMQ queue name, job types, enqueue helper
supabase/       SQL migrations (apply in numeric order)
```

## Getting started
```
npm install
cp apps/web/.env.example apps/web/.env.local       # Supabase keys, REDIS_URL
cp apps/worker/.env.example apps/worker/.env       # Supabase secret, Redis, SMTP
npm run dev            # web
npm run dev:worker     # email worker (needs Redis: docker run -p 6379:6379 redis:7)
```

## Email flow
1. Server inserts rows into `public.emails` (status `pending`) for a user.
2. `POST /api/emails/send` (Bearer Supabase token) or `npm run enqueue -w @nascon/worker -- <user-uuid>`
   puts `{ userId }` on the `emails` BullMQ queue.
3. `apps/worker` claims that user's pending rows (`claim_user_emails`), sends each via nodemailer,
   marks them `sent` / retries / `failed`.
