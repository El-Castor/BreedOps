// Read-only maintenance check for Plant Media: Storage and Postgres are not
// transactional with each other, so a crash between a successful upload and
// its metadata insert (or vice versa) can leave one side without the other.
// This script only reports what it finds; it never deletes anything.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey)
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
const bucket = "breedops-media";

async function listAllObjectPaths(prefix = "") {
  const paths = [];
  const { data, error } = await admin.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A folder placeholder has no id; Supabase Storage returns real objects
    // with their object id, so this is the reliable file/folder distinction.
    if (entry.id) paths.push(path);
    else paths.push(...(await listAllObjectPaths(path)));
  }
  return paths;
}

const [objectPaths, { data: rows, error: rowsError }] = await Promise.all([
  listAllObjectPaths(),
  admin.from("media_assets").select("id,storage_path"),
]);
if (rowsError) throw rowsError;

const referencedPaths = new Set(rows.map((row) => row.storage_path));
const objectPathSet = new Set(objectPaths);

const orphanObjects = objectPaths.filter((path) => !referencedPaths.has(path));
const danglingRows = rows.filter((row) => !objectPathSet.has(row.storage_path));

console.log(`Storage objects: ${objectPaths.length}`);
console.log(`Metadata rows: ${rows.length}`);
console.log(
  `Orphan storage objects (no metadata row): ${orphanObjects.length}`,
);
for (const path of orphanObjects) console.log(`  - ${path}`);
console.log(
  `Dangling metadata rows (no storage object): ${danglingRows.length}`,
);
for (const row of danglingRows)
  console.log(`  - ${row.id} -> ${row.storage_path}`);

if (orphanObjects.length || danglingRows.length) process.exitCode = 1;
