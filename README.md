# MiniLedger

A full-stack app for tracking money lent to friends: who owes what, what has been repaid, and what is overdue.

| | |
|---|---|
| **Web app** | [mini-ledger-mobile-fo0y4cg3v.vercel.app](https://mini-ledger-mobile-fo0y4cg3v.vercel.app/) |
| **API** | [mini-ledger-api.onrender.com](https://mini-ledger-api.onrender.com/) |
| **Source** | [github.com/Mystic-learner/Mini-ledger](https://github.com/Mystic-learner/Mini-ledger) |

## Overview

MiniLedger gives a single place to record loans between friends and see their status at a glance. Users sign in with a phone number and a one-time code, add loans with an amount and due date, and mark them repaid as money comes back. A dashboard summarises totals, and overdue loans are flagged automatically.

The client is a single Expo (React Native) codebase that runs on iOS, Android and the web. It talks to a REST API backed by PostgreSQL.

## Features

- **Phone-number sign-in** with a mock OTP flow and JWT sessions that persist across restarts.
- **Loan tracking** with friend name, amount and due date.
- **Repayments**: mark a loan as repaid, with confirmation.
- **Dashboard** showing total lent, paid back, outstanding and overdue amounts, plus a repayment progress bar.
- **Status filtering** across All, Outstanding, Overdue and Repaid.
- **Duplicate-name warning** when adding a loan for someone who already has one. It informs but never blocks.
- **Date safety**: due dates default to seven days ahead, are validated as real calendar dates, and cannot be more than five years in the future. Past dates are allowed so overdue behaviour can be tested.
- **Responsive layout** from small phones to desktop browsers.

## Architecture

```text
┌──────────────────────┐   HTTPS / JSON    ┌──────────────────────┐        ┌──────────────┐
│  Expo app            │ ────────────────▶ │  Express API         │ ─────▶ │  PostgreSQL  │
│  React Native + Web  │ ◀──────────────── │  Node.js, TypeScript │ ◀───── │              │
│  (Vercel)            │   Bearer JWT      │  (Render)            │   pg   │              │
└──────────────────────┘                   └──────────────────────┘        └──────────────┘
```

| Layer | Technology |
|---|---|
| Client | Expo, React Native, React Native Web, TypeScript |
| API | Node.js, Express 5, TypeScript, Zod (request validation) |
| Auth | JWT (1-day expiry), mock OTP |
| Database | PostgreSQL via `pg` |
| Tests | Node.js built-in test runner |
| Hosting | Vercel (client), Render (API) |

## Project structure

```text
Mini-ledger/
├── backend/
│   └── src/
│       ├── server.ts        # process entry point
│       ├── app.ts           # routes, auth middleware, validation
│       └── db.ts            # PostgreSQL pool and type parsing
└── mobile/
    ├── App.tsx              # screens and UI
    ├── loanUtils.ts         # date, status and duplicate-detection logic
    ├── loanUtils.test.ts    # unit tests
    ├── index.ts             # Expo entry point
    └── app.json             # Expo configuration
```

Date and duplicate-detection logic lives in `loanUtils.ts`, free of React imports, so it can be unit-tested directly.

## API reference

All `/api/loans` and `/api/summary` routes require an `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/auth/send-otp` | Generate a mock OTP for `{ phone }` |
| `POST` | `/api/auth/verify-otp` | Verify `{ phone, otp }` and return `{ token, user }` |
| `GET` | `/api/loans` | List the current user's loans, with an `is_overdue` flag |
| `POST` | `/api/loans` | Create a loan from `{ friendName, amount, dueDate }` |
| `PATCH` | `/api/loans/:id/repay` | Mark a loan as repaid |
| `GET` | `/api/summary` | Totals: `total_lent`, `total_repaid`, `overdue_amount` |

Phone numbers use international format, for example `+919876543210`. `dueDate` is `YYYY-MM-DD`.

## Getting started

### Prerequisites

- Node.js 22.6 or later (needed for `npm test`)
- PostgreSQL
- Git

### 1. Clone

```bash
git clone https://github.com/Mystic-learner/Mini-ledger.git
cd Mini-ledger
```

### 2. Database

Create a database named `miniledger`, then create the tables below. This reference schema is derived from the queries in `backend/src/app.ts`.

```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE loans (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date    DATE NOT NULL,
  is_repaid   BOOLEAN NOT NULL DEFAULT FALSE,
  repaid_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX loans_user_id_idx ON loans (user_id);
```

### 3. Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/miniledger
PORT=5000
JWT_SECRET=replace-with-a-long-random-string
```

```bash
npm run dev
```

### 4. Client

In a second terminal:

```bash
cd mobile
npm install
```

Create `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:5000
```

```bash
npx expo start          # choose iOS, Android or web from the menu
npx expo start --web    # web only
```

On a physical device, `localhost` points at the phone itself. Use your computer's LAN address instead, for example `http://192.168.1.20:5000`.

### Signing in

There is no SMS provider. After you request a code, the OTP is printed in the **backend terminal**:

```text
[MiniLedger] OTP for +919876543210: 123456
```

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | PostgreSQL connection string |
| `PORT` | backend | Port the API listens on |
| `JWT_SECRET` | backend | Secret used to sign tokens. The server refuses to start without it |
| `EXPO_PUBLIC_API_URL` | mobile | Base URL of the API. Defaults to `http://localhost:5000` |

Never commit `.env` files or secrets. In production, set these through the hosting provider's environment settings.

## Testing

```bash
cd mobile
npm test              # unit tests
npx tsc --noEmit      # type check
```

The unit tests cover default due dates, date validation (invalid dates, leap days, the five-year limit), conversion of API timestamps to calendar days, overdue and due-soon descriptions, name normalisation and duplicate detection. There are no automated API or UI tests yet.

## Design notes

**Calendar dates are not timestamps.** PostgreSQL `DATE` values carry no timezone, but the `pg` driver converts them to JavaScript `Date` objects at server-local midnight, and JSON serialisation turns those into UTC timestamps. On a server east of UTC, a stored `2026-10-30` reaches the client as `2026-10-29T18:30:00.000Z` and displays a day early. The backend now returns `DATE` columns as plain `YYYY-MM-DD` strings, and the client builds and compares dates from local calendar parts rather than through UTC.

**Overdue status is decided by the database.** `is_overdue` is computed in SQL against `CURRENT_DATE`, so the list and the summary totals always agree. The client only adds display hints such as "3 days overdue".

## Deployment

- **Client (Vercel):** build with `npx expo export --platform web` and serve the `dist` directory. Set `EXPO_PUBLIC_API_URL` to the API's public URL.
- **API (Render):** run `npm start` in `backend`, with `DATABASE_URL` and `JWT_SECRET` set in the service environment.

## Known limitations

- OTP verification is a demo. Codes are generated by the server and printed to its log, not delivered by SMS.
- Pending OTPs are held in server memory, so they are lost on restart and do not work across multiple API instances.
- CORS is open to all origins and there is no rate limiting on the auth endpoints. Both should be tightened before real use.
- Loans cannot be edited or deleted once created.

## Roadmap

- SMS-based OTP delivery with persistent storage and rate limiting
- Edit and delete loans
- Repayment history, including partial repayments
- Reminders and notifications for upcoming and overdue loans
- Exportable reports
- API integration tests and CI

## License

See [`mobile/LICENSE`](mobile/LICENSE).
