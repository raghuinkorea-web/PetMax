import { one } from '../lib/db.js';

interface LocationPolicy {
  checkInLocationEnabled?: boolean;
  requireExplicitConsent?: boolean;
  /** Roles that may see ANY employee's recorded position. */
  visibleTo?: string[];
  /** Whether an employee's own reporting manager may see their positions. */
  visibleToReportingManager?: boolean;
}

const DEFAULT_POLICY: LocationPolicy = {
  checkInLocationEnabled: true,
  requireExplicitConsent: true,
  visibleTo: ['super_admin'],
  visibleToReportingManager: true,
};

export const locationPolicy = async (client?: any): Promise<LocationPolicy> => {
  const row = await one<{ value: LocationPolicy }>(
    `SELECT value FROM settings WHERE scope = 'productivity' AND key = 'location_policy'`, [], client);
  return { ...DEFAULT_POLICY, ...(row?.value ?? {}) };
};

/**
 * Whether this employee's coordinates may be stored at all. Capture is
 * switched off organisation-wide by checkInLocationEnabled, and otherwise
 * requires that the employee has personally consented — the same rule that
 * governs attendance geotagging, so the two can never diverge.
 */
export const mayStoreLocationFor = async (userId: string, client?: any): Promise<boolean> => {
  const policy = await locationPolicy(client);
  if (policy.checkInLocationEnabled === false) return false;
  if (policy.requireExplicitConsent === false) return true;
  const user = await one<{ location_consent_at: string | null }>(
    `SELECT location_consent_at FROM users WHERE id = $1`, [userId], client);
  return Boolean(user?.location_consent_at);
};

/**
 * Whether this viewer may see where a particular employee was.
 *
 * Deliberately narrower than "can view the assignment". Position data answers
 * "where was this person", which is why it is limited to the administrators
 * who own the policy, the employee's own reporting manager, and the employee
 * themselves — a manager on an unrelated project can still read the work, but
 * not the location of someone who does not report to them.
 */
export const maySeeLocationOf = async (
  viewer: { id: string; roleKey: string },
  assigneeId: string,
  client?: any,
): Promise<boolean> => {
  if (assigneeId === viewer.id) return true;
  const policy = await locationPolicy(client);
  if ((policy.visibleTo ?? []).includes(viewer.roleKey)) return true;
  if (policy.visibleToReportingManager === false) return false;
  const report = await one<{ ok: number }>(
    `SELECT 1 AS ok FROM users
      WHERE id = $1 AND reporting_manager_id = $2 AND deleted_at IS NULL`,
    [assigneeId, viewer.id], client);
  return Boolean(report);
};
