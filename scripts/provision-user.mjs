import { createHash } from "node:crypto";

const [, , emailArg, roleArg, ...nameParts] = process.argv;
const roles = new Set(["producao", "qualidade", "diretoria"]);

if (!emailArg || !roles.has(roleArg) || nameParts.length === 0) {
  console.error('Uso: node scripts/provision-user.mjs "usuario@empresa.com" producao "Nome da pessoa"');
  process.exit(1);
}

const identityHash = createHash("sha256").update(emailArg.trim().toLowerCase()).digest("hex");
const displayName = nameParts.join(" ").replaceAll("'", "''").trim();
const role = roleArg;

console.log(`INSERT INTO user_roles (identity_hash, display_name, role, active)
VALUES ('${identityHash}', '${displayName}', '${role}', 1)
ON CONFLICT(identity_hash) DO UPDATE SET
  display_name = excluded.display_name,
  role = excluded.role,
  active = 1;`);
