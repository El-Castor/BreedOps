import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const output = execFileSync(
  "docker",
  [
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
  ],
  {
    input: readFileSync(process.argv[2] ?? "tests/auth-rls.sql", "utf8"),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const lines = output
  .split("\n")
  .filter((line) => /^(ok |not ok |1\.\.|#)/.test(line));
console.log(lines.join("\n"));
const plan = lines.find((line) => /^1\.\.\d+$/.test(line));
const expected = plan ? Number(plan.slice(3)) : 0;
if (
  !expected ||
  lines.some((line) => line.startsWith("not ok")) ||
  lines.filter((line) => line.startsWith("ok ")).length !== expected
)
  process.exitCode = 1;
