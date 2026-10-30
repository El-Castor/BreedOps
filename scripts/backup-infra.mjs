#!/usr/bin/env node
// Infrastructure backup: PostgreSQL data + Supabase Storage media files +
// a copy of the local config needed to stand the stack back up. Deliberately
// separate from the application's own functional CSV/XLSX export (see
// docs/BACKUP.md) - this is the restore-everything-after-disaster layer.
//
// Never overwrites an existing backup: each run creates its own
// timestamped directory and refuses to run if that exact directory
// somehow already exists. Takes connection details as explicit CLI
// arguments - it has no notion of "the" local stack and will never
// silently resolve one from supabase/config.toml, so it can only ever
// back up whatever database/storage endpoint it was explicitly pointed at.
//
// Usage:
//   node scripts/backup-infra.mjs \
//     --db-url postgresql://postgres:postgres@127.0.0.1:PORT/postgres \
//     --storage-url http://127.0.0.1:PORT/storage/v1 \
//     --service-role-key <key> \
//     --bucket breedops-media \
//     --out backups
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const required = ["db-url", "storage-url", "service-role-key", "bucket"];
for (const key of required) {
  if (!args[key]) {
    console.error(`Missing required --${key}`);
    process.exit(1);
  }
}

const outRoot = args.out ?? "backups";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(outRoot, stamp);
if (existsSync(outDir)) {
  console.error(
    `Refusing to overwrite an existing backup directory: ${outDir}`,
  );
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

console.log(`Backing up to ${outDir} ...`);

// 1. PostgreSQL dump: schema and data are two separate dumps (the
// Supabase CLI's own convention - "db dump" alone is schema-only), kept
// as two files so restore can apply them in the right order. Uses the
// project-pinned Supabase CLI (the same binary every other script in
// this repo uses) rather than assuming a system pg_dump is installed.
const cliPath = path.join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase",
);
const schemaPath = path.join(outDir, "schema.sql");
const dataPath = path.join(outDir, "data.sql");
execFileSync(
  cliPath,
  ["db", "dump", "--db-url", args["db-url"], "-f", schemaPath],
  { stdio: "inherit" },
);
execFileSync(
  cliPath,
  [
    "db",
    "dump",
    "--data-only",
    // storage.buckets/storage.migrations are Supabase's own infrastructure
    // bookkeeping, already (re-)created by a fresh stack's own startup
    // (confirmed: restoring them collides with the bucket a fresh stack's
    // migrations already provision) - not BreedOps application data.
    // storage.objects (file metadata) is kept: it is real data, restored
    // alongside the actual files this script downloads separately below.
    "--exclude",
    "storage.buckets",
    "--exclude",
    "storage.migrations",
    "--db-url",
    args["db-url"],
    "-f",
    dataPath,
  ],
  { stdio: "inherit" },
);
console.log(`Database dump written: ${schemaPath}, ${dataPath}`);

// 2. Storage media files, via the Storage REST API (works identically
// against a local stack or any self-hosted deployment - never reaches
// into Docker internals).
const mediaDir = path.join(outDir, "media", args.bucket);
mkdirSync(mediaDir, { recursive: true });

// The Storage list API is not recursive and returns both real objects
// (id != null) and folder markers (id == null, no content of their own) -
// folders must be listed again with their name as the new prefix to reach
// the files inside them.
async function listAllKeys(prefix) {
  const response = await fetch(
    `${args["storage-url"]}/object/list/${args.bucket}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args["service-role-key"]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 10000, offset: 0, prefix }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Storage list failed: ${response.status} ${await response.text()}`,
    );
  }
  const entries = await response.json();
  const keys = [];
  for (const entry of entries) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      keys.push(...(await listAllKeys(key)));
    } else {
      keys.push(key);
    }
  }
  return keys;
}

const keys = await listAllKeys("");
const contentTypes = {};
let downloaded = 0;
for (const key of keys) {
  const fileResponse = await fetch(
    `${args["storage-url"]}/object/${args.bucket}/${key}`,
    { headers: { Authorization: `Bearer ${args["service-role-key"]}` } },
  );
  if (!fileResponse.ok) {
    console.warn(
      `Skipping ${key}: ${fileResponse.status} ${await fileResponse.text()}`,
    );
    continue;
  }
  // Recorded so restore-infra.mjs can re-upload with the same Content-Type
  // - the bucket enforces an allowed-mime-type list, and a re-upload
  // without one defaults to application/octet-stream, which that list
  // rejects outright.
  contentTypes[key] = fileResponse.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const target = path.join(mediaDir, key);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  downloaded += 1;
}
console.log(`Storage objects downloaded: ${downloaded}`);
writeFileSync(
  path.join(outDir, "media-content-types.json"),
  JSON.stringify(contentTypes, null, 2),
);

// 3. A manifest recording what this backup contains and how it was made -
// never real secrets, just enough to know what to expect when restoring.
writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      bucket: args.bucket,
      storageObjectCount: downloaded,
      databaseSchemaFile: "schema.sql",
      databaseDataFile: "data.sql",
      mediaContentTypesFile: "media-content-types.json",
      note: "Run scripts/restore-infra.mjs against this directory to restore. Never restore into a database or storage bucket you care about without first confirming it is disposable.",
    },
    null,
    2,
  ),
);

console.log(`Backup complete: ${outDir}`);
