#!/usr/bin/env node
/**
 * ADISYS FieldOps — demonstration dataset.
 *
 * Produces a coherent three-week operating history: people, projects,
 * assigned work, acknowledgements, recorded and verified time, and
 * expense claims at every stage of the approval workflow. Dates are
 * anchored to "today" so the dashboard is always populated.
 */
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { receiptPdf } from './lib/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_ROOT = path.resolve(here, '../../../storage');
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Adisys@2026';

// ---------------------------------------------------------------------
// Deterministic pseudo-randomness: reseeding produces the same dataset.
// ---------------------------------------------------------------------
let _s = 0x9e3779b9;
const rnd = () => { _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p) => rnd() < p;

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
// Monday of the week containing `d`
const weekStart = (d) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); };
const THIS_MONDAY = weekStart(TODAY);
const isWeekend = (d) => d.getDay() === 0;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
const q = (sql, params = []) => db.query(sql, params);
const val = async (sql, params = []) => (await q(sql, params)).rows[0];

const log = (msg) => console.log(`  ${msg}`);

try {
  await q('BEGIN');

  // -------------------------------------------------------------------
  log('Clearing existing data …');
  await q(`TRUNCATE
    reimbursement_items, reimbursement_batches, expense_approvals, expense_attachments,
    expense_claims, expense_policies, expense_categories,
    work_assignment_attachments, work_assignment_events, assignment_acknowledgements,
    time_entries, attendance_sessions, work_assignments, project_members, projects,
    project_types, work_types, notification_outbox, notifications, notification_preferences,
    push_devices, audit_logs, settings, code_counters, files, password_reset_tokens,
    login_attempts, auth_sessions, user_permission_overrides, users, departments,
    designations, work_locations, role_permissions, permissions, roles, app_enum
    RESTART IDENTITY CASCADE`);

  // -------------------------------------------------------------------
  log('Roles and permissions …');
  // The permission catalogue and role matrix live in packages/shared and are
  // parsed from that single source of truth, so the database can never drift
  // from what the API and the two clients enforce.
  const { readFileSync } = await import('node:fs');
  const sharedSrc = readFileSync(path.resolve(here, '../../../packages/shared/src/permissions.ts'), 'utf8');

  const permissionCatalogue = [...sharedSrc.matchAll(
    /^\s*'([\w.]+)':\s*\{\s*module:\s*'(\w+)',\s*description:\s*'(.+?)'\s*\}/gm)]
    .map((m) => ({ key: m[1], module: m[2], description: m[3] }));
  if (permissionCatalogue.length < 20) throw new Error('Could not parse the shared permission catalogue.');

  for (const p of permissionCatalogue) {
    await q(`INSERT INTO permissions (key, module, description) VALUES ($1,$2,$3)`,
      [p.key, p.module, p.description]);
  }
  log(`    ${permissionCatalogue.length} permissions`);

  const roleDefs = [
    ['super_admin',     'Super Admin',                  'Unrestricted access to every module and setting.'],
    ['ops_manager',     'Operations / Project Manager', 'Runs projects, assigns work, reviews completion and approves expenses at the manager stage.'],
    ['finance_manager', 'Finance / Accounts Manager',   'Reviews and settles expense claims; organisation-wide financial reporting.'],
    ['employee',        'Employee / Field Staff',       'Receives and acknowledges work, records time, submits expense claims.'],
  ];
  const roleIds = {};
  for (const [key, name, description] of roleDefs) {
    const r = await val(`INSERT INTO roles (key, name, description, is_system)
                         VALUES ($1,$2,$3,true) RETURNING id`, [key, name, description]);
    roleIds[key] = r.id;
  }

  // Role → permission matrix, read from the same shared module.
  const listFor = (name) => {
    const m = sharedSrc.match(new RegExp(`const ${name}: PermissionKey\\[\\] = \\[([\\s\\S]*?)\\];`));
    return m ? [...m[1].matchAll(/'([\w.]+)'/g)].map((x) => x[1]) : [];
  };
  const matrix = {
    super_admin: permissionCatalogue.map((p) => p.key),
    ops_manager: listFor('OPS_MANAGER'),
    finance_manager: listFor('FINANCE_MANAGER'),
    employee: listFor('EMPLOYEE'),
  };
  for (const [roleKey, keys] of Object.entries(matrix)) {
    for (const k of keys) {
      await q(`INSERT INTO role_permissions (role_id, permission_id)
               SELECT $1, id FROM permissions WHERE key = $2
               ON CONFLICT DO NOTHING`, [roleIds[roleKey], k]);
    }
    log(`    ${roleKey}: ${keys.length} permissions`);
  }

  // -------------------------------------------------------------------
  log('Organisation structure …');
  const deptDefs = [
    ['FLD', 'Field Operations'], ['ENG', 'Engineering'], ['PRJ', 'Project Delivery'],
    ['FIN', 'Finance & Accounts'], ['QHS', 'Quality & Safety'],
  ];
  const deptIds = {};
  for (const [code, name] of deptDefs) {
    deptIds[code] = (await val(`INSERT INTO departments (code, name) VALUES ($1,$2) RETURNING id`, [code, name])).id;
  }

  const desigDefs = [
    ['Field Engineer', 'E1'], ['Senior Field Engineer', 'E2'], ['Site Supervisor', 'E3'],
    ['Project Manager', 'M1'], ['Operations Manager', 'M2'],
    ['Accounts Executive', 'F1'], ['Finance Manager', 'F2'], ['System Administrator', 'A1'],
  ];
  const desigIds = {};
  for (const [name, grade] of desigDefs) {
    desigIds[name] = (await val(`INSERT INTO designations (name, grade) VALUES ($1,$2) RETURNING id`, [name, grade])).id;
  }

  const locDefs = [
    ['HYD', 'Hyderabad — Head Office', 'Plot 44, HITEC City', 'Hyderabad', 'Telangana', 17.447, 78.377],
    ['BLR', 'Bengaluru Office',        'Whitefield Main Road', 'Bengaluru', 'Karnataka', 12.970, 77.750],
    ['CHN', 'Chennai Site Office',     'Ambattur Industrial Estate', 'Chennai', 'Tamil Nadu', 13.098, 80.162],
    ['PUN', 'Pune Site Office',        'Hinjawadi Phase II', 'Pune', 'Maharashtra', 18.591, 73.738],
    ['VZG', 'Visakhapatnam Plant',     'Auto Nagar', 'Visakhapatnam', 'Andhra Pradesh', 17.728, 83.239],
  ];
  const locIds = {};
  for (const [code, name, addr, city, state, lat, lng] of locDefs) {
    locIds[code] = (await val(
      `INSERT INTO work_locations (code, name, address_line, city, state, latitude, longitude, geofence_radius_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,250) RETURNING id`, [code, name, addr, city, state, lat, lng])).id;
  }

  // -------------------------------------------------------------------
  log('People …');
  const pwHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const users = [];
  // Codes come from next_code(), the same allocator the API uses, so employees
  // created through the portal continue the sequence instead of colliding
  // with the seeded ones.
  const nextEmpCode = async () => (await val(`SELECT next_code('employee','ADI') AS c`)).c;

  const addUser = async (u) => {
    const code = await nextEmpCode();
    const row = await val(
      `INSERT INTO users (employee_code, full_name, email, phone, password_hash, must_change_password,
                          role_id, department_id, designation_id, base_location_id, reporting_manager_id,
                          date_of_joining, status, location_consent_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [code, u.name, u.email, u.phone, pwHash, roleIds[u.role], deptIds[u.dept], desigIds[u.desig],
       locIds[u.loc], u.managerId ?? null, u.joined, u.status ?? 'active',
       u.role === 'employee' ? addDays(TODAY, -60) : null,
       u.status === 'invited' ? null : addDays(TODAY, -int(0, 2))]);
    const rec = { id: row.id, code, ...u };
    users.push(rec);
    return rec;
  };

  const admin = await addUser({
    name: 'Anitha Reddy', email: 'admin@adisystech.com', phone: '9100000001',
    role: 'super_admin', dept: 'ENG', desig: 'System Administrator', loc: 'HYD', joined: '2019-04-01',
  });
  const ops1 = await addUser({
    name: 'Suresh Menon', email: 'suresh.menon@adisystech.com', phone: '9100000002',
    role: 'ops_manager', dept: 'PRJ', desig: 'Operations Manager', loc: 'HYD',
    managerId: admin.id, joined: '2020-06-15',
  });
  const ops2 = await addUser({
    name: 'Deepa Iyer', email: 'deepa.iyer@adisystech.com', phone: '9100000003',
    role: 'ops_manager', dept: 'PRJ', desig: 'Project Manager', loc: 'BLR',
    managerId: admin.id, joined: '2021-02-08',
  });
  const finance = await addUser({
    name: 'Kavitha Rao', email: 'kavitha.rao@adisystech.com', phone: '9100000004',
    role: 'finance_manager', dept: 'FIN', desig: 'Finance Manager', loc: 'HYD',
    managerId: admin.id, joined: '2020-01-20',
  });

  const fieldStaff = [
    ['Arun Prakash',     'arun.prakash',     'Senior Field Engineer', 'FLD', 'HYD', ops1.id, '2021-07-12'],
    ['Nikhil Sharma',    'nikhil.sharma',    'Field Engineer',        'FLD', 'HYD', ops1.id, '2022-03-01'],
    ['Priya Venkatesan', 'priya.venkatesan', 'Site Supervisor',       'FLD', 'CHN', ops1.id, '2021-11-09'],
    ['Imran Qureshi',    'imran.qureshi',    'Field Engineer',        'FLD', 'CHN', ops1.id, '2023-01-16'],
    ['Sandeep Naik',     'sandeep.naik',     'Senior Field Engineer', 'ENG', 'BLR', ops2.id, '2020-09-21'],
    ['Meera Joshi',      'meera.joshi',      'Field Engineer',        'ENG', 'BLR', ops2.id, '2022-08-08'],
    ['Rahul Deshmukh',   'rahul.deshmukh',   'Field Engineer',        'FLD', 'PUN', ops2.id, '2023-04-03'],
    ['Lakshmi Narayan',  'lakshmi.narayan',  'Site Supervisor',       'QHS', 'VZG', ops1.id, '2021-05-17'],
    ['Vikram Chauhan',   'vikram.chauhan',   'Field Engineer',        'FLD', 'VZG', ops1.id, '2024-02-19'],
    ['Farhan Ali',       'farhan.ali',       'Field Engineer',        'ENG', 'PUN', ops2.id, '2024-06-10'],
  ];
  const staff = [];
  for (const [name, handle, desig, dept, loc, managerId, joined] of fieldStaff) {
    staff.push(await addUser({
      name, email: `${handle}@adisystech.com`, phone: `91${String(10000005 + staff.length).padStart(8, '0')}`,
      role: 'employee', dept, desig, loc, managerId, joined,
    }));
  }
  // One invited employee who has not signed in yet — exercises the empty/invited state.
  const invited = await addUser({
    name: 'Sneha Kulkarni', email: 'sneha.kulkarni@adisystech.com', phone: '9100000015',
    role: 'employee', dept: 'FLD', desig: 'Field Engineer', loc: 'BLR',
    managerId: ops2.id, joined: iso(addDays(TODAY, -3)), status: 'invited',
  });

  await q(`UPDATE departments SET head_user_id = $1 WHERE code = ANY($2)`, [ops1.id, ['FLD', 'PRJ', 'QHS']]);
  await q(`UPDATE departments SET head_user_id = $1 WHERE code = $2`, [finance.id, 'FIN']);
  await q(`UPDATE departments SET head_user_id = $1 WHERE code = $2`, [admin.id, 'ENG']);
  log(`    ${users.length} users (password for all: ${DEFAULT_PASSWORD})`);

  // -------------------------------------------------------------------
  log('Projects …');
  const projTypes = ['Installation & Commissioning', 'Preventive Maintenance', 'Site Survey',
                     'Annual Maintenance Contract', 'Retrofit & Upgrade', 'Compliance Audit'];
  const projTypeIds = {};
  for (const name of projTypes) {
    projTypeIds[name] = (await val(`INSERT INTO project_types (name) VALUES ($1) RETURNING id`, [name])).id;
  }

  const workTypeNames = ['Site Visit', 'Installation', 'Inspection', 'Preventive Maintenance',
                         'Testing & Commissioning', 'Documentation', 'Client Meeting', 'Material Pickup'];
  const workTypeIds = {};
  for (const name of workTypeNames) {
    workTypeIds[name] = (await val(`INSERT INTO work_types (name) VALUES ($1) RETURNING id`, [name])).id;
  }

  const projectDefs = [
    { name: 'Metro Rail Signalling Retrofit', client: 'Hyderabad Metro Rail Ltd', loc: 'Miyapur Depot, Hyderabad',
      type: 'Retrofit & Upgrade', manager: ops1, status: 'active', priority: 'critical',
      budget: 4_800_000, start: -74, end: 46, members: [0, 1, 7, 8] },
    { name: 'Chennai Plant IoT Rollout', client: 'Sundaram Industries', loc: 'Ambattur, Chennai',
      type: 'Installation & Commissioning', manager: ops1, status: 'active', priority: 'high',
      budget: 2_650_000, start: -52, end: 24, members: [2, 3, 0] },
    { name: 'Bengaluru Campus AMC 2026', client: 'Nexora Technology Park', loc: 'Whitefield, Bengaluru',
      type: 'Annual Maintenance Contract', manager: ops2, status: 'active', priority: 'medium',
      budget: 1_950_000, start: -110, end: 240, members: [4, 5, 9] },
    { name: 'Pune Substation Survey', client: 'Maharashtra State Power', loc: 'Hinjawadi, Pune',
      type: 'Site Survey', manager: ops2, status: 'active', priority: 'high',
      budget: 720_000, start: -21, end: 18, members: [6, 9, 4] },
    { name: 'Vizag Refinery Safety Audit', client: 'Coastal Petrochem', loc: 'Auto Nagar, Visakhapatnam',
      type: 'Compliance Audit', manager: ops1, status: 'on_hold', priority: 'medium',
      budget: 880_000, start: -40, end: 30, members: [7, 8] },
    { name: 'Kochi Terminal Commissioning', client: 'Southern Ports Authority', loc: 'Willingdon Island, Kochi',
      type: 'Installation & Commissioning', manager: ops2, status: 'completed', priority: 'high',
      budget: 3_100_000, start: -180, end: -26, actualEnd: -30, members: [4, 5, 1] },
    { name: 'Warangal Feeder Upgrade', client: 'TS Transco', loc: 'Warangal, Telangana',
      type: 'Retrofit & Upgrade', manager: ops1, status: 'draft', priority: 'low',
      budget: null, start: 10, end: 90, members: [] },
  ];

  const projects = [];
  for (const d of projectDefs) {
    const code = (await val(`SELECT next_code('project','PRJ') AS c`)).c;
    const row = await val(
      `INSERT INTO projects (project_code, name, description, client_name, client_location, project_type_id,
                             manager_id, start_date, expected_end_date, actual_end_date, status, priority,
                             budget_amount, budget_enabled, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [code, d.name,
       `${d.type} engagement for ${d.client}. Scope covers site readiness, execution, testing and hand-over documentation.`,
       d.client, d.loc, projTypeIds[d.type], d.manager.id,
       iso(addDays(TODAY, d.start)), iso(addDays(TODAY, d.end)),
       d.actualEnd !== undefined ? iso(addDays(TODAY, d.actualEnd)) : null,
       d.status, d.priority, d.budget, d.budget !== null,
       'Client escalation contact confirmed. Site access passes issued to all assigned staff.', admin.id]);

    const project = { id: row.id, code, ...d, members: d.members.map((i) => staff[i]) };
    projects.push(project);

    for (const m of project.members) {
      await q(`INSERT INTO project_members (project_id, user_id, role_in_project, allocation_pct, assigned_by, assigned_at)
               VALUES ($1,$2,$3,$4,$5,$6)`,
        [project.id, m.id, m.desig === 'Site Supervisor' ? 'supervisor' : (m === project.members[0] ? 'lead' : 'member'),
         int(40, 100), d.manager.id, addDays(TODAY, d.start)]);
    }
  }
  log(`    ${projects.length} projects, ${projectDefs.reduce((a, p) => a + p.members.length, 0)} memberships`);

  // -------------------------------------------------------------------
  log('Work assignments, acknowledgements and time …');
  const taskTemplates = [
    ['Site readiness inspection', 'Inspection', 'Verify panel earthing, cable routing and mounting clearances against the approved drawing set. Photograph every deviation.'],
    ['Install field sensor array', 'Installation', 'Mount and wire the sensor array on lines 3 and 4. Torque all glands to spec and update the loop register.'],
    ['Commissioning dry run', 'Testing & Commissioning', 'Execute the commissioning checklist end to end with the client engineer present. Log all trip values.'],
    ['Preventive maintenance round', 'Preventive Maintenance', 'Quarterly PM on the control cabinets: clean filters, check terminations, record insulation resistance.'],
    ['Client progress review', 'Client Meeting', 'Walk the client through the weekly progress dashboard and confirm next week’s site access windows.'],
    ['As-built documentation update', 'Documentation', 'Update the as-built drawings and upload the signed measurement sheet to the project folder.'],
    ['Collect material from stores', 'Material Pickup', 'Collect the cable drums and junction boxes against indent, verify quantities and photograph the gate pass.'],
    ['Survey feeder route', 'Site Visit', 'Walk the proposed feeder route, mark obstructions on the site plan and capture GPS points at each pole location.'],
    ['Thermal imaging scan', 'Inspection', 'Thermal scan of all LT panels under load. Flag any joint above 65 °C for immediate attention.'],
    ['Safety compliance walkthrough', 'Inspection', 'Confirm PPE compliance, barricading and permit-to-work records at every active work front.'],
  ];

  const assignments = [];
  const activeProjects = projects.filter((p) => ['active', 'on_hold'].includes(p.status) && p.members.length);

  // Three weeks of history + the current week + next week's plan.
  for (let dayOffset = -18; dayOffset <= 11; dayOffset++) {
    const date = addDays(TODAY, dayOffset);
    if (isWeekend(date)) continue;

    for (const project of activeProjects) {
      const perDay = project.status === 'on_hold' ? (chance(0.25) ? 1 : 0) : int(1, 3);
      for (let i = 0; i < perDay; i++) {
        const assignee = pick(project.members);
        const [title, workType, description] = pick(taskTemplates);
        const dueOffset = chance(0.75) ? 0 : int(1, 3);
        const estimated = pick([1.5, 2, 3, 4, 4.5, 6, 8]);
        const code = (await val(`SELECT next_code('assignment','WRK') AS c`)).c;

        // Status is derived from where the day sits relative to today.
        let status = 'assigned';
        let progress = 0;
        if (dayOffset < -1) {
          status = chance(0.86) ? 'completed' : pick(['clarification_requested', 'in_progress', 'cancelled']);
        } else if (dayOffset === -1) {
          status = pick(['completed', 'completed', 'submitted', 'in_progress']);
        } else if (dayOffset === 0) {
          status = pick(['assigned', 'acknowledged', 'in_progress', 'in_progress', 'submitted', 'completed']);
        } else {
          status = chance(0.55) ? 'acknowledged' : 'assigned';
        }
        if (status === 'completed') progress = 100;
        else if (status === 'submitted') progress = 100;
        else if (status === 'in_progress') progress = pick([20, 35, 50, 65, 80]);

        const row = await val(
          `INSERT INTO work_assignments
             (assignment_code, project_id, assignee_id, title, description, work_type_id, priority,
              assignment_date, due_date, planned_start_at, planned_end_at, estimated_hours,
              location_id, location_text, instructions, status, progress_pct, assigned_by,
              submitted_at, completed_at, reviewed_by, reviewed_at, completion_notes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING id`,
          [code, project.id, assignee.id, title, description, workTypeIds[workType],
           pick(['low', 'medium', 'medium', 'high', 'high', 'critical']),
           iso(date), iso(addDays(date, dueOffset)),
           at(date, int(8, 10), pick([0, 30])), at(date, int(14, 18), pick([0, 30])), estimated,
           locIds[pick(['HYD', 'BLR', 'CHN', 'PUN', 'VZG'])], project.loc,
           'Carry the site access pass and the latest approved drawing revision. Report blockers to the project manager the same day.',
           status, progress, project.manager.id,
           ['submitted', 'completed'].includes(status) ? at(date, 17, 30) : null,
           status === 'completed' ? at(date, 18, 0) : null,
           status === 'completed' ? project.manager.id : null,
           status === 'completed' ? at(addDays(date, 1), 10, 0) : null,
           status === 'completed'
             ? pick(['Completed as planned; client representative signed the job card.',
                     'Work closed out. Photographs and measurement sheet uploaded.',
                     'Completed with one minor deviation, noted in the site register.'])
             : null,
           at(addDays(date, -1), 18, 0)]);

        const a = { id: row.id, code, projectId: project.id, project, assigneeId: assignee.id,
                    assignee, date, status, estimated, dueOffset };
        assignments.push(a);

        await q(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, to_status, note, created_at)
                 VALUES ($1,$2,'created',$3,'Assignment issued to the employee.',$4)`,
          [a.id, project.manager.id, 'assigned', at(addDays(date, -1), 18, 0)]);

        // ----- Acknowledgement -----
        const acknowledged = status !== 'assigned' && status !== 'cancelled';
        if (acknowledged) {
          const ackAt = at(date, int(7, 9), int(0, 59));
          await q(`INSERT INTO assignment_acknowledgements
                     (assignment_id, user_id, assignment_version, decision, mode, device_label, acknowledged_at)
                   VALUES ($1,$2,1,'acknowledged',$3,'Android · Employee app',$4)`,
            [a.id, assignee.id, pick(['individual', 'individual', 'bulk_daily', 'bulk_weekly']), ackAt]);
          await q(`INSERT INTO work_assignment_events (assignment_id, actor_id, event_type, from_status, to_status, note, created_at)
                   VALUES ($1,$2,'status_changed','assigned','acknowledged','Employee acknowledged receipt of the assignment.',$3)`,
            [a.id, assignee.id, ackAt]);
        } else if (status === 'clarification_requested') {
          await q(`INSERT INTO assignment_acknowledgements
                     (assignment_id, user_id, assignment_version, decision, mode, reason, acknowledged_at)
                   VALUES ($1,$2,1,'clarification_requested','individual',$3,$4)`,
            [a.id, assignee.id, 'Drawing revision referenced in the instructions is not available on site.', at(date, 9, 15)]);
        }

        // ----- Recorded time (only for work that actually started) -----
        if (['in_progress', 'submitted', 'completed'].includes(status)) {
          const segments = int(1, 2);
          let cursor = at(date, int(9, 10), pick([0, 15, 30]));
          for (let s = 0; s < segments; s++) {
            const minutes = Math.round((estimated * 60) / segments * (0.7 + rnd() * 0.6));
            const end = new Date(cursor.getTime() + minutes * 60_000);
            // Older entries have been reviewed; recent ones are still unverified.
            const verified = dayOffset < -2 ? (chance(0.88) ? 'verified' : 'rejected') : 'unverified';
            await q(
              `INSERT INTO time_entries (user_id, assignment_id, project_id, work_date, started_at, ended_at,
                                         source, notes, verification_status, verified_by, verified_at, verification_note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [assignee.id, a.id, project.id, iso(date), cursor, end,
               chance(0.75) ? 'timer' : 'manual',
               pick(['Panel side work completed.', 'Waiting on client permit for 40 minutes, excluded.',
                     'Cable pulling and dressing.', 'Testing with client engineer present.']),
               verified,
               verified === 'unverified' ? null : project.manager.id,
               verified === 'unverified' ? null : at(addDays(date, 1), 11, 0),
               verified === 'rejected' ? 'Overlaps a second entry logged for the same hour; discounted from productive time.' : null]);
            cursor = new Date(end.getTime() + int(20, 90) * 60_000);
          }
        }
      }
    }
  }
  log(`    ${assignments.length} assignments`);

  // ----- Attendance (availability on duty — deliberately separate from productive time)
  let attendanceCount = 0;
  for (let dayOffset = -18; dayOffset <= 0; dayOffset++) {
    const date = addDays(TODAY, dayOffset);
    if (isWeekend(date)) continue;
    for (const s of staff) {
      if (chance(0.08)) continue;                       // leave / no field duty
      const inAt = at(date, 8, int(30, 59));
      const open = dayOffset === 0 && chance(0.6);      // still on duty right now
      await q(
        `INSERT INTO attendance_sessions (user_id, work_date, check_in_at, check_out_at,
                                          check_in_latitude, check_in_longitude, location_accuracy_m,
                                          location_consented, location_id, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,'android')`,
        [s.id, iso(date), inAt, open ? null : at(date, int(17, 19), int(0, 59)),
         (17 + rnd()).toFixed(6), (78 + rnd()).toFixed(6), (rnd() * 18 + 4).toFixed(2), locIds[s.loc]]);
      attendanceCount++;
    }
  }
  log(`    ${attendanceCount} attendance sessions`);

  // -------------------------------------------------------------------
  log('Expense categories and policies …');
  const catDefs = [
    { key: 'purchase_bills',   name: 'Purchase Bills',        icon: 'receipt',   variant: 'purchase', receipt: true,  max: 50000, daily: null,
      children: [['purchase_tools', 'Tools & Instruments'], ['purchase_spares', 'Spares & Components'], ['purchase_office', 'Office Supplies']] },
    { key: 'fuel',             name: 'Petrol / Fuel Allowance', icon: 'fuel',    variant: 'fuel',     receipt: true,  max: 6000,  daily: 3000,
      children: [['fuel_two_wheeler', 'Two Wheeler'], ['fuel_four_wheeler', 'Four Wheeler'], ['fuel_company_vehicle', 'Company Vehicle']] },
    { key: 'food',             name: 'Food Allowance',        icon: 'utensils',  variant: 'food',     receipt: true,  max: 1200,  daily: 600,
      children: [] },
    { key: 'travel',           name: 'Travel Expenses',       icon: 'train',     variant: 'standard', receipt: true,  max: 25000, daily: null,
      children: [['travel_rail', 'Rail'], ['travel_air', 'Air'], ['travel_bus', 'Bus'], ['travel_intercity_taxi', 'Inter-city Taxi']] },
    { key: 'accommodation',    name: 'Accommodation',         icon: 'bed',       variant: 'standard', receipt: true,  max: 8000,  daily: 4000,
      children: [] },
    { key: 'local_conveyance', name: 'Local Conveyance',      icon: 'car',       variant: 'standard', receipt: false, max: 1500,  daily: 800,
      children: [['conveyance_auto', 'Auto / Rickshaw'], ['conveyance_cab', 'App Cab'], ['conveyance_bus', 'Public Transport']] },
    { key: 'materials',        name: 'Materials & Consumables', icon: 'package', variant: 'purchase', receipt: true,  max: 75000, daily: null,
      children: [['materials_cable', 'Cable & Wiring'], ['materials_consumables', 'Site Consumables']] },
    { key: 'other',            name: 'Other Approved Expenses', icon: 'more',    variant: 'standard', receipt: true,  max: 10000, daily: null,
      children: [] },
  ];

  const cats = {};
  let sort = 0;
  for (const c of catDefs) {
    const row = await val(
      `INSERT INTO expense_categories (key, name, icon, form_variant, receipt_required, project_required,
                                       max_amount_per_claim, daily_limit, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [c.key, c.name, c.icon, c.variant, c.receipt, c.key !== 'other', c.max, c.daily, sort += 10]);
    cats[c.key] = { id: row.id, ...c, childIds: {} };
    let childSort = 0;
    for (const [ckey, cname] of c.children) {
      const cr = await val(
        `INSERT INTO expense_categories (parent_id, key, name, form_variant, receipt_required, project_required, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [row.id, ckey, cname, c.variant, c.receipt, c.key !== 'other', childSort += 10]);
      cats[c.key].childIds[ckey] = cr.id;
    }
  }

  const policyDefs = [
    ['Small local conveyance — auto cleared', 'local_conveyance', 0,     250,   false, false, 250,   200],
    ['Local conveyance — manager only',       'local_conveyance', 250.01, 1500, true,  false, null,  190],
    ['Food allowance — manager only',         'food',             0,     600,   true,  false, null,  180],
    ['Fuel claims — manager then finance',    'fuel',             0,     null,  true,  true,  null,  170],
    ['Standard claim — manager then finance', null,               0,     15000, true,  true,  null,  100],
    ['High value claim — full review',        null,               15000.01, null, true, true,  null,  110],
  ];
  for (const [name, catKey, min, max, mgr, fin, auto, priority] of policyDefs) {
    await q(
      `INSERT INTO expense_policies (name, category_id, min_amount, max_amount, requires_manager,
                                     requires_finance, auto_approve_below, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, catKey ? cats[catKey].id : null, min, max, mgr, fin, auto, priority, admin.id]);
  }
  log(`    ${catDefs.length} categories, ${policyDefs.length} approval policies`);

  // -------------------------------------------------------------------
  log('Expense claims, receipts and approval trails …');
  const vendors = {
    fuel: ['Bharat Petroleum', 'Indian Oil — Highway Outlet', 'HP Petrol Pump', 'Shell Select'],
    food: ['Sri Krishna Bhavan', 'Cafe Coffee Day', 'Annapurna Mess', 'Hotel Dwaraka'],
    purchase_bills: ['Balaji Electricals', 'Sri Sai Hardware', 'Precision Tools Pvt Ltd', 'Metro Cash & Carry'],
    materials: ['Polycab Distributors', 'Havells Authorised Dealer', 'Finolex Cables Depot'],
    travel: ['IRCTC', 'APSRTC', 'IndiGo Airlines', 'TSRTC'],
    accommodation: ['Hotel Aditya Residency', 'Ginger Hotels', 'Treebo Trend'],
    local_conveyance: ['Ola Cabs', 'Uber India', 'Auto — cash receipt'],
    other: ['Site permit office', 'Courier — Blue Dart'],
  };
  const amountRange = {
    fuel: [800, 3200], food: [120, 560], purchase_bills: [1200, 18000], materials: [3000, 42000],
    travel: [450, 9500], accommodation: [1800, 5200], local_conveyance: [60, 780], other: [200, 3500],
  };

  const claimStatuses = [
    ['paid', 10], ['approved', 9], ['reimbursement_pending', 5], ['submitted', 8],
    ['under_review', 4], ['returned', 3], ['rejected', 3], ['draft', 3],
  ];
  const statusPool = claimStatuses.flatMap(([s, n]) => Array(n).fill(s));

  const storeSeedFile = async (buffer, name, mime, uploadedBy, purpose) => {
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    const key = `${purpose}/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum.slice(4, 36)}.${ext}`;
    const abs = path.join(STORAGE_ROOT, key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buffer, { mode: 0o600 });
    const row = await val(
      `INSERT INTO files (storage_key, original_name, mime_type, size_bytes, checksum_sha256, uploaded_by, purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [key, name, mime, buffer.length, checksum, uploadedBy, purpose]);
    return row.id;
  };

  let claimCount = 0;
  const paidClaims = [];
  const year = String(TODAY.getFullYear());

  for (let i = 0; i < statusPool.length * 2; i++) {
    const status = statusPool[i % statusPool.length];
    const project = pick(activeProjects.concat(projects.filter((p) => p.status === 'completed' && p.members.length)));
    const employee = pick(project.members);
    const catKey = pick(['fuel', 'fuel', 'food', 'food', 'local_conveyance', 'purchase_bills',
                         'materials', 'travel', 'accommodation', 'other']);
    const cat = cats[catKey];
    const childKeys = Object.keys(cat.childIds);
    const subId = childKeys.length && chance(0.7) ? cat.childIds[pick(childKeys)] : null;

    const daysAgo = int(1, 55);
    const expenseDate = addDays(TODAY, -daysAgo);
    const [lo, hi] = amountRange[catKey];
    const amount = Number((lo + rnd() * (hi - lo)).toFixed(2));
    const vendor = pick(vendors[catKey]);
    const invoiceNo = `${vendor.slice(0, 3).toUpperCase()}/${year}/${int(10000, 99999)}`;

    const code = (await val(`SELECT next_code('expense','EXP',$1,4) AS c`, [year])).c;
    const submittedAt = status === 'draft' ? null : at(addDays(expenseDate, int(0, 2)), int(18, 21), int(0, 59));
    const decidedAt = ['approved', 'rejected', 'paid', 'reimbursement_pending'].includes(status)
      ? at(addDays(expenseDate, int(2, 6)), int(10, 17), int(0, 59)) : null;

    const fuelQty = catKey === 'fuel' ? Number((amount / int(98, 112)).toFixed(2)) : null;
    const duplicateHash = createHash('sha256')
      .update(`${employee.id}|${iso(expenseDate)}|${amount.toFixed(2)}|${vendor.toLowerCase()}`).digest('hex');

    const stage = ['submitted'].includes(status) ? 'manager'
      : status === 'under_review' ? pick(['manager', 'finance'])
      : status === 'returned' ? 'manager' : null;

    const claim = await val(
      `INSERT INTO expense_claims
        (expense_code, user_id, project_id, category_id, subcategory_id, expense_date, amount, description,
         vendor_name, invoice_number, expense_location, payment_method, notes, vehicle_number, fuel_type,
         fuel_quantity, travel_purpose, meal_type, status, current_stage, submitted_at, decided_at,
         rejection_reason, duplicate_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING id`,
      [code, employee.id, project.id, cat.id, subId, iso(expenseDate), amount,
       catKey === 'fuel' ? `Fuel for site travel to ${project.loc}`
         : catKey === 'food' ? `Meal during extended site duty at ${project.client}`
         : catKey === 'local_conveyance' ? `Local travel between site and stores`
         : `${cat.name} for ${project.name}`,
       vendor, invoiceNo, project.loc, pick(['cash', 'upi', 'card', 'upi']),
       chance(0.4) ? 'Approved verbally by the project manager on site.' : null,
       catKey === 'fuel' ? pick(['TS09 EA 4471', 'KA05 MH 2290', 'TN22 BC 8814', 'MH12 QR 3355']) : null,
       catKey === 'fuel' ? pick(['petrol', 'diesel']) : null,
       fuelQty,
       catKey === 'fuel' ? `Site visit — ${project.name}` : null,
       catKey === 'food' ? pick(['breakfast', 'lunch', 'dinner']) : null,
       status, stage, submittedAt, decidedAt,
       status === 'rejected'
         ? pick(['Receipt is illegible — resubmit with a clear photograph of the full bill.',
                 'Exceeds the approved daily limit for this category.',
                 'Duplicate of an earlier claim for the same journey.']) : null,
       duplicateHash, submittedAt ?? at(expenseDate, 20, 0)]);

    // Receipt — required for every category except small local conveyance.
    if (cat.receipt || chance(0.5)) {
      const pdf = receiptPdf({
        vendor, invoiceNo, date: iso(expenseDate), total: amount,
        lines: catKey === 'fuel'
          ? [`${cat.name}  ${fuelQty} L`, `Vehicle: site vehicle`, 'Mode: UPI']
          : [`${cat.name}`, `Description: ${project.name}`, `Place: ${project.loc}`],
        footer: 'GSTIN 36AABCB1234K1ZP   •   Computer generated receipt',
      });
      const fileId = await storeSeedFile(pdf, `${code}-receipt.pdf`, 'application/pdf', employee.id, 'receipt');
      await q(`INSERT INTO expense_attachments (claim_id, file_id, kind, ocr_status, ocr_payload, ocr_confirmed_by_user)
               VALUES ($1,$2,'receipt',$3,$4,$5)`,
        [claim.id, fileId, chance(0.5) ? 'completed' : 'not_run',
         chance(0.5) ? JSON.stringify({ vendor, invoiceNo, total: amount, date: iso(expenseDate), confidence: 0.82 }) : null,
         chance(0.5)]);
    }

    // Approval trail — append-only, mirrors what the workflow would write.
    const trail = [];
    if (submittedAt) trail.push(['employee', employee.id, 'submitted', 'draft', 'submitted', null, submittedAt]);
    if (status === 'returned') {
      trail.push(['manager', project.manager.id, 'returned', 'submitted', 'returned',
        'Please attach the full bill including the GST line and re-submit.', at(addDays(expenseDate, 2), 11, 0)]);
    }
    if (status === 'under_review') {
      trail.push([stage, stage === 'manager' ? project.manager.id : finance.id, 'reviewed',
        'submitted', 'under_review', 'Opened for review.', at(addDays(expenseDate, 2), 12, 0)]);
    }
    if (['approved', 'reimbursement_pending', 'paid'].includes(status)) {
      trail.push(['manager', project.manager.id, 'approved', 'submitted', 'under_review',
        'Verified against the site work log.', at(addDays(expenseDate, 2), 15, 0)]);
      trail.push(['finance', finance.id, 'approved', 'under_review', 'approved',
        'Receipt and amount verified.', decidedAt]);
    }
    if (status === 'rejected') {
      trail.push(['manager', project.manager.id, 'rejected', 'submitted', 'rejected',
        'Rejected — see the recorded reason.', decidedAt]);
    }
    if (status === 'reimbursement_pending') {
      trail.push(['finance', finance.id, 'reviewed', 'approved', 'reimbursement_pending',
        'Queued for the next payment run.', at(addDays(expenseDate, 5), 16, 0)]);
    }
    if (status === 'paid') {
      const paidAt = at(addDays(expenseDate, int(6, 10)), 16, 0);
      trail.push(['finance', finance.id, 'marked_paid', 'approved', 'paid', 'Settled in the weekly payment run.', paidAt]);
      paidClaims.push({ id: claim.id, amount, paidAt });
    }
    for (const [tstage, actor, action, from, to, comment, actedAt] of trail) {
      await q(`INSERT INTO expense_approvals (claim_id, stage, actor_id, action, from_status, to_status, comment, acted_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [claim.id, tstage, actor, action, from, to, comment, actedAt]);
    }
    claimCount++;
  }
  log(`    ${claimCount} claims`);

  // Reimbursement batches for everything already settled.
  if (paidClaims.length) {
    const batchCode = (await val(`SELECT next_code('reimbursement','REIMB',$1,3) AS c`, [year])).c;
    const total = paidClaims.reduce((a, c) => a + c.amount, 0);
    const batch = await val(
      `INSERT INTO reimbursement_batches (batch_code, paid_at, payment_reference, payment_mode, total_amount, created_by)
       VALUES ($1,$2,$3,'bank_transfer',$4,$5) RETURNING id`,
      [batchCode, addDays(TODAY, -4), `NEFT/${year}/${int(100000, 999999)}`, total.toFixed(2), finance.id]);
    for (const c of paidClaims) {
      await q(`INSERT INTO reimbursement_items (batch_id, claim_id, amount) VALUES ($1,$2,$3)`,
        [batch.id, c.id, c.amount]);
    }
    log(`    1 reimbursement batch covering ${paidClaims.length} claims`);
  }

  // -------------------------------------------------------------------
  log('Notifications …');
  let notifCount = 0;
  const notify = async (userId, type, title, body, entityType, entityId, severity, createdAt, read) => {
    await q(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, severity, created_at, read_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, type, title, body, entityType, entityId, severity, createdAt, read ? createdAt : null]);
    notifCount++;
  };

  for (const a of assignments.filter((x) => x.date >= addDays(TODAY, -1)).slice(0, 40)) {
    await notify(a.assigneeId, 'work.assigned', 'New work assigned',
      `${a.project.name} — ${a.code}. Due ${iso(addDays(a.date, a.dueOffset))}.`,
      'work_assignment', a.id, 'info', at(addDays(a.date, -1), 18, 5), chance(0.4));
  }
  for (const a of assignments.filter((x) => x.status === 'assigned' && x.date <= TODAY).slice(0, 12)) {
    await notify(a.assigneeId, 'work.acknowledgement_reminder', 'Acknowledgement pending',
      `You have not acknowledged ${a.code} yet. Please confirm you have received it.`,
      'work_assignment', a.id, 'warning', at(TODAY, 9, 30), false);
  }
  const recentClaims = (await q(
    `SELECT id, expense_code, user_id, status, amount FROM expense_claims
      WHERE status <> 'draft' ORDER BY created_at DESC LIMIT 25`)).rows;
  for (const c of recentClaims) {
    const map = {
      approved: ['expense.approved', 'Expense approved', 'success'],
      paid: ['expense.paid', 'Expense reimbursed', 'success'],
      rejected: ['expense.rejected', 'Expense rejected', 'critical'],
      returned: ['expense.returned', 'Expense returned for correction', 'warning'],
      submitted: ['expense.submitted', 'Expense submitted', 'info'],
      under_review: ['expense.submitted', 'Expense under review', 'info'],
      reimbursement_pending: ['expense.approved', 'Approved — awaiting payment', 'success'],
    };
    const [type, title, severity] = map[c.status] ?? map.submitted;
    await notify(c.user_id, type, title, `${c.expense_code} · ₹${Number(c.amount).toLocaleString('en-IN')}`,
      'expense_claim', c.id, severity, addDays(TODAY, -int(0, 6)), chance(0.5));
  }
  // Approvers see what is waiting on them.
  const queued = (await q(
    `SELECT id, expense_code, amount, current_stage FROM expense_claims
      WHERE status IN ('submitted','under_review')`)).rows;
  for (const c of queued) {
    await notify(c.current_stage === 'finance' ? finance.id : ops1.id, 'expense.awaiting_approval',
      'Expense awaiting your approval', `${c.expense_code} · ₹${Number(c.amount).toLocaleString('en-IN')}`,
      'expense_claim', c.id, 'warning', addDays(TODAY, -int(0, 3)), false);
  }
  log(`    ${notifCount} notifications`);

  // -------------------------------------------------------------------
  log('Organisation settings …');
  const settings = [
    ['organization', 'profile', {
      legalName: 'ADISYS Technologies', displayName: 'ADISYS', tagline: 'Observation Driven Insights',
      website: 'https://www.adisystech.com', supportEmail: 'fieldops@adisystech.com',
      registeredAddress: 'Plot 44, HITEC City, Hyderabad 500081, Telangana, India',
      gstin: '36AABCA1234K1ZP', timezone: 'Asia/Kolkata', currency: 'INR', fiscalYearStartMonth: 4,
    }],
    ['organization', 'business_hours', {
      workWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      standardStart: '09:00', standardEnd: '18:00', standardDailyHours: 8,
      halfDays: ['sat'], holidayCalendar: 'IN-TS',
    }],
    ['productivity', 'rules', {
      timeTrackingMethods: { timer: true, manualEntry: true, attendanceCheckIn: true },
      requireManagerVerification: true,
      countUnassignedTimeAsProductive: false,
      maxTimerHoursPerDay: 14,
      allowBackdatedEntryDays: 3,
      overtimeEnabled: false,
      autoStopTimerAfterHours: 12,
      productiveHoursDefinition: 'verified',
    }],
    ['productivity', 'location_policy', {
      checkInLocationEnabled: true,
      requireExplicitConsent: true,
      continuousTrackingEnabled: false,
      purpose: 'Confirms the employee was at the assigned site at check-in and check-out only.',
      retentionDays: 180,
      visibleTo: ['super_admin', 'ops_manager'],
    }],
    ['expense', 'rules', {
      defaultCurrency: 'INR',
      requireProjectOnClaim: true,
      maxReceiptSizeMb: 10,
      allowedReceiptTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
      backdatedClaimWindowDays: 45,
      duplicateDetectionEnabled: true,
      ocrEnabled: true,
      ocrRequiresEmployeeConfirmation: true,
      editableAfterApproval: false,
    }],
    ['notification', 'defaults', {
      channels: { inApp: true, push: true, email: false, whatsapp: false },
      acknowledgementReminderTime: '09:30',
      overdueEscalationHours: 24,
      digestEnabled: true, digestTime: '19:00',
    }],
    ['security', 'policy', {
      passwordMinLength: 10, passwordRequiresMixedCase: true, passwordRequiresNumber: true,
      maxFailedAttempts: 5, lockoutMinutes: 15,
      accessTokenMinutes: 30, refreshTokenDays: 30,
      forcePasswordChangeOnFirstLogin: true,
      auditRetentionDays: 2555,
    }],
  ];
  for (const [scope, key, value] of settings) {
    await q(`INSERT INTO settings (scope, key, value, updated_by) VALUES ($1,$2,$3,$4)`,
      [scope, key, JSON.stringify(value), admin.id]);
  }

  // A worked example of a per-user override: this supervisor may verify
  // time without holding the full Operations Manager role.
  await q(`INSERT INTO user_permission_overrides (user_id, permission_id, effect, granted_by)
           SELECT $1, id, 'allow', $2 FROM permissions WHERE key = 'time.verify'`,
    [staff[2].id, admin.id]);

  await q('COMMIT');

  // -------------------------------------------------------------------
  const counts = (await q(`
    SELECT
      (SELECT count(*) FROM users)              AS users,
      (SELECT count(*) FROM projects)           AS projects,
      (SELECT count(*) FROM work_assignments)   AS assignments,
      (SELECT count(*) FROM assignment_acknowledgements) AS acknowledgements,
      (SELECT count(*) FROM time_entries)       AS time_entries,
      (SELECT count(*) FROM attendance_sessions) AS attendance,
      (SELECT count(*) FROM expense_claims)     AS claims,
      (SELECT count(*) FROM expense_approvals)  AS approvals,
      (SELECT count(*) FROM files)              AS files,
      (SELECT count(*) FROM notifications)      AS notifications`)).rows[0];

  console.log('\n✅ Seed complete\n');
  console.table(counts);
  console.log('\nSign in with any of these (password for every account: %s):\n', DEFAULT_PASSWORD);
  console.table([
    { Role: 'Super Admin',      Name: admin.name,   'Employee ID': admin.code,   Email: admin.email },
    { Role: 'Operations Mgr',   Name: ops1.name,    'Employee ID': ops1.code,    Email: ops1.email },
    { Role: 'Operations Mgr',   Name: ops2.name,    'Employee ID': ops2.code,    Email: ops2.email },
    { Role: 'Finance Manager',  Name: finance.name, 'Employee ID': finance.code, Email: finance.email },
    { Role: 'Field Employee',   Name: staff[0].name, 'Employee ID': staff[0].code, Email: staff[0].email },
    { Role: 'Field Employee',   Name: staff[4].name, 'Employee ID': staff[4].code, Email: staff[4].email },
  ]);
} catch (err) {
  await q('ROLLBACK').catch(() => {});
  console.error('\n❌ Seed failed:', err);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
