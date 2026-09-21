/** Points every test process at the test database. */
const url = new URL(process.env.DATABASE_URL!);
if (!url.pathname.endsWith('_test')) {
  url.pathname = '/adisys_fieldops_test';
  process.env.DATABASE_URL = url.toString();
}
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';     // keep the suite fast
process.env.RATE_LIMIT_MAX = '100000';
process.env.LOGIN_RATE_LIMIT_MAX = '100000';
