-- =====================================================================
-- ADISYS FieldOps — 009 Narrow who may see recorded positions
-- Position data answers "where was this person", which is a stricter
-- question than "what work was done". Any ops_manager could previously
-- read the coordinates of any employee, including people on unrelated
-- projects who did not report to them.
--
-- Visibility is now: administrators, the employee's own reporting manager
-- (users.reporting_manager_id), and the employee themselves. A manager on
-- an unrelated project can still read the work -- only the location is
-- withheld.
--
-- purpose is rewritten because migration 008 extended capture beyond
-- attendance to the start and completion of each job, and this text is
-- what a privacy review reads.
-- =====================================================================

UPDATE settings
   SET value = value
       || jsonb_build_object(
            'visibleTo', jsonb_build_array('super_admin'),
            'visibleToReportingManager', true,
            'purpose', 'Confirms the employee was at the assigned site when '
                    || 'the working day started and ended, and when each job '
                    || 'was started and marked done.')
 WHERE scope = 'productivity' AND key = 'location_policy';
