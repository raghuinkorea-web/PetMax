-- =====================================================================
-- ADISYS FieldOps — 009 Official holidays
-- ---------------------------------------------------------------------
-- Holidays are imported for a year from a public calendar and then
-- curated: the source lists every observance in India, of which a
-- company observes perhaps a dozen. `observed` is the company's answer,
-- and only observed days are shown or acted upon. Imports are therefore
-- non-destructive — re-importing a year never overwrites that decision.
-- =====================================================================

CREATE TABLE holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date  date NOT NULL,
  name          text NOT NULL,
  region        text NOT NULL DEFAULT 'IN-KA',
  -- 'imported' came from the public calendar; 'manual' was added here.
  source        text NOT NULL DEFAULT 'imported' CHECK (source IN ('imported','manual')),
  observed      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_holiday UNIQUE (holiday_date, name, region)
);

CREATE INDEX idx_holidays_year ON holidays ((EXTRACT(YEAR FROM holiday_date)::int), holiday_date);
CREATE INDEX idx_holidays_observed ON holidays (holiday_date) WHERE observed;

COMMENT ON COLUMN holidays.observed IS
  'Whether ADISYS closes on this day. Imported rows default to false unless '
  'they match the national gazetted list; an administrator curates the rest.';
