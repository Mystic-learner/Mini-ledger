/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysString,
  defaultDueDate,
  dueNote,
  findExistingLoans,
  formatDate,
  maxDueDate,
  normalizeDueDate,
  normalizeName,
  toDateString,
  validateDueDate,
} from "./loanUtils.ts";

test("default due date is exactly 7 local days from today", () => {
  const now = new Date();
  const expected = toDateString(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
  );
  assert.equal(defaultDueDate(), expected);
  assert.match(defaultDueDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(validateDueDate(defaultDueDate()), null);
});

test("rejects dates more than five years ahead (the 2056 bug)", () => {
  assert.notEqual(validateDueDate("2056-12-17"), null);
  assert.equal(validateDueDate(maxDueDate()), null);
});

test("rejects impossible and badly formatted dates", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "17/12/2026", "", "2026-1-5"]) {
    assert.notEqual(validateDueDate(bad), null, bad);
  }
});

test("allows past dates (for overdue testing) and leap days", () => {
  assert.equal(validateDueDate("2020-01-01"), null);
  assert.equal(validateDueDate("2024-02-29"), null);
});

test("ISO timestamps from the API map to the local calendar day", () => {
  const iso = new Date(2026, 9, 30).toISOString();
  assert.equal(normalizeDueDate(iso), "2026-10-30");
  assert.equal(normalizeDueDate("2026-10-30"), "2026-10-30");
});

test("displayed date matches the stored date", () => {
  assert.match(formatDate("2026-10-30"), /^30 Oct 2026$/);
});

test("dueNote describes outstanding, overdue and repaid loans", () => {
  const base = { is_repaid: false, is_overdue: false };
  assert.equal(dueNote({ ...base, due_date: addDaysString(0) }), "due today");
  assert.equal(dueNote({ ...base, due_date: addDaysString(1) }), "in 1 day");
  assert.equal(dueNote({ ...base, due_date: addDaysString(5) }), "in 5 days");
  assert.equal(
    dueNote({ is_repaid: false, is_overdue: true, due_date: addDaysString(-3) }),
    "3 days overdue"
  );
  assert.equal(
    dueNote({ is_repaid: true, is_overdue: false, due_date: addDaysString(-3) }),
    ""
  );
});

test("normalizeName ignores case, edge and repeated spaces", () => {
  assert.equal(normalizeName("  Rahul   Sharma "), "rahul sharma");
});

test("findExistingLoans finds same-name loans and ignores others", () => {
  const loans = [
    { friend_name: "Rahul", amount: 100, due_date: "2026-11-01", is_repaid: false },
    { friend_name: "  rahul ", amount: 50, due_date: "2026-11-02", is_repaid: true },
    { friend_name: "Priya", amount: 80, due_date: "2026-11-03", is_repaid: false },
  ];
  assert.equal(findExistingLoans("RAHUL", loans).length, 2);
  assert.equal(findExistingLoans("Priya", loans).length, 1);
  assert.equal(findExistingLoans("Rahu", loans).length, 0);
  assert.equal(findExistingLoans("   ", loans).length, 0);
  assert.equal(findExistingLoans("", []).length, 0);
});