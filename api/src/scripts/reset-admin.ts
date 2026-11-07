/**
 * Resets a staff member's password, for when no other superadmin can do it in the portal
 * (the only superadmin forgot it, or is locked out):
 *   npm run admin:reset -- you@example.com
 * Prints a temporary password, to be changed at the next sign-in. All their sessions are signed out.
 */
import { createApp } from '../bootstrap.js';
import { Database } from '../common/database.service.js';
import { hashPassword, temporaryPassword } from '../modules/admin/admin-auth.controller.js';
import { AuditService, SYSTEM } from '../modules/audit/audit.service.js';

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: npm run admin:reset -- <email>');
  process.exit(1);
}
const app = await createApp({ logger: false });
const db = app.get(Database);
const password = temporaryPassword();
const a = await db.one<{ id: string }>(
  `UPDATE admins SET password_hash = $2, must_change_password = true, locked_at = NULL, failed_attempts = 0
    WHERE email = $1 RETURNING id`,
  [email, await hashPassword(password)]
);
if (!a) {
  console.error(`No staff account with the email ${email}.`);
  await app.close();
  process.exit(1);
}
await db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [a.id]);
await app.get(AuditService).record(SYSTEM, { action: 'staff.resetAccess', entityType: 'admin', entityId: a.id, summary: `Reset ${email}'s password from the command line` });
console.log(`Access reset for ${email}\nTemporary password: ${password}\nSign in to the admin portal with it, then choose your own password.`);
await app.close();
