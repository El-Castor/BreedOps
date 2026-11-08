export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  return origin === expected;
}
