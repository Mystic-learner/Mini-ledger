
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { z } from "zod";
import { pool } from "./db";

const app = express();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from .env");
}

app.use(cors());
app.use(express.json());

interface AuthRequest extends Request {
  userId?: number;
}

const pendingOtps = new Map<
  string,
  { otp: string; expiresAt: number }
>();

function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET!) as {
      userId: number;
    };

    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

// International phone number validation, e.g. +919876543210.
const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{9,14}$/, "Enter a valid phone number");

// Health check
app.get("/health", (_req: Request, res: Response) => {
  return res.json({
    status: "ok",
    message: "MiniLedger API is running",
  });
});

// Request mock OTP
app.post(
  "/api/auth/send-otp",
  (req: Request, res: Response) => {
    // Diagnostic output goes to stderr, separate from normal logs.
    process.stderr.write("[OTP DEBUG] ROUTE REACHED\n");

    const parsed = phoneSchema.safeParse(req.body?.phone);

    if (!parsed.success) {
      process.stderr.write("[OTP DEBUG] INVALID PHONE NUMBER\n");

      return res.status(400).json({
        message: "Enter a valid phone number",
      });
    }

    const phone = parsed.data;
    const otp = randomInt(100000, 1000000).toString();

    pendingOtps.set(phone, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Mock OTP is intentionally printed only in the backend terminal.
    process.stderr.write(
      `[MiniLedger] OTP for ${phone}: ${otp}\n`
    );

    return res.json({
      message: "OTP generated. Check the backend terminal.",
    });
  }
);

// Verify OTP and log in
app.post(
  "/api/auth/verify-otp",
  async (req: Request, res: Response) => {
    const parsed = z
      .object({
        phone: phoneSchema,
        otp: z.string().regex(/^\d{6}$/),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Enter a valid phone number and six-digit OTP",
      });
    }

    const { phone, otp } = parsed.data;
    const saved = pendingOtps.get(phone);

    if (
      !saved ||
      saved.otp !== otp ||
      saved.expiresAt < Date.now()
    ) {
      return res.status(401).json({
        message: "Invalid or expired OTP",
      });
    }

    pendingOtps.delete(phone);

    try {
      const result = await pool.query(
        `INSERT INTO users (phone)
         VALUES ($1)
         ON CONFLICT (phone)
         DO UPDATE SET phone = EXCLUDED.phone
         RETURNING id, phone`,
        [phone]
      );

      const user = result.rows[0];

      const token = jwt.sign(
        { userId: user.id },
        JWT_SECRET!,
        { expiresIn: "1d" }
      );

      return res.json({
        message: "Login successful",
        token,
        user,
      });
    } catch (error) {
      console.error("[MiniLedger] Login error:", error);

      return res.status(500).json({
        message: "Could not log in",
      });
    }
  }
);

// List the current user's loans
app.get(
  "/api/loans",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT
           id,
           friend_name,
           amount,
           due_date,
           is_repaid,
           created_at,
           (
             NOT is_repaid
             AND due_date < CURRENT_DATE
           ) AS is_overdue
         FROM loans
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.userId]
      );

      return res.json(result.rows);
    } catch (error) {
      console.error("[MiniLedger] List loans error:", error);

      return res.status(500).json({
        message: "Could not fetch loans",
      });
    }
  }
);

// Add a loan
app.post(
  "/api/loans",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    const parsed = z
      .object({
        friendName: z.string().trim().min(1).max(100),
        amount: z.number().positive().finite().max(100000000),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message:
          "Provide friendName, a positive amount and dueDate in YYYY-MM-DD format",
      });
    }

    const { friendName, amount, dueDate } = parsed.data;
    const date = new Date(`${dueDate}T00:00:00Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== dueDate
    ) {
      return res.status(400).json({
        message: "Invalid due date",
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO loans
           (user_id, friend_name, amount, due_date)
         VALUES ($1, $2, $3, $4)
         RETURNING id, friend_name, amount,
                   due_date, is_repaid, created_at`,
        [req.userId, friendName, amount, dueDate]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("[MiniLedger] Add loan error:", error);

      return res.status(500).json({
        message: "Could not add loan",
      });
    }
  }
);

// Mark a loan as repaid
app.patch(
  "/api/loans/:id/repay",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        message: "Invalid loan ID",
      });
    }

    try {
      const result = await pool.query(
        `UPDATE loans
         SET is_repaid = TRUE,
             repaid_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND user_id = $2
           AND is_repaid = FALSE
         RETURNING id, friend_name, amount,
                   due_date, is_repaid, repaid_at`,
        [id, req.userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          message: "Unpaid loan not found",
        });
      }

      return res.json({
        message: "Loan marked as repaid",
        loan: result.rows[0],
      });
    } catch (error) {
      console.error("[MiniLedger] Repay loan error:", error);

      return res.status(500).json({
        message: "Could not update loan",
      });
    }
  }
);

// Financial summary
app.get(
  "/api/summary",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT
           COALESCE(SUM(amount), 0) AS total_lent,
           COALESCE(
             SUM(amount) FILTER (WHERE is_repaid),
             0
           ) AS total_repaid,
           COALESCE(
             SUM(amount) FILTER (
               WHERE NOT is_repaid
                 AND due_date < CURRENT_DATE
             ),
             0
           ) AS overdue_amount
         FROM loans
         WHERE user_id = $1`,
        [req.userId]
      );

      return res.json(result.rows[0]);
    } catch (error) {
      console.error("[MiniLedger] Summary error:", error);

      return res.status(500).json({
        message: "Could not fetch summary",
      });
    }
  }
);

export default app;
