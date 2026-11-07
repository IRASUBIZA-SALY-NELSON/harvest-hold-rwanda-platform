/**
 * Creates a superadmin (the first one, or a new one if all are lost):
 *   npm run admin:create -- you@example.com "Your Name"
 * Prints a temporary password. At first sign-in you choose your own password.
 */
import { createApp } from '../bootstrap.js';
import { Database } from '../common/database.service.js';
import { newId } from '../common/ids.js';
import { hashPassword, temporaryPassword } from '../modules/admin/admin-auth.controller.js';
import { AuditService, SYSTEM } from '../modules/audit/audit.service.js';

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
  console.error('Usage: npm run admin:create -- <email> "<full name>"');
  process.exit(1);
}
const app = await createApp({ logger: false });
const db = app.get(Database);
if (await db.one('SELECT 1 FROM admins WHERE email = $1', [email.toLowerCase()])) {
  console.error(`${email} already exists. Another superadmin can reset their access in the portal.`);
  await app.close();
  process.exit(1);
}
const password = temporaryPassword();
const id = newId('ad');
await db.query("INSERT INTO admins (id, email, name, role, password_hash) VALUES ($1, $2, $3, 'superadmin', $4)", [id, email.toLowerCase(), name, await hashPassword(password)]);
await app.get(AuditService).record(SYSTEM, { action: 'staff.create', entityType: 'admin', entityId: id, summary: `Created superadmin ${name} <${email}> from the command line` });
console.log(`Superadmin created: ${email}\nTemporary password: ${password}\nSign in to the admin portal to choose your own password.`);
await app.close();
