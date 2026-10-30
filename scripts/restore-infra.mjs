#!/usr/bin/env node
// Restores a backup created by scripts/backup-infra.mjs into a target
// database + Storage bucket. Deliberately requires --confirm-disposable
// (a literal flag, not inferred) before touching anything, and refuses
// to proceed without it - this script can overwrite every row in the
// target database, so it must never be pointed at a database anyone
// cares about by accident.
//
// Usage:
//   node scripts/restore-infra.mjs \
//     --backup backups/2026-01-01T00-00-00-000Z \
//     --db-url postgresql://postgres:postgres@127.0.0.1:PORT/postgres \
//     --storage-url http://127.0.0.1:PORT/storage/v1 \
//     --service-role-key <key> \
//     --bucket breedops-media \
//     --confirm-disposable
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--confirm-disposable" || argv[i] === "--skip-schema") {
      args[argv[i].slice(2)] = true;
      continue;
    }
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = ["backup", "db-url", "storage-url", "service-role-key", "bucket"];
for (const key of required) {
  if (!args[key]) {
    console.error(`Missing required --${key}`);
    process.exit(1);
  }
}
if (!args["confirm-disposable"]) {
  console.error(
    "Refusing to run without --confirm-disposable. This script overwrites " +
      "every row in the target database - point it only at a database you " +
      "have confirmed is disposable, never a retained/production one.",
  );
  process.exit(1);
}
if (!existsSync(args.backup)) {
  console.error(`Backup directory not found: ${args.backup}`);
  process.exit(1);
}
const manifest = JSON.parse(
  readFileSync(path.join(args.backup, "manifest.json"), "utf8"),
);
console.log(`Restoring backup from ${manifest.createdAt} (${args.backup})`);

// 1. Restore schema, then data, in that order (matching how
// scripts/backup-infra.mjs produced them) - via psql directly against the
// explicit --db-url (never the workdir's own project).
//
// --skip-schema: the recommended path when the target is a freshly
// provisioned BreedOps stack (its schema already matches exactly, applied
// from this same repository's versioned migrations - the actual source of
// truth per CLAUDE.md, not the pg_dump snapshot). Re-applying schema.sql
// on top of an already-migrated database would conflict with objects that
// already exist. Omit --skip-schema only when restoring into a database
// with no BreedOps schema at all (disaster recovery with migrations
// themselves unavailable).
const files = args["skip-schema"] ? ["data.sql"] : ["schema.sql", "data.sql"];
for (const file of files) {
  const dumpPath = path.join(args.backup, file);
  execFileSync(
    "psql",
    [args["db-url"], "-v", "ON_ERROR_STOP=1", "-f", dumpPath],
    { stdio: "inherit" },
  );
}
console.log(`Database restored (${files.join(" + ")}).`);

// 2. Re-upload Storage media files from the backup's media/<bucket>/ tree,
// restoring each one's original Content-Type (recorded by
// backup-infra.mjs) - the bucket's allowed-mime-type list rejects a
// re-upload that defaults to application/octet-stream.
const mediaDir = path.join(args.backup, "media", args.bucket);
const contentTypesPath = path.join(args.backup, "media-content-types.json");
const contentTypes = existsSync(contentTypesPath)
  ? JSON.parse(readFileSync(contentTypesPath, "utf8"))
  : {};
let uploaded = 0;
if (existsSync(mediaDir)) {
  // Collect the full file list first, then upload (keeps this script
  // simple to reason about if an upload fails partway through - the
  // listing itself never mutates).
  const files = [];
  const collect = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const key = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) collect(full, key);
      else files.push({ full, key });
    }
  };
  collect(mediaDir, "");
  for (const { full, key } of files) {
    const body = readFileSync(full);
    const response = await fetch(
      `${args["storage-url"]}/object/${args.bucket}/${key}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args["service-role-key"]}`,
          "x-upsert": "true",
          "Content-Type": contentTypes[key] ?? "application/octet-stream",
        },
        body,
      },
    );
    if (!response.ok) {
      console.warn(`Failed to restore ${key}: ${response.status} ${await response.text()}`);
      continue;
    }
    uploaded += 1;
  }
}
console.log(`Storage objects restored: ${uploaded}`);
console.log("Restore complete. Run an application smoke test before trusting this environment.");
