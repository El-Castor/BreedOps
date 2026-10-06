import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

// Parallel sessions against the local database prove that generated breeding
// codes stay unique and gap-free under concurrent inserts. Fixtures are removed.
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
const organizationId = "11111111-0000-0000-0000-0000000000c1";
const programId = "55555555-0000-0000-0000-0000000000c1";
const sessions = 8;
const insertsPerSession = 5;

function cleanup() {
  psql(`DELETE FROM parent_lines WHERE program_id='${programId}';
        DELETE FROM programs WHERE id='${programId}';
        DELETE FROM organizations WHERE id='${organizationId}';`);
}

try {
  cleanup();
  psql(`INSERT INTO organizations(id,name,slug) VALUES ('${organizationId}','Concurrency','code-concurrency-test');
        INSERT INTO programs(id,organization_id,code,name) VALUES ('${programId}','${organizationId}','CCY','Concurrency');`);
  const inserts = Array.from(
    { length: insertsPerSession },
    (_, index) =>
      `INSERT INTO parent_lines(program_id,line_name) VALUES ('${programId}','line ${index}');`,
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
    `SELECT parent_code FROM parent_lines WHERE program_id='${programId}' ORDER BY parent_code`,
  )
    .trim()
    .split("\n");
  const expected = Array.from(
    { length: sessions * insertsPerSession },
    (_, index) => `CCY-P-${String(index + 1).padStart(4, "0")}`,
  );
  const unique = new Set(codes).size === codes.length;
  const complete = JSON.stringify(codes) === JSON.stringify(expected);
  console.log(
    `${unique ? "ok" : "not ok"} 1 - ${codes.length} concurrent codes are unique`,
  );
  console.log(
    `${complete ? "ok" : "not ok"} 2 - codes are sequential CCY-P-0001..${expected.at(-1)}`,
  );
  if (!unique || !complete) process.exitCode = 1;
} finally {
  cleanup();
}
