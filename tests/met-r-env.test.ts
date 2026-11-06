import { describe, expect, it } from "vitest";
import { buildRSubprocessEnv } from "../src/lib/met/r-env";

describe("buildRSubprocessEnv (B-review blocker #4)", () => {
  it("never forwards a server secret, however it is named", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_should_never_leak",
      DATABASE_URL: "postgres://should-never-leak",
      JWT_SECRET: "should-never-leak",
      SOME_OTHER_APP_SECRET: "should-never-leak",
    };
    const result = buildRSubprocessEnv(fakeEnv) as Record<string, unknown>;
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(result.DATABASE_URL).toBeUndefined();
    expect(result.JWT_SECRET).toBeUndefined();
    expect(result.SOME_OTHER_APP_SECRET).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
  });

  it("passes through the allowlisted names (and RENV_* settings) when present", () => {
    const fakeEnv = {
      PATH: "/usr/bin",
      HOME: "/home/test",
      TMPDIR: "/tmp",
      R_HOME: "/usr/lib/R",
      R_LIBS_USER: "/custom/libs",
      RENV_PATHS_ROOT: "/custom/renv-cache",
    };
    const result = buildRSubprocessEnv(fakeEnv) as Record<string, unknown>;
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/test");
    expect(result.TMPDIR).toBe("/tmp");
    expect(result.R_HOME).toBe("/usr/lib/R");
    expect(result.R_LIBS_USER).toBe("/custom/libs");
    expect(result.RENV_PATHS_ROOT).toBe("/custom/renv-cache");
  });

  it("always sets the three fixed values, and the source environment cannot override them", () => {
    const result = buildRSubprocessEnv({
      LC_ALL: "C",
      LANG: "C",
      RENV_CONFIG_STARTUP_QUIET: "FALSE",
    });
    expect(result.LC_ALL).toBe("C.UTF-8");
    expect(result.LANG).toBe("C.UTF-8");
    expect(result.RENV_CONFIG_STARTUP_QUIET).toBe("TRUE");
  });

  it("omits an allowed name entirely when absent, rather than setting it to empty", () => {
    const result = buildRSubprocessEnv({ PATH: "/usr/bin" }) as Record<
      string,
      unknown
    >;
    expect("HOME" in result).toBe(false);
    expect("TMPDIR" in result).toBe(false);
    expect("R_LIBS_USER" in result).toBe(false);
  });

  it("always sets NODE_ENV (required by NodeJS.ProcessEnv), falling back to production", () => {
    expect(buildRSubprocessEnv({}).NODE_ENV).toBe("production");
    expect(buildRSubprocessEnv({ NODE_ENV: "test" }).NODE_ENV).toBe("test");
  });
});
