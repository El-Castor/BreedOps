import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

// Parallel sessions against the local database prove that generated program
// codes stay unique under concurrent inserts, with no coordination needed
// beyond the PostgreSQL sequence itself. Fixtures are removed afterwards.
const run = promisify(execFile);
const psqlArgs = [
  "exec",
  "-i",
  "supabase_db_BreedOps",
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-At",
  "-c",
];
const psql = (sql) =>
  execFileSync("docker", [...psqlArgs, sql], { encoding: "utf8" });
const organizationId = "11111111-0000-0000-0000-0000000000d2";
const sessions = 8;
const insertsPerSession = 5;
const total = sessions * insertsPerSession;

function cleanup() {
  psql(`DELETE FROM programs WHERE organization_id='${organizationId}';
        DELETE FROM organizations WHERE id='${organizationId}';`);
}

try {
  cleanup();
  psql(
    `INSERT INTO organizations(id,name,slug) VALUES ('${organizationId}','Program code concurrency','program-code-concurrency-test');`,
  );
  const inserts = Array.from(
    { length: insertsPerSession },
    (_, index) =>
      `INSERT INTO programs(organization_id,name,species) VALUES ('${organizationId}','concurrency ${index}','Wheat');`,
  ).join(" ");
  await Promise.all(
    Array.from({ length: sessions }, () =>
      run("docker", [
        ...psqlArgs,
        `BEGIN; ${inserts} SELECT pg_sleep(0.05); COMMIT;`,
      ]),
    ),
  );
  const codes = psql(
    `SELECT code FROM programs WHERE organization_id='${organizationId}' ORDER BY code`,
  )
    .trim()
    .split("\n");
  const unique = new Set(codes).size === codes.length;
  const complete = codes.length === total;
  const wellFormed = codes.every((code) => /^PRG-\d{4,}$/.test(code));
  console.log(
    `${unique ? "ok" : "not ok"} 1 - ${codes.length} concurrent program codes are unique`,
  );
  console.log(
    `${complete ? "ok" : "not ok"} 2 - all ${total} concurrent inserts produced a code`,
  );
  console.log(
    `${wellFormed ? "ok" : "not ok"} 3 - every generated code matches PRG-NNNN`,
  );
  if (!unique || !complete || !wellFormed) process.exitCode = 1;
} finally {
  cleanup();
}
