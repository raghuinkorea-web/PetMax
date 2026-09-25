#!/usr/bin/env node
/**
 * Runs the API, the admin portal and the employee app together, with each
 * process's output prefixed so a stack trace is attributable at a glance.
 */
import { spawn } from 'node:child_process';

const ESC = String.fromCharCode(27);
const RESET = ESC + '[0m';

const SERVICES = [
  { name: 'api',      colour: ESC + '[36m', args: ['run', 'dev', '-w', '@adisys/api'] },
  { name: 'admin',    colour: ESC + '[35m', args: ['run', 'dev', '-w', '@adisys/admin'] },
  { name: 'employee', colour: ESC + '[33m', args: ['run', 'dev', '-w', '@adisys/employee'] },
];

// On Windows npm is a .cmd shim, and since Node 20 a .cmd cannot be spawned
// without a shell. The arguments below are literals, so there is nothing to
// quote or inject.
const WINDOWS = process.platform === 'win32';

const children = [];

for (const service of SERVICES) {
  const child = spawn('npm', service.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: WINDOWS,
  });
  children.push(child);

  const prefix = `${service.colour}[${service.name.padEnd(8)}]${RESET} `;
  const pipe = (stream) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) process.stdout.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) process.stdout.write(`${prefix}exited with code ${code}\n`);
  });
}

console.log(`
  ADISYS FieldOps — development

    API             http://localhost:4000/api/health
    Admin portal    http://localhost:5173
    Employee app    http://localhost:5174

  Sign in with ADI-0001 (Super Admin) and the seeded password.
  Press Ctrl+C to stop everything.
`);

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
