-- =====================================================================
-- ADISYS FieldOps — 004 Private file storage and expense management
-- =====================================================================

-- Files are NEVER served from a public path. `storage_key` is opaque and
-- every read goes through an authorised API endpoint that re-checks the
-- caller's right to the owning record.
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key     text NOT NULL UNIQUE,
  original_name   text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 char(64) NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  purpose         text NOT NULL DEFAULT 'receipt'
                  CHECK (purpose IN ('receipt','work_proof','avatar','assignment_attachment')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX idx_files_uploader ON files(uploaded_by);
CREATE INDEX idx_files_checksum ON files(checksum_sha256);

ALTER TABLE users ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_file_id) REFERENCES files(id);

CREATE TABLE work_assignment_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  file_id       uuid NOT NULL REFERENCES files(id),
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  kind          text NOT NULL DEFAULT 'instruction'
                CHECK (kind IN ('instruction','work_proof')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_attachments ON work_assignment_attachments(assignment_id);

-- ---------------------------------------------------------------------
-- Expense categories (two levels: category -> subcategory)
-- ---------------------------------------------------------------------
CREATE TABLE expense_categories (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id            uuid REFERENCES expense_categories(id) ON DELETE CASCADE,
  key                  text NOT NULL UNIQUE,
  name                 text NOT NULL,
  icon                 text,
  receipt_required     boolean NOT NULL DEFAULT true,
  project_required     boolean NOT NULL DEFAULT true,
  max_amount_per_claim numeric(14,2) CHECK (max_amount_per_claim IS NULL OR max_amount_per_claim > 0),
  daily_limit          numeric(14,2) CHECK (daily_limit IS NULL OR daily_limit > 0),
  form_variant         text NOT NULL DEFAULT 'standard'
                       CHECK (form_variant IN ('standard','fuel','food','purchase')),
  sort_order           int NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_categories_parent ON expense_categories(parent_id);

-- ---------------------------------------------------------------------
-- Expense claims
-- ---------------------------------------------------------------------
CREATE TABLE expense_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_code     text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id),       -- submitter of record
  project_id       uuid REFERENCES projects(id),
  category_id      uuid NOT NULL REFERENCES expense_categories(id),
  subcategory_id   uuid REFERENCES expense_categories(id),
  expense_date     date NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'INR',
  description      text NOT NULL,
  vendor_name      text,
  invoice_number   text,
  expense_location text,
  payment_method   text CHECK (payment_method IS NULL OR payment_method IN
                    ('cash','upi','card','company_card','bank_transfer','other')),
  notes            text,
  -- Fuel-claim specific
  vehicle_number   text,
  fuel_type        text CHECK (fuel_type IS NULL OR fuel_type IN ('petrol','diesel','cng','ev')),
  fuel_quantity    numeric(8,2) CHECK (fuel_quantity IS NULL OR fuel_quantity > 0),
  odometer_reading numeric(10,1),
  travel_purpose   text,
  -- Food-claim specific
  meal_type        text CHECK (meal_type IS NULL OR meal_type IN ('breakfast','lunch','dinner','other')),
  -- Claim period (for consolidated/periodic claims)
  claim_period_start date,
  claim_period_end   date,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','under_review','returned',
                                     'approved','rejected','reimbursement_pending','paid','cancelled')),
  current_stage    text CHECK (current_stage IS NULL OR current_stage IN ('manager','finance')),
  submitted_at     timestamptz,
  decided_at       timestamptz,
  rejection_reason text,
  -- Fingerprint of the economically meaningful fields, used to warn on
  -- likely duplicate submissions (same person, day, amount, vendor).
  duplicate_hash   text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT chk_claim_period CHECK (
    claim_period_end IS NULL OR claim_period_start IS NULL OR claim_period_end >= claim_period_start
  ),
  CONSTRAINT chk_rejection_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT chk_submitted_has_timestamp CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);
CREATE INDEX idx_claims_user       ON expense_claims(user_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_claims_project    ON expense_claims(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_claims_status     ON expense_claims(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_claims_date       ON expense_claims(expense_date DESC);
CREATE INDEX idx_claims_category   ON expense_claims(category_id);
CREATE INDEX idx_claims_duplicate  ON expense_claims(duplicate_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_claims_queue      ON expense_claims(current_stage, submitted_at)
  WHERE status IN ('submitted','under_review') AND deleted_at IS NULL;

CREATE TABLE expense_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     uuid NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files(id),
  kind         text NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt','supporting')),
  ocr_status   text NOT NULL DEFAULT 'not_run'
               CHECK (ocr_status IN ('not_run','queued','completed','failed')),
  ocr_payload  jsonb,          -- extracted values, ALWAYS pending employee confirmation
  ocr_confirmed_by_user boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_attachments_claim ON expense_attachments(claim_id);

-- ---------------------------------------------------------------------
-- Approval trail. Append-only: every action is retained, so a returned
-- claim keeps its whole history through correction and resubmission.
-- ---------------------------------------------------------------------
CREATE TABLE expense_approvals (
  id          bigserial PRIMARY KEY,
  claim_id    uuid NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  stage       text NOT NULL CHECK (stage IN ('employee','manager','finance','system')),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL CHECK (action IN
              ('submitted','resubmitted','reviewed','approved','rejected','returned',
               'cancelled','marked_paid','auto_approved')),
  from_status text,
  to_status   text NOT NULL,
  comment     text,
  acted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_approvals_claim ON expense_approvals(claim_id, acted_at);

-- ---------------------------------------------------------------------
-- Configurable approval routing. The most specific matching, highest
-- priority active policy wins; rules are evaluated server-side only.
-- ---------------------------------------------------------------------
CREATE TABLE expense_policies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  category_id        uuid REFERENCES expense_categories(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES projects(id) ON DELETE CASCADE,
  department_id      uuid REFERENCES departments(id) ON DELETE CASCADE,
  min_amount         numeric(14,2) NOT NULL DEFAULT 0,
  max_amount         numeric(14,2),
  requires_manager   boolean NOT NULL DEFAULT true,
  requires_finance   boolean NOT NULL DEFAULT true,
  auto_approve_below numeric(14,2),
  receipt_required   boolean,
  priority           int NOT NULL DEFAULT 100,
  active             boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_policy_amount_range CHECK (max_amount IS NULL OR max_amount >= min_amount)
);
CREATE INDEX idx_expense_policies_lookup ON expense_policies(active, priority DESC);

CREATE TABLE reimbursement_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code  text NOT NULL UNIQUE,
  paid_at     timestamptz,
  payment_reference text,
  payment_mode text CHECK (payment_mode IS NULL OR payment_mode IN ('bank_transfer','upi','cash','payroll')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reimbursement_items (
  batch_id  uuid NOT NULL REFERENCES reimbursement_batches(id) ON DELETE CASCADE,
  claim_id  uuid NOT NULL REFERENCES expense_claims(id),
  amount    numeric(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (batch_id, claim_id)
);
-- A claim can only ever be paid once.
CREATE UNIQUE INDEX uq_reimbursement_claim ON reimbursement_items(claim_id);
