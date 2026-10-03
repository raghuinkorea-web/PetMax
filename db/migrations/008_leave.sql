-- =====================================================================
-- ADISYS FieldOps — 008 Leave management
-- ---------------------------------------------------------------------
-- Leave is a first-class absence record, deliberately separate from
-- attendance: attendance answers "was this person on duty", leave answers
-- "was this person entitled to be away". An approved leave day is neither
-- on duty nor absent, and the reporting views below make that explicit so
-- no report can quietly count approved leave against someone.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE leave_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_paid     boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code  text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  from_date     date NOT NULL,
  to_date       date NOT NULL,
  -- Inclusive of both ends: a single-day leave is one day, not zero.
  total_days    int GENERATED ALWAYS AS ((to_date - from_date) + 1) STORED,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_leave_window CHECK (to_date >= from_date),
  -- A decided request must record who decided it; pending and cancelled must not.
  CONSTRAINT chk_leave_decision CHECK (
    (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (status IN ('pending','cancelled') AND decided_by IS NULL)
  )
);

-- One employee cannot hold two live requests over the same dates. Rejected
-- and cancelled rows are excluded, so a refused request may be re-submitted.
ALTER TABLE leave_requests ADD CONSTRAINT no_overlapping_live_leave
  EXCLUDE USING gist (
    user_id WITH =,
    daterange(from_date, to_date, '[]') WITH &&
  ) WHERE (status IN ('pending','approved'));

CREATE INDEX idx_leave_user_dates ON leave_requests(user_id, from_date DESC);
CREATE INDEX idx_leave_status     ON leave_requests(status) WHERE status = 'pending';
CREATE INDEX idx_leave_range      ON leave_requests USING gist (daterange(from_date, to_date, '[]'));

-- ---------------------------------------------------------------------
-- Reporting views
-- ---------------------------------------------------------------------

/* One row per employee per approved leave DAY. Reports join this rather
   than re-deriving ranges, so "on leave" means the same thing everywhere. */
CREATE VIEW approved_leave_days AS
SELECT lr.user_id,
       d::date        AS leave_date,
       lr.id          AS leave_request_id,
       lt.key         AS leave_type_key,
       lt.name        AS leave_type_name,
       lt.is_paid
  FROM leave_requests lr
  JOIN leave_types lt ON lt.id = lr.leave_type_id
  CROSS JOIN LATERAL generate_series(lr.from_date, lr.to_date, interval '1 day') AS d
 WHERE lr.status = 'approved';

/* Who is on approved leave right now. The employee directory and the
   dashboard both read this, so the badge cannot drift from the data. */
CREATE VIEW employees_on_leave_today AS
SELECT ald.user_id, ald.leave_type_name, lr.from_date, lr.to_date
  FROM approved_leave_days ald
  JOIN leave_requests lr ON lr.id = ald.leave_request_id
 WHERE ald.leave_date = CURRENT_DATE;

COMMENT ON TABLE leave_requests IS
  'Leave applications and their decisions. An approved day is an entitled '
  'absence: it is neither on-duty attendance nor an unexplained absence.';
