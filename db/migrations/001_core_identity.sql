-- =====================================================================
-- ADISYS FieldOps — 001 Core identity, RBAC and organisation structure
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Enumerated domains (kept as CHECK-constrained text for easy extension
-- through the Settings module without blocking DDL migrations).
-- ---------------------------------------------------------------------
CREATE TABLE app_enum (
  domain      text NOT NULL,
  value       text NOT NULL,
  label       text NOT NULL,
  color       text,
  sort_order  int  NOT NULL DEFAULT 0,
  is_system   boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (domain, value)
);
COMMENT ON TABLE app_enum IS 'Configurable status/label vocabularies surfaced in the Settings module.';

-- ---------------------------------------------------------------------
-- Roles & permissions (RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,          -- e.g. 'expense.approve.finance'
  module      text NOT NULL,                 -- e.g. 'expense'
  description text NOT NULL
);
CREATE INDEX idx_permissions_module ON permissions(module);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------
CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  head_user_id uuid,                          -- FK added after users exists
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE designations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  grade      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  address_line text,
  city         text,
  state        text,
  country      text NOT NULL DEFAULT 'India',
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  geofence_radius_m int,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Users.
-- Design note: at ADISYS every authenticated principal is a member of
-- staff, so identity (auth) and employment (HR) attributes live on one
-- table. This removes the dual-key ambiguity that otherwise causes
-- double-counting between "user" and "employee" in reports. An
-- `employees` view (migration 006) preserves the domain vocabulary.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code         text NOT NULL UNIQUE,
  full_name             text NOT NULL,
  email                 text NOT NULL,
  phone                 text NOT NULL,
  password_hash         text,
  must_change_password  boolean NOT NULL DEFAULT true,
  avatar_file_id        uuid,                       -- FK added in 004 (files)
  role_id               uuid NOT NULL REFERENCES roles(id),
  department_id         uuid REFERENCES departments(id),
  designation_id        uuid REFERENCES designations(id),
  base_location_id      uuid REFERENCES work_locations(id),
  reporting_manager_id  uuid REFERENCES users(id),
  date_of_joining       date,
  status                text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited','active','inactive','suspended')),
  location_consent_at   timestamptz,                -- explicit opt-in for check-in geotagging
  last_login_at         timestamptz,
  failed_login_count    int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_phone ON users (phone)        WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role       ON users(role_id);
CREATE INDEX idx_users_manager    ON users(reporting_manager_id);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_status     ON users(status) WHERE deleted_at IS NULL;

ALTER TABLE departments
  ADD CONSTRAINT fk_departments_head FOREIGN KEY (head_user_id) REFERENCES users(id);

-- Per-user permission overrides keep least-privilege tuning out of roles.
CREATE TABLE user_permission_overrides (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        text NOT NULL CHECK (effect IN ('allow','deny')),
  granted_by    uuid REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

-- ---------------------------------------------------------------------
-- Authentication sessions (refresh-token rotation) and login audit
-- ---------------------------------------------------------------------
CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  client             text NOT NULL DEFAULT 'web' CHECK (client IN ('web','android','ios')),
  device_label       text,
  user_agent         text,
  ip_address         inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES auth_sessions(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  identifier  text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  successful  boolean NOT NULL,
  failure_reason text,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_identifier ON login_attempts(identifier, created_at DESC);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
