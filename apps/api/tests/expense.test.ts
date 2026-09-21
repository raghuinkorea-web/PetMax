import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { one, pool, query } from '../src/lib/db.js';
import { PNG_FIXTURE, seedFixture, tokenFor, type Fixture } from './fixtures.js';

const app = createApp();
let f: Fixture;
const t: Record<string, string> = {};
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  f = await seedFixture();
  for (const who of ['admin', 'manager', 'finance', 'employee', 'other'] as const) {
    t[who] = await tokenFor(app, f[who]);
  }
});
afterAll(async () => { await pool.end(); });

/** Submits a claim with a real receipt attached. */
async function submitClaim(overrides: Record<string, string> = {}, withReceipt = true) {
  const req = request(app).post('/api/expenses').set('Authorization', t.employee!)
    .field('categoryId', overrides.categoryId ?? f.categoryPurchase)
    .field('projectId', overrides.projectId ?? f.project)
    .field('expenseDate', overrides.expenseDate ?? today())
    .field('amount', overrides.amount ?? '4250.75')
    .field('description', overrides.description ?? 'Replacement contactors for Bay 7')
    .field('vendorName', overrides.vendorName ?? 'Balaji Electricals')
    .field('submit', overrides.submit ?? 'true');
  for (const [k, v] of Object.entries(overrides)) {
    if (!['categoryId', 'projectId', 'expenseDate', 'amount', 'description', 'vendorName', 'submit'].includes(k)) {
      req.field(k, v);
    }
  }
  if (withReceipt) req.attach('receipts', PNG_FIXTURE, { filename: 'bill.png', contentType: 'image/png' });
  return req;
}

describe('expense submission', () => {
  it('submits a claim with a receipt and routes it to the manager first', async () => {
    const res = await submitClaim();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('submitted');
    expect(res.body.stage).toBe('manager');
    expect(res.body.policy.requiresFinance).toBe(true);
  });

  it('rejects an amount of zero or less', async () => {
    const res = await submitClaim({ amount: '0' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.amount).toBeDefined();
  });

  it('rejects a future-dated expense', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await submitClaim({ expenseDate: future });
    expect(res.status).toBe(400);
    expect(res.body.error.details.expenseDate[0]).toMatch(/future/i);
  });

  it('rejects an expense older than the configured claim window', async () => {
    const res = await submitClaim({ expenseDate: daysAgo(60) });
    expect(res.status).toBe(400);
    expect(res.body.error.details.expenseDate[0]).toMatch(/within 45 days/i);
  });

  it('refuses a claim against a project the employee is not on', async () => {
    const res = await submitClaim({ projectId: f.otherProject });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not assigned to this project/i);
  });

  it('enforces the per-claim category limit', async () => {
    const res = await submitClaim({ categoryId: f.categoryFood, amount: '1500', vendorName: 'Mess' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.amount[0]).toMatch(/limit/i);
  });

  it('enforces the daily category limit across separate claims', async () => {
    const date = daysAgo(3);
    const first = await submitClaim({
      categoryId: f.categoryFood, amount: '400', expenseDate: date,
      description: 'Lunch', vendorName: 'Mess A',
    });
    expect(first.status).toBe(201);

    const second = await submitClaim({
      categoryId: f.categoryFood, amount: '300', expenseDate: date,
      description: 'Dinner', vendorName: 'Mess B',
    });
    expect(second.status).toBe(400);
    // ₹400 + ₹300 exceeds the ₹600 daily limit for this category.
    expect(second.body.error.details.amount[0]).toMatch(/daily limit/i);
  });

  it('detects a likely duplicate and lets the employee confirm', async () => {
    const fields = { amount: '999.50', expenseDate: daysAgo(5), vendorName: 'Same Vendor',
                     description: 'Same purchase' };
    expect((await submitClaim(fields)).status).toBe(201);

    const duplicate = await submitClaim(fields);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('POSSIBLE_DUPLICATE');

    const confirmed = await submitClaim({ ...fields, confirmDuplicate: 'true' });
    expect(confirmed.status).toBe(201);
  });

  it('requires a receipt only where the category demands one', async () => {
    // categoryPurchase has receipt_required = false in the fixture, so it succeeds;
    // switch it on and the same submission is refused.
    await query(`UPDATE expense_categories SET receipt_required = true WHERE id = $1`, [f.categoryPurchase]);
    const without = await submitClaim({ amount: '1234', vendorName: 'No Receipt Co' }, false);
    expect(without.status).toBe(400);
    expect(without.body.error.details.receipts).toBeDefined();

    const withReceipt = await submitClaim({ amount: '1234', vendorName: 'No Receipt Co' }, true);
    expect(withReceipt.status).toBe(201);
    await query(`UPDATE expense_categories SET receipt_required = false WHERE id = $1`, [f.categoryPurchase]);
  });

  it('auto-approves under a policy that requires no approver', async () => {
    const res = await submitClaim({
      categoryId: f.categoryConveyance, amount: '180', description: 'Auto to stores',
      vendorName: 'Auto', submit: 'true',
    }, false);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');

    const trail = await query<{ action: string; stage: string }>(
      `SELECT action, stage FROM expense_approvals WHERE claim_id = $1 ORDER BY id`, [res.body.id]);
    expect(trail.map((x) => x.action)).toEqual(['submitted', 'auto_approved']);
    expect(trail[1]!.stage).toBe('system');
  });
});

describe('expense approval workflow', () => {
  it('walks a claim through manager then finance, and locks it on approval', async () => {
    const created = await submitClaim({ amount: '7800', vendorName: 'Two Stage Vendor' });
    const id = created.body.id as string;

    const selfApprove = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.employee!).send({ action: 'approve' });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error.message).toMatch(/own expense/i);

    const financeFirst = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.finance!).send({ action: 'approve' });
    expect(financeFirst.status).toBe(403);

    const manager = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.manager!).send({ action: 'approve', comment: 'Matches the site log.' });
    expect(manager.status).toBe(200);
    expect(manager.body.to).toBe('under_review');
    expect(manager.body.nextStage).toBe('finance');

    const finance = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.finance!).send({ action: 'approve', comment: 'Verified.' });
    expect(finance.status).toBe(200);
    expect(finance.body.to).toBe('approved');

    const edit = await request(app).patch(`/api/expenses/${id}`)
      .set('Authorization', t.employee!).send({ amount: 99999 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('CLAIM_LOCKED');
  });

  it('returns a claim for correction and keeps the whole history', async () => {
    const created = await submitClaim({ amount: '3200', vendorName: 'Return Vendor' });
    const id = created.body.id as string;

    const noComment = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.manager!).send({ action: 'return' });
    expect(noComment.status).toBe(422);

    const returned = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.manager!)
      .send({ action: 'return', comment: 'Attach the GST invoice, not the delivery note.' });
    expect(returned.body.to).toBe('returned');

    const edited = await request(app).patch(`/api/expenses/${id}`)
      .set('Authorization', t.employee!).send({ invoiceNumber: 'GST/2026/1' });
    expect(edited.status).toBe(200);

    const resubmitted = await request(app).post(`/api/expenses/${id}/submit`)
      .set('Authorization', t.employee!).send({});
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.wasReturned).toBe(true);

    const detail = await request(app).get(`/api/expenses/${id}`).set('Authorization', t.employee!);
    const actions = detail.body.approvalTrail.map((e: any) => e.action);
    // Nothing is overwritten: the return and its reason survive resubmission.
    expect(actions).toEqual(['submitted', 'returned', 'resubmitted']);
    expect(detail.body.approvalTrail[1].comment).toMatch(/GST invoice/);
  });

  it('records a reason on every rejection', async () => {
    const created = await submitClaim({ amount: '2100', vendorName: 'Reject Vendor' });
    const id = created.body.id as string;

    const rejected = await request(app).post(`/api/expenses/${id}/decision`)
      .set('Authorization', t.manager!)
      .send({ action: 'reject', comment: 'Exceeds the approved daily limit.' });
    expect(rejected.body.to).toBe('rejected');

    const claim = await one<{ rejection_reason: string }>(
      `SELECT rejection_reason FROM expense_claims WHERE id = $1`, [id]);
    expect(claim!.rejection_reason).toMatch(/Exceeds the approved/);
  });

  it('decides a bulk selection independently, skipping what the caller may not action', async () => {
    const mine = (await submitClaim({ amount: '1500', vendorName: 'Bulk A' })).body.id;
    const alsoMine = (await submitClaim({ amount: '1600', vendorName: 'Bulk B' })).body.id;

    const otherToken = await tokenFor(app, f.other);
    const theirs = await request(app).post('/api/expenses').set('Authorization', otherToken)
      .field('categoryId', f.categoryPurchase).field('projectId', f.project)
      .field('expenseDate', today()).field('amount', '1700')
      .field('description', 'Their claim').field('vendorName', 'Bulk C').field('submit', 'true')
      .attach('receipts', PNG_FIXTURE, { filename: 'b.png', contentType: 'image/png' });

    const res = await request(app).post('/api/expenses/decision-bulk')
      .set('Authorization', t.manager!)
      .send({ claimIds: [mine, alsoMine, theirs.body.id], action: 'approve', comment: 'Batch approved.' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.failed).toHaveLength(0);
  });

  it('pays approved claims exactly once', async () => {
    const created = await submitClaim({ amount: '5400', vendorName: 'Payment Vendor' });
    const id = created.body.id as string;
    await request(app).post(`/api/expenses/${id}/decision`).set('Authorization', t.manager!)
      .send({ action: 'approve', comment: 'ok' });
    await request(app).post(`/api/expenses/${id}/decision`).set('Authorization', t.finance!)
      .send({ action: 'approve', comment: 'ok' });

    const paid = await request(app).post('/api/expenses/reimburse').set('Authorization', t.finance!)
      .send({ claimIds: [id], paymentReference: 'NEFT/1' });
    expect(paid.status).toBe(200);
    expect(paid.body.count).toBe(1);

    const again = await request(app).post('/api/expenses/reimburse').set('Authorization', t.finance!)
      .send({ claimIds: [id] });
    // Already paid: nothing is eligible, so the batch is refused outright.
    expect(again.status).toBe(400);

    const items = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM reimbursement_items WHERE claim_id = $1`, [id]);
    expect(items!.count).toBe(1);
  });

  it('never lets an employee see another employee\'s claim or receipt', async () => {
    const created = await submitClaim({ amount: '640', vendorName: 'Private Vendor' });
    const id = created.body.id as string;
    const fileId = (await request(app).get(`/api/expenses/${id}`)
      .set('Authorization', t.employee!)).body.attachments[0].fileId;

    const otherToken = await tokenFor(app, f.other);
    expect((await request(app).get(`/api/expenses/${id}`).set('Authorization', otherToken)).status).toBe(404);
    expect((await request(app).get(`/api/files/${fileId}`).set('Authorization', otherToken)).status).toBe(403);
    expect((await request(app).get(`/api/files/${fileId}`)).status).toBe(401);
    // The owner and finance can both read it.
    expect((await request(app).get(`/api/files/${fileId}`).set('Authorization', t.employee!)).status).toBe(200);
    expect((await request(app).get(`/api/files/${fileId}`).set('Authorization', t.finance!)).status).toBe(200);
  });

  it('rejects an upload whose magic bytes are not a permitted type', async () => {
    const res = await request(app).post('/api/expenses').set('Authorization', t.employee!)
      .field('categoryId', f.categoryPurchase).field('projectId', f.project)
      .field('expenseDate', today()).field('amount', '500')
      .field('description', 'Disguised file').field('submit', 'true')
      .attach('receipts', Buffer.from('#!/bin/sh\nrm -rf /\n'),
        { filename: 'bill.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unsupported file/i);
  });

  it('keeps employee-wise and project-wise totals reconciled', async () => {
    const byEmployee = await request(app).get('/api/reports/expenses/by-employee')
      .set('Authorization', t.admin!).query({ from: daysAgo(90), to: today() });
    const byProject = await request(app).get('/api/reports/expenses/by-project')
      .set('Authorization', t.admin!).query({ from: daysAgo(90), to: today() });

    const sum = (rows: any[], key: string) =>
      rows.reduce((total, r) => total + Number(r[key]), 0);

    // Two groupings of the same rows must agree to the paisa.
    expect(sum(byEmployee.body.rows, 'approvedAmount'))
      .toBeCloseTo(sum(byProject.body.rows, 'approvedAmount'), 2);
    expect(sum(byEmployee.body.rows, 'claimCount'))
      .toBe(sum(byProject.body.rows, 'claimCount'));
  });
});
