# MiniLedger

A full-stack application for tracking money lent to friends, repayments, and overdue loans.

## Features
- Phone-number login with mock OTP verification
- JWT authentication
- Create and track loans
- Mark loans as repaid
- Dashboard showing total lent, paid back, and overdue amounts
- PostgreSQL persistence

## Tech Stack
- Frontend: React Native, Expo, TypeScript
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL

## Setup
1. Install Node.js and PostgreSQL.
2. Create a PostgreSQL database named miniledger.
3. Configure backend/.env with DATABASE_URL, PORT, and JWT_SECRET.
4. In the backend folder, run npm install and npm run dev.
5. Configure mobile/.env with EXPO_PUBLIC_API_URL.
6. In the mobile folder, run npm install and npx expo start.

## Mock OTP
The OTP is printed in the backend terminal. No external SMS provider is configured.

## Security
Never commit .env files, database passwords, or JWT secrets.

## Project Structure
- backend/: API and database
- mobile/: Expo frontend

## License
See mobile/LICENSE.
