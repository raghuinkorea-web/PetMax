-- =====================================================================
-- ADISYS FieldOps — 002 Projects, membership and work assignments
-- =====================================================================

CREATE TABLE project_types (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code        text NOT NULL UNIQUE,
  name                text NOT NULL,
  description         text,
  client_name         text NOT NULL,
  client_location     text,
  project_type_id     uuid REFERENCES project_types(id),
  manager_id          uuid NOT NULL REFERENCES users(id),
  start_date          date NOT NULL,
  expected_end_date   date,
  actual_end_date     date,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','active','on_hold','completed','cancelled')),
  priority            text NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low','medium','high','critical')),
  budget_amount       numeric(14,2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  budget_enabled      boolean NOT NULL DEFAULT false,
  currency            char(3) NOT NULL DEFAULT 'INR',
  requires_project_on_expense boolean NOT NULL DEFAULT true,
  notes               text,
  created_by          uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT chk_project_dates CHECK (expected_end_date IS NULL OR expected_end_date >= start_date)
);
CREATE INDEX idx_projects_status  ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_manager ON projects(manager_id);
CREATE INDEX idx_projects_dates   ON projects(start_date, expected_end_date);

-- The single authorisation edge: an employee may only log work or claim
-- expenses against a project they are an active member of.
CREATE TABLE project_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_project text NOT NULL DEFAULT 'member'
                  CHECK (role_in_project IN ('member','lead','supervisor','observer')),
  allocation_pct  int CHECK (allocation_pct BETWEEN 0 AND 100),
  assigned_by     uuid NOT NULL REFERENCES users(id),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz
);
CREATE UNIQUE INDEX uq_project_member_active
  ON project_members(project_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX idx_project_members_user ON project_members(user_id) WHERE removed_at IS NULL;

CREATE TABLE work_types (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- Work assignments.
-- `version` is bumped whenever a field that changes the *substance* of
-- the work is edited. Acknowledgements record the version they were
-- given, so the app can show "this assignment changed since you
-- acknowledged it" instead of silently accepting a stale acknowledgement.
-- ---------------------------------------------------------------------
CREATE TABLE work_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_code   text NOT NULL UNIQUE,
  project_id        uuid NOT NULL REFERENCES projects(id),
  assignee_id       uuid NOT NULL REFERENCES users(id),
  title             text NOT NULL,
  description       text,
  work_type_id      uuid REFERENCES work_types(id),
  priority          text NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','critical')),
  assignment_date   date NOT NULL,
  due_date          date NOT NULL,
  planned_start_at  timestamptz,
  planned_end_at    timestamptz,
  estimated_hours   numeric(6,2) CHECK (estimated_hours IS NULL OR estimated_hours > 0),
  location_id       uuid REFERENCES work_locations(id),
  location_text     text,
  instructions      text,
  recurrence_rule   text,                 -- iCal RRULE subset; NULL = one-off
  recurrence_parent_id uuid REFERENCES work_assignments(id) ON DELETE SET NULL,
  depends_on_id     uuid REFERENCES work_assignments(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'assigned'
                    CHECK (status IN ('assigned','acknowledged','in_progress','on_hold',
                                      'submitted','completed','clarification_requested','cancelled')),
  version           int NOT NULL DEFAULT 1,
  progress_pct      int NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  completion_notes  text,
  submitted_at      timestamptz,
  completed_at      timestamptz,
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  review_comment    text,
  assigned_by       uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT chk_assignment_dates CHECK (due_date >= assignment_date),
  CONSTRAINT chk_no_self_dependency CHECK (depends_on_id IS NULL OR depends_on_id <> id)
);
CREATE INDEX idx_wa_assignee_date ON work_assignments(assignee_id, assignment_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_wa_project       ON work_assignments(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_wa_status        ON work_assignments(status)     WHERE deleted_at IS NULL;
CREATE INDEX idx_wa_due           ON work_assignments(due_date)   WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Acknowledgements.
-- Acknowledgement confirms RECEIPT AND REVIEW of an assignment. It never
-- implies the work is done. One row per (assignment, version) so the
-- full acknowledgement history survives re-issues of changed work.
-- ---------------------------------------------------------------------
CREATE TABLE assignment_acknowledgements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id      uuid NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id),
  assignment_version int  NOT NULL,
  decision           text NOT NULL CHECK (decision IN ('acknowledged','clarification_requested','declined')),
  mode               text NOT NULL DEFAULT 'individual'
                     CHECK (mode IN ('individual','bulk_daily','bulk_weekly')),
  reason             text,
  device_label       text,
  ip_address         inet,
  acknowledged_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_ack_assignment_version
  ON assignment_acknowledgements(assignment_id, assignment_version);
CREATE INDEX idx_ack_user ON assignment_acknowledgements(user_id, acknowledged_at DESC);

-- Immutable audit trail of every assignment status/field transition.
CREATE TABLE work_assignment_events (
  id            bigserial PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES users(id),
  event_type    text NOT NULL,   -- created | status_changed | edited | progress_updated | reviewed
  from_status   text,
  to_status     text,
  changed_fields jsonb,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_events_assignment ON work_assignment_events(assignment_id, created_at DESC);
