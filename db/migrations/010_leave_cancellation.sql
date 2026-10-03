-- =====================================================================
-- ADISYS FieldOps — 010 Cancelling a decided leave request
-- ---------------------------------------------------------------------
-- An approved leave sometimes has to be called off: the employee comes
-- back early, or the work cannot be covered. That is a cancellation, not
-- a rejection — the request was legitimately granted and later withdrawn,
-- and the two should not read the same in the record.
--
-- 009's constraint required cancelled rows to have no decider, which was
-- right while only the employee could withdraw a pending request. Now an
-- approver can cancel one that was already approved, so a cancelled row
-- may carry who did it. It stays optional: an employee withdrawing their
-- own pending request records no decider, exactly as before.
-- =====================================================================

ALTER TABLE leave_requests DROP CONSTRAINT chk_leave_decision;

ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_decision CHECK (
  -- A decision must say who made it and when.
  (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  -- Pending has not been decided at all.
  OR (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
  -- Cancelled may or may not have an actor, but never one without a time.
  OR (status = 'cancelled' AND (decided_by IS NULL OR decided_at IS NOT NULL))
);

COMMENT ON COLUMN leave_requests.decided_by IS
  'Who approved, rejected, or cancelled the request. Null when an employee '
  'withdrew their own pending request.';
