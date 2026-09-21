-- =====================================================================
-- ADISYS FieldOps — 005 Notifications, audit log, settings, code counters
-- =====================================================================

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,          -- work.assigned, expense.approved, ...
  title       text NOT NULL,
  body        text NOT NULL,
  entity_type text,                   -- work_assignment | expense_claim | project
  entity_id   uuid,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','critical')),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    text NOT NULL,
  in_app  boolean NOT NULL DEFAULT true,
  push    boolean NOT NULL DEFAULT true,
  email   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL CHECK (platform IN ('android','ios','web')),
  device_label text,
  active       boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_devices_user ON push_devices(user_id) WHERE active;

-- Outbox pattern: the API writes here, a background worker delivers.
CREATE TABLE notification_outbox (
  id           bigserial PRIMARY KEY,
  notification_id uuid REFERENCES notifications(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('push','email','whatsapp')),
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sending','sent','failed','skipped')),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON notification_outbox(status, scheduled_for) WHERE status IN ('queued','failed');

-- ---------------------------------------------------------------------
-- Audit log — who did what, to which record, with before/after state.
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text,
  action      text NOT NULL,            -- user.created, expense.approved, ...
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip_address  inet,
  user_agent  text,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);

-- ---------------------------------------------------------------------
-- Settings — scoped JSONB documents, validated server-side against a
-- Zod schema per key before being written.
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  scope      text NOT NULL,             -- organization | productivity | expense | notification | security
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- ---------------------------------------------------------------------
-- Human-readable, gap-free document codes (EMP-0001, PRJ-0007, EXP-2026-0142)
-- ---------------------------------------------------------------------
CREATE TABLE code_counters (
  entity  text NOT NULL,
  period  text NOT NULL DEFAULT '-',    -- '-' for non-resetting sequences
  counter bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, period)
);

CREATE OR REPLACE FUNCTION next_code(p_entity text, p_prefix text, p_period text DEFAULT '-', p_width int DEFAULT 4)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE v_next bigint;
BEGIN
  INSERT INTO code_counters(entity, period, counter) VALUES (p_entity, p_period, 1)
  ON CONFLICT (entity, period) DO UPDATE SET counter = code_counters.counter + 1
  RETURNING counter INTO v_next;

  IF p_period = '-' THEN
    RETURN p_prefix || '-' || lpad(v_next::text, p_width, '0');
  ELSE
    RETURN p_prefix || '-' || p_period || '-' || lpad(v_next::text, p_width, '0');
  END IF;
END;
$$;
COMMENT ON FUNCTION next_code IS 'Atomically allocates the next document code for an entity.';

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','departments','projects','work_assignments','expense_claims',
                           'expense_categories','expense_policies','time_entries',
                           'attendance_sessions','roles']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
