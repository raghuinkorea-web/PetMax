-- =====================================================================
-- ADISYS FieldOps — 008 Geotag work start and completion events
-- Attendance already proves an employee was on site at the start and end
-- of the DAY. It says nothing about where each individual job was worked,
-- which is what a customer disputing a site visit actually asks about.
--
-- Coordinates therefore attach to work_assignment_events rather than to
-- work_assignments: an assignment can be started, paused and resumed any
-- number of times, and each of those transitions has its own location.
-- Storing them on the assignment would keep only the last one.
--
-- Capture is best-effort, exactly as it is for attendance. A field
-- engineer inside a basement substation must still be able to start the
-- job, so every column here is nullable and no transition depends on a
-- fix being obtained. location_consented records WHY a row is null:
-- false means the employee has not consented, true means consent was
-- given but the device could not produce a fix.
--
-- No geofence comparison is made. work_locations.geofence_radius_m (250m)
-- combined with the ~10-20m accuracy these devices report would flag
-- legitimate work as off-site, so the raw position is stored and the
-- judgement is left to the manager reviewing it.
-- =====================================================================

ALTER TABLE work_assignment_events
  ADD COLUMN latitude           numeric(9,6),
  ADD COLUMN longitude          numeric(9,6),
  ADD COLUMN accuracy_m         numeric(6,1),
  ADD COLUMN location_consented boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN work_assignment_events.latitude IS
  'WGS84 latitude captured when the event was recorded. Null when the '
  'employee has not consented to location capture, or no fix was obtained.';
COMMENT ON COLUMN work_assignment_events.longitude IS
  'WGS84 longitude captured when the event was recorded. Null under the '
  'same conditions as latitude.';
COMMENT ON COLUMN work_assignment_events.accuracy_m IS
  'Device-reported horizontal accuracy in metres. Read this before drawing '
  'any conclusion from the position -- a 2000m accuracy is a cell-tower '
  'estimate, not a GPS fix.';
COMMENT ON COLUMN work_assignment_events.location_consented IS
  'Whether the employee had consented to location capture at the time of '
  'the event. Distinguishes "not permitted" from "permitted but no fix".';

-- Managers filter the geotagged history by assignment and, for the site
-- visit reports, by the transitions that actually matter.
CREATE INDEX ix_work_assignment_events_geo
    ON work_assignment_events (assignment_id, created_at DESC)
 WHERE latitude IS NOT NULL;
