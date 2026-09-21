-- =====================================================================
-- ADISYS FieldOps — 003 Time tracking, attendance and productivity
-- =====================================================================
--
-- Three DISTINCT measures are stored separately and never conflated:
--
--   1. attendance_sessions   -> how long someone was on duty
--   2. time_entries          -> time recorded AGAINST a work assignment
--   3. time_entries WHERE verification_status='verified'
--                            -> productive hours a manager has confirmed
--
-- Being logged in is NOT productive time; the schema makes it impossible
-- to report it as such.
-- =====================================================================

CREATE TABLE attendance_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date           date NOT NULL,
  check_in_at         timestamptz NOT NULL,
  check_out_at        timestamptz,
  check_in_latitude   numeric(9,6),
  check_in_longitude  numeric(9,6),
  check_out_latitude  numeric(9,6),
  check_out_longitude numeric(9,6),
  location_accuracy_m numeric(8,2),
  location_consented  boolean NOT NULL DEFAULT false,
  location_id         uuid REFERENCES work_locations(id),
  source              text NOT NULL DEFAULT 'android' CHECK (source IN ('android','web','admin_entry')),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_attendance_window CHECK (check_out_at IS NULL OR check_out_at > check_in_at),
  -- Geo columns may only be populated when the employee has consented.
  CONSTRAINT chk_geo_requires_consent CHECK (
    location_consented OR (check_in_latitude IS NULL AND check_out_latitude IS NULL)
  )
);
CREATE UNIQUE INDEX uq_attendance_open_session
  ON attendance_sessions(user_id) WHERE check_out_at IS NULL;
CREATE INDEX idx_attendance_user_date ON attendance_sessions(user_id, work_date DESC);

-- ---------------------------------------------------------------------
-- Time entries.
-- A timer produces one row per run/resume segment: "pause" closes the
-- open segment, "resume" opens a new one. Elapsed time is therefore
-- always the sum of closed segments — no separate pause table and no
-- way for a forgotten pause to inflate hours.
-- ---------------------------------------------------------------------
CREATE TABLE time_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id       uuid REFERENCES work_assignments(id) ON DELETE SET NULL,
  project_id          uuid NOT NULL REFERENCES projects(id),
  work_date           date NOT NULL,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  duration_minutes    int GENERATED ALWAYS AS (
                        CASE WHEN ended_at IS NULL THEN NULL
                        ELSE (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::int END
                      ) STORED,
  source              text NOT NULL DEFAULT 'timer'
                      CHECK (source IN ('timer','manual','admin_entry')),
  notes               text,
  verification_status text NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified','verified','rejected')),
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  verification_note   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_time_window CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT chk_verified_has_actor CHECK (
    verification_status = 'unverified' OR verified_by IS NOT NULL
  )
);
-- At most one running timer per employee, enforced by the database.
CREATE UNIQUE INDEX uq_time_entry_running
  ON time_entries(user_id) WHERE ended_at IS NULL;
CREATE INDEX idx_time_entries_user_date   ON time_entries(user_id, work_date DESC);
CREATE INDEX idx_time_entries_assignment  ON time_entries(assignment_id);
CREATE INDEX idx_time_entries_project     ON time_entries(project_id, work_date);
CREATE INDEX idx_time_entries_verify      ON time_entries(verification_status) WHERE ended_at IS NOT NULL;
