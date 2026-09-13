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
    input: readFileSync("tests/auth-rls.sql", "utf8"),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const lines = output
  .split("\n")
  .filter((line) => /^(ok |not ok |1\.\.|#)/.test(line));
console.log(lines.join("\n"));
if (
  lines.some((line) => line.startsWith("not ok")) ||
  lines.filter((line) => line.startsWith("ok ")).length !== 21
)
  process.exitCode = 1;
