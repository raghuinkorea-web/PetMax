/**
 * Configurable expense approval routing.
 *
 * Approval behaviour is DATA, not code: rows in `expense_policies` decide
 * whether a claim needs manager sign-off, finance sign-off, both, or
 * neither. Changing ADISYS policy is a Settings change, not a deployment.
 *
 * Matching: among active policies whose amount band contains the claim
 * and whose project/category/department dimensions either match or are
 * left blank (= "any"), the most SPECIFIC wins; ties break on `priority`.
 */
import { one, query, type Sql } from '../lib/db.js';
import { pool } from '../lib/db.js';

export interface ResolvedPolicy {
  policyId: string | null;
  policyName: string;
  requiresManager: boolean;
  requiresFinance: boolean;
  autoApproveBelow: number | null;
  receiptRequired: boolean;
  maxAmountPerClaim: number | null;
  dailyLimit: number | null;
}

export interface PolicyContext {
  amount: number;
  categoryId: string;
  projectId: string | null;
  departmentId: string | null;
}

/** Fallback used when no policy row matches: the safest possible routing. */
const DEFAULT_POLICY: Omit<ResolvedPolicy, 'receiptRequired' | 'maxAmountPerClaim' | 'dailyLimit'> = {
  policyId: null,
  policyName: 'Default (manager + finance)',
  requiresManager: true,
  requiresFinance: true,
  autoApproveBelow: null,
};

export async function resolvePolicy(ctx: PolicyContext, client: Sql = pool): Promise<ResolvedPolicy> {
  const category = await one<{
    receipt_required: boolean; max_amount_per_claim: number | null;
    daily_limit: number | null; parent_id: string | null;
  }>(`SELECT receipt_required, max_amount_per_claim, daily_limit, parent_id
        FROM expense_categories WHERE id = $1`, [ctx.categoryId], client);

  // A subcategory inherits limits from its parent unless it sets its own.
  let receiptRequired = category?.receipt_required ?? true;
  let maxAmountPerClaim = category?.max_amount_per_claim ?? null;
  let dailyLimit = category?.daily_limit ?? null;
  if (category?.parent_id) {
    const parent = await one<{ receipt_required: boolean; max_amount_per_claim: number | null; daily_limit: number | null }>(
      `SELECT receipt_required, max_amount_per_claim, daily_limit FROM expense_categories WHERE id = $1`,
      [category.parent_id], client);
    if (parent) {
      maxAmountPerClaim ??= parent.max_amount_per_claim;
      dailyLimit ??= parent.daily_limit;
    }
  }

  const rows = await query<{
    id: string; name: string; requires_manager: boolean; requires_finance: boolean;
    auto_approve_below: number | null; receipt_required: boolean | null; specificity: number;
  }>(
    `SELECT id, name, requires_manager, requires_finance, auto_approve_below, receipt_required,
            (CASE WHEN project_id    IS NOT NULL THEN 4 ELSE 0 END)
          + (CASE WHEN category_id   IS NOT NULL THEN 2 ELSE 0 END)
          + (CASE WHEN department_id IS NOT NULL THEN 1 ELSE 0 END) AS specificity
       FROM expense_policies
      WHERE active
        AND $1::numeric >= min_amount
        AND (max_amount IS NULL OR $1::numeric <= max_amount)
        AND (category_id   IS NULL OR category_id   = $2::uuid)
        AND (project_id    IS NULL OR project_id    = $3::uuid)
        AND (department_id IS NULL OR department_id = $4::uuid)
      ORDER BY specificity DESC, priority DESC, min_amount DESC
      LIMIT 1`,
    [ctx.amount, ctx.categoryId, ctx.projectId, ctx.departmentId], client);

  const match = rows[0];
  if (!match) return { ...DEFAULT_POLICY, receiptRequired, maxAmountPerClaim, dailyLimit };
  if (match.receipt_required !== null) receiptRequired = match.receipt_required;

  return {
    policyId: match.id,
    policyName: match.name,
    requiresManager: match.requires_manager,
    requiresFinance: match.requires_finance,
    autoApproveBelow: match.auto_approve_below,
    receiptRequired,
    maxAmountPerClaim,
    dailyLimit,
  };
}

export type Stage = 'manager' | 'finance';

/** The first stage a freshly submitted claim should land in, or null to auto-approve. */
export function initialStage(policy: ResolvedPolicy, amount: number): Stage | null {
  if (policy.autoApproveBelow !== null && amount < policy.autoApproveBelow) return null;
  if (policy.requiresManager) return 'manager';
  if (policy.requiresFinance) return 'finance';
  return null;
}

/** The stage that follows `current`, or null when the claim is fully approved. */
export function nextStage(policy: ResolvedPolicy, current: Stage): Stage | null {
  if (current === 'manager' && policy.requiresFinance) return 'finance';
  return null;
}

/**
 * Total already claimed by an employee for a category on a given date —
 * used to enforce daily limits (e.g. a food allowance cap).
 * Excludes the claim being edited and anything rejected or cancelled.
 */
export async function claimedOnDate(
  userId: string, categoryId: string, date: string, excludeClaimId: string | null, client: Sql = pool,
): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expense_claims
      WHERE user_id = $1 AND expense_date = $2::date
        AND deleted_at IS NULL
        AND status NOT IN ('rejected','cancelled','draft')
        AND (category_id = $3 OR subcategory_id = $3)
        AND ($4::uuid IS NULL OR id <> $4)`,
    [userId, date, categoryId, excludeClaimId], client);
  return Number(row?.total ?? 0);
}
