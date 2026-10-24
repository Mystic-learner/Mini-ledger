// Pure helpers (no React / React Native imports) so they can be unit-tested
// with `npm test`.

export type LoanLike = {
  friend_name: string;
  amount: string | number;
  due_date: string;
  is_repaid: boolean;
  is_overdue?: boolean;
};

export const DEFAULT_DUE_DAYS = 7;
export const MAX_YEARS_AHEAD = 5;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DUE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "+7 days", days: 7 },
  { label: "+14 days", days: 14 },
  { label: "+30 days", days: 30 },
];

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

// Local calendar date as YYYY-MM-DD. Never goes through UTC, so it cannot
// shift by a day.
export function toDateString(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}

export function addDaysString(days: number) {
  const now = new Date();
  return toDateString(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  );
}

export function defaultDueDate() {
  return addDaysString(DEFAULT_DUE_DAYS);
}

export function maxDueDate() {
  const now = new Date();
  return toDateString(
    new Date(now.getFullYear() + MAX_YEARS_AHEAD, now.getMonth(), now.getDate())
  );
}

// Returns the parts only for a real calendar date in YYYY-MM-DD form.
export function parseDateParts(value: string) {
  if (!DATE_PATTERN.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(year, month - 1, day);

  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

// The API should send YYYY-MM-DD. If it sends a full ISO timestamp (what the
// pg driver produces for DATE columns), convert it to the local calendar day.
export function normalizeDueDate(value: string) {
  if (DATE_PATTERN.test(value)) return value;

  const parsed = new Date(value);
  if (value.includes("T") && !Number.isNaN(parsed.getTime())) {
    return toDateString(parsed);
  }

  return value.slice(0, 10);
}

export function formatDate(value: string) {
  const parts = parseDateParts(normalizeDueDate(value));
  if (!parts) return value;

  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );
}

// Past dates are allowed (overdue testing); far-future dates are not.
export function validateDueDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return "Enter the due date as YYYY-MM-DD.";
  if (!parseDateParts(value)) return "That date doesn't exist on the calendar.";

  if (value > maxDueDate()) {
    return `Due date can't be more than ${MAX_YEARS_AHEAD} years ahead (latest: ${formatDate(
      maxDueDate()
    )}).`;
  }

  return null;
}

export function daysUntil(value: string) {
  const parts = parseDateParts(normalizeDueDate(value));
  if (!parts) return null;

  const now = new Date();
  const due = Date.UTC(parts.year, parts.month - 1, parts.day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((due - today) / 86400000);
}

// Display-only hint. Overdue status itself still comes from the backend.
export function dueNote(loan: Pick<LoanLike, "due_date" | "is_repaid" | "is_overdue">) {
  if (loan.is_repaid) return "";

  const diff = daysUntil(loan.due_date);
  if (diff === null) return "";

  if (diff < 0) {
    return loan.is_overdue ? `${-diff} day${diff === -1 ? "" : "s"} overdue` : "";
  }

  if (diff === 0) return "due today";
  return `in ${diff} day${diff === 1 ? "" : "s"}`;
}

// Case-, spacing- and edge-whitespace-insensitive name key.
export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Existing loans for the same friend. Used for a non-blocking warning only.
export function findExistingLoans<T extends Pick<LoanLike, "friend_name">>(
  name: string,
  loans: T[]
) {
  const key = normalizeName(name);
  if (!key) return [];
  return loans.filter((loan) => normalizeName(loan.friend_name) === key);
}