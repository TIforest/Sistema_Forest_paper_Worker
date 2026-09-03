import { createHash } from "node:crypto";

const [, , emailArg, roleArg, ...nameParts] = process.argv;
// Papeis reconhecidos pelo portal. "admin" ve todas as abas e administra
// usuarios; os demais liberam apenas as abas do proprio setor.
const roles = new Set(["admin", "producao", "qualidade", "diretoria", "comercial", "financeiro"]);

if (!emailArg || !roles.has(roleArg) || nameParts.length === 0) {
  console.error('Uso: node scripts/provision-user.mjs "usuario@empresa.com" <papel> "Nome da pessoa"');
  console.error(`Papeis: ${[...roles].join(", ")}`);
  process.exit(1);
}

const identityHash = createHash("sha256").update(emailArg.trim().toLowerCase()).digest("hex");
const displayName = nameParts.join(" ").replaceAll("'", "''").trim();
const role = roleArg;

// access_roles guarda a lista completa de setores; sem ela o portal cai no
// papel unico da coluna role.
console.log(`INSERT INTO user_roles (identity_hash, display_name, role, active, created_at, access_roles)
VALUES ('${identityHash}', '${displayName}', '${role}', 1, '${new Date().toISOString()}', '${JSON.stringify([role])}')
ON CONFLICT(identity_hash) DO UPDATE SET
  display_name = excluded.display_name,
  role = excluded.role,
  access_roles = excluded.access_roles,
  active = 1;`);
