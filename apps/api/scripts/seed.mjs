#!/usr/bin/env node
/**
 * ADISYS FieldOps — initial dataset.
 *
 * Loads the reference data the product needs to run (roles, the permission
 * matrix, departments, designations, locations, expense categories and
 * approval policies) and the real staff list. No projects, work, time or
 * expense history is generated: those are created through the product.
 */
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Adisys@2026';

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
    leave_requests, leave_types,
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
  // Departments and designations are taken verbatim from the company's
  // employee list, including the entries that read more like job titles.
  const deptDefs = [
    ['ACC', 'Accounts'], ['PRE', 'Project Engineer'], ['STN', 'senior Technician'],
    ['SRV', 'Service Engineer'], ['TEC', 'Technician'], ['OPH', 'Operation head'],
    ['SAL', 'Sales'], ['SLP', 'Sales / purchase'], ['BMS', 'BMS'],
    ['HSK', 'House keeping'], ['CAD', 'CAD designer'],
  ];
  const deptIds = {};
  for (const [code, name] of deptDefs) {
    deptIds[code] = (await val(`INSERT INTO departments (code, name) VALUES ($1,$2) RETURNING id`, [code, name])).id;
  }

  const desigDefs = [
    ['Manager', 'M1'], ['Assistant Manager', 'M2'], ['Engineer', 'E1'],
    ['Executive', 'E2'], ['Project', 'P1'], ['Service', 'S1'], ['Office', 'O1'],
    ['System Administrator', 'A1'],
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

  // Real staff carry the company's own employee codes (A133/IND and the like),
  // so those are inserted verbatim; only accounts created here without a code
  // draw from the allocator.
  // Every account starts from the same default password and must change it on
  // first sign-in. location_consent_at and last_login_at stay null: consent to
  // check-in geotagging is the employee's to give, and nobody has signed in
  // yet, so neither may be fabricated here.
  const addUser = async (u) => {
    const code = u.code ?? await nextEmpCode();
    const row = await val(
      `INSERT INTO users (employee_code, full_name, email, phone, password_hash, must_change_password,
                          role_id, department_id, designation_id, base_location_id, reporting_manager_id,
                          date_of_joining, status, location_consent_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12,NULL,NULL) RETURNING id`,
      [code, u.name, u.email, u.phone, pwHash, roleIds[u.role],
       u.dept ? deptIds[u.dept] : null, u.desig ? desigIds[u.desig] : null,
       u.loc ? locIds[u.loc] : null, u.managerId ?? null, u.joined ?? null, u.status ?? 'active']);
    const rec = { id: row.id, code, ...u };
    users.push(rec);
    return rec;
  };

  // "CCH" in the employee list's Reporting Manager column.
  const admin = await addUser({
    name: 'Chandrashekhar Hiremath', email: 'admin@adisystech.com', phone: '9100000001',
    role: 'super_admin', desig: 'System Administrator', joined: '2019-04-01',
  });

  // Every person on the company employee list. Where the list records no
  // email address the column is left empty rather than invented: the column
  // is nullable (migration 007) and these staff sign in with their employee
  // code or mobile number instead.
  //
  // Roles follow the list's own reporting lines rather than job titles: only
  // the people somebody actually reports to hold a manager role. Several staff
  // designated "Manager" are therefore Employees here.
  //
  //     code, name, email, phone, role, dept, designation, manager token, DOJ
  const roster = [
    ['A133/IND',   'Shwetha Shree C S',       'accounts@adisys.in',        '9980606511',            'finance_manager',  'Accounts',           'Assistant Manager',   'CCH',            '2024-11-22'],
    ['A158/IND',   'Janitha',                 'janithaadisys@gmail.com',   'DUPLICATE-A158IND',     'employee',         'Accounts',           'Executive',           'Shwetha Shree',  '2025-12-05'],
    ['A05/IND',    'Reddy Shekhar M K',       'sreddy@adisys.in',          '9964887647',            'employee',         'Project Engineer',   'Manager',             'CCH',            '2017-08-17'],
    ['A40/IND',    'Madhusudhan M',           'support1@adisys.in',        '9900193044',            'employee',         'Project Engineer',   'Manager',             'CCH',            '2015-04-08'],
    ['A66/IND',    'Mohsin Khan',             null,                        '6360710615',            'employee',         'senior Technician',  'Project',             'Rajesh',         '2016-01-14'],
    ['A94/IND',    'Vinayak Gavimath',        'vinayak@adisys.in',         '8892147638',            'employee',         'Project Engineer',   'Assistant Manager',   'CCH',            '2017-09-18'],
    ['A48/IND',    'Shashikanth Noolvi',      'shashikanth@adisys.in',     '9743932077',            'employee',         'Project Engineer',   'Assistant Manager',   'CCH',            '2019-12-09'],
    ['A101/IND',   'Rajesh',                  'rajesh@adisys.in',          '9900042350',            'ops_manager',      'Service Engineer',   'Manager',             'CCH',            '2021-08-16'],
    ['A102/IND',   'Ganesh',                  null,                        '7349200376',            'employee',         'senior Technician',  'Project',             'Rajesh',         '2023-05-02'],
    ['A107/IND',   'Amal Raj',                null,                        '7975638344',            'employee',         'Technician',         'Project',             'Rajesh',         '2023-05-02'],
    ['A108/IND',   'Vignesh',                 null,                        '7338152583',            'employee',         'Project Engineer',   'Project',             'Rajesh',         '2023-05-02'],
    ['A17/IND',    'Shrilakshmi R',           'shrilakshmi@adisys.in',     '8496992373',            'employee',         'Operation head',     'Manager',             'CCH',            '2012-06-29'],
    ['A110/IND',   'Avinash R',               null,                        '9742731288',            'employee',         'Technician',         'Project',             'Rajesh',         '2023-01-09'],
    ['A132/IND',   'Sachin',                  'sachin@adisys.in',          '8861200696',            'employee',         'Sales',              'Manager',             'CCH',            '2024-11-21'],
    ['A116/IND',   'Nitheen Biradar',         null,                        '9880202511',            'employee',         'Technician',         'Project',             'Rajesh',         '2023-08-04'],
    ['A113/IND',   'Vinod',                   'vinod@adisys.in',           '9742801267',            'employee',         'Sales',              'Manager',             'CCH',            '2023-06-01'],
    ['A115a/IND',  'Pavan',                   null,                        '8951356799',            'employee',         'Technician',         'Project',             'Rajesh',         '2023-10-03'],
    ['A115/IND',   'Reshma',                  'reshma@adisys.in',          '9606033201',            'employee',         'Sales / purchase',   'Assistant Manager',   'CCH',            '2023-10-25'],
    ['A120/IND',   'Harish R Antravalli',     'harish@adisys.in',          '9606033202',            'ops_manager',      'BMS',                'Manager',             'CCH',            '2023-12-07'],
    ['A125/IND',   'Shankrappa',              null,                        '8553979564',            'employee',         'senior Technician',  'Manager',             'Rajesh',         '2024-03-11'],
    ['A127/IND',   'Ishwar',                  null,                        '8884544956',            'employee',         'Technician',         'Project',             'Rajesh',         '2024-08-01'],
    ['A128/IND',   'Basavaraj',               null,                        '7899824701',            'employee',         'Technician',         'Project',             'Rajesh',         '2024-08-12'],
    ['A140/IND',   'Praveen',                 null,                        '6361629657',            'employee',         'Technician',         'Project',             'Rajesh',         '2025-12-02'],
    ['A141/IND',   'Sudeep',                  null,                        '7483599626',            'employee',         'Technician',         'Project',             'Rajesh',         '2025-02-17'],
    ['A137/IND',   'Sujith Ashok',            null,                        '7338147323',            'employee',         'Technician',         'Project',             'Rajesh',         '2025-01-22'],
    ['A136/IND',   'Girish',                  null,                        '8762014788',            'employee',         'House keeping',      'Office',              'Rajesh',         '2025-01-01'],
    ['A142/IND',   'Spandana K',              'spandana@adisys.in',        '7483595969',            'employee',         'CAD designer',       'Engineer',            'CCH',            '2025-03-03'],
    ['A147/IND',   'Nagaraj',                 null,                        '8073971335',            'employee',         'Technician',         'Project',             'Rajesh',         '2025-07-04'],
    ['A154/IND',   'RUDRESH',                 null,                        '8951888903',            'employee',         'Technician',         'Project',             'Harish',         '2025-09-24'],
    ['A155/IND',   'Basavaraj Saboji',        'basavaraj@adisys.in',       '8884604292',            'employee',         'Sales',              'Manager',             'CCH',            '2025-10-27'],
    ['A160/IND',   'HANAMANTH SURYAVAMSHI',   null,                        '7019117521',            'employee',         'Technician',         'Project',             'CCH',            null],
    ['A161/IND',   'SPANDANA G',              'spandana.g@adisys.in',      '7483720502',            'employee',         'Sales',              'Project',             'CCH',            null],
    ['A162/IND',   'Niranjan',                null,                        '7411407391',            'employee',         'Technician',         'Project',             'Rajesh',         null],
    ['A163/IND',   'Pushpavathi',             null,                        '6366113850',            'employee',         'Service Engineer',   'Service',             'Rajesh',         null],
  ];

  const deptCodeByName = Object.fromEntries(deptDefs.map(([code, name]) => [name, code]));
  const byCode = {};
  // Two passes: everyone is inserted first, then reporting lines are set, so a
  // manager may appear anywhere in the list.
  for (const [code, name, email, phone, role, dept, desig, , joined] of roster) {
    byCode[code] = await addUser({
      code, name, email, phone, role,
      dept: dept ? deptCodeByName[dept] : null, desig, joined,
    });
  }

  const managerCodeFor = { 'CCH': null, 'Shwetha Shree': 'A133/IND', 'Rajesh': 'A101/IND', 'Harish': 'A120/IND' };
  for (const [code, , , , , , , managerToken] of roster) {
    const mgrCode = managerCodeFor[managerToken];
    const managerId = managerToken === 'CCH' ? admin.id : (mgrCode ? byCode[mgrCode]?.id : null);
    if (managerId) await q(`UPDATE users SET reporting_manager_id = $1 WHERE id = $2`, [managerId, byCode[code].id]);
  }

  await q(`UPDATE departments SET head_user_id = $1 WHERE code = $2`, [byCode['A133/IND'].id, 'ACC']);
  await q(`UPDATE departments SET head_user_id = $1 WHERE code = $2`, [byCode['A101/IND'].id, 'SRV']);
  await q(`UPDATE departments SET head_user_id = $1 WHERE code = $2`, [byCode['A120/IND'].id, 'BMS']);
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
  log('Leave types …');
  const leaveTypeDefs = [
    ['casual',      'Casual Leave',      'Short personal absence, planned in advance.',            true,  10],
    ['sick',        'Sick Leave',        'Illness or medical appointment.',                        true,  20],
    ['earned',      'Earned Leave',      'Accrued paid leave.',                                    true,  30],
    ['unpaid',      'Unpaid Leave',      'Approved absence without pay.',                          false, 40],
    ['compensatory','Compensatory Off',  'Time off in lieu of work on a holiday or rest day.',     true,  50],
    ['bereavement', 'Bereavement Leave', 'Absence following a death in the family.',               true,  60],
  ];
  for (const [key, name, description, isPaid, sortOrder] of leaveTypeDefs) {
    await q(`INSERT INTO leave_types (key, name, description, is_paid, sort_order)
             VALUES ($1,$2,$3,$4,$5)`, [key, name, description, isPaid, sortOrder]);
  }
  log(`    ${leaveTypeDefs.length} leave types`);

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

  await q('COMMIT');

  // -------------------------------------------------------------------
  const counts = (await q(`
    SELECT
      (SELECT count(*) FROM users)              AS users,
      (SELECT count(*) FROM departments)        AS departments,
      (SELECT count(*) FROM designations)       AS designations,
      (SELECT count(*) FROM work_locations)     AS work_locations,
      (SELECT count(*) FROM expense_categories) AS expense_categories,
      (SELECT count(*) FROM expense_policies)   AS expense_policies,
      (SELECT count(*) FROM leave_types)        AS leave_types,
      (SELECT count(*) FROM leave_requests)     AS leave_requests,
      (SELECT count(*) FROM projects)           AS projects,
      (SELECT count(*) FROM work_assignments)   AS assignments,
      (SELECT count(*) FROM expense_claims)     AS claims`)).rows[0];

  console.log('\n✅ Seed complete\n');
  console.table(counts);
  console.log('\nSign in with any of these (password for every account: %s):\n', DEFAULT_PASSWORD);
  console.table(users.map((u) => ({
    Role: u.role, Name: u.name, 'Employee ID': u.code, Email: u.email,
  })));
} catch (err) {
  await q('ROLLBACK').catch(() => {});
  console.error('\n❌ Seed failed:', err);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
