// Validates a user-supplied "next" redirect target (used so a QR scan made
// while logged out lands back on the intended page after authentication -
// see src/middleware.ts and src/app/auth/login/route.ts). Never trusts the
// raw string as a path: resolving it against a placeholder origin and
// checking the origin didn't change is the standard way to reject an
// absolute URL, a protocol-relative URL ("//evil.example"), or a
// scheme-prefixed value, all of which would otherwise be a classic open
// redirect. Only ever returns exactly "/app" or a path that is genuinely a
// descendant of "/app/" - not merely a pathname that happens to start with
// the four characters "/app" (which would also accept "/application" or
// "/app-evil").
export function safeNextPath(raw: unknown): string {
  const fallback = "/app";
  if (typeof raw !== "string" || !raw || raw.length > 2048) return fallback;
  if (raw.includes("\\")) return fallback;
  try {
    const resolved = new URL(raw, "http://safe-next-path.invalid");
    if (resolved.origin !== "http://safe-next-path.invalid") return fallback;
    if (resolved.pathname !== "/app" && !resolved.pathname.startsWith("/app/"))
      return fallback;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}
