-- =====================================================================
-- ADISYS FieldOps — 007 Optional employee email
-- Staff imported from the company employee list do not all have an email
-- address. The address was NOT NULL, which left only two bad options:
-- invent a mailbox, or leave the person out of the system entirely.
--
-- It is now nullable. A person is still identified by their employee code
-- and mobile number, both of which remain NOT NULL and unique, and sign-in
-- already matches on any of the three -- `lower(email) = lower($1)` simply
-- yields NULL for these rows and falls through to the other two.
--
-- uq_users_email needs no change: it indexes lower(email) and PostgreSQL
-- treats NULLs as distinct, so any number of rows may have no address.
-- =====================================================================

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

COMMENT ON COLUMN users.email IS
  'Optional. Null where the employee record carries no email address; '
  'sign-in then works by employee code or mobile number.';
