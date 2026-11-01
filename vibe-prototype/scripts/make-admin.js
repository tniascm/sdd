// Grants (or with --remove, revokes) admin rights for an existing account.
// Run on the server:  npm run make-admin -- someone@uni.example [--remove]
// Admin rights can only be granted here, so nobody can claim them by signing up.
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { setAdmin } from '../src/users.js';

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const email = args.find((a) => !a.startsWith('--'));

if (!email) {
  console.error('Usage: npm run make-admin -- <email> [--remove]');
  process.exit(1);
}

const db = openDatabase(loadConfig());
const user = setAdmin(db, email, !remove);
db.close();

if (!user) {
  console.error(`No account with email ${email}. The person must sign up first.`);
  process.exit(1);
}
console.log(`${user.name} <${user.email}> is ${remove ? 'no longer an admin' : 'now an admin'}.`);
