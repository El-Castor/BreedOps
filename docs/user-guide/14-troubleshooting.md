# 14 — Troubleshooting

## I cannot sign in

- verify the exact account email;
- wait if repeated failures triggered rate limiting;
- contact an administrator if the account is inactive or has no team.

## A record is missing from a selector

Check whether it is archived or belongs to another programme.

## An analysis says NOT ESTIMABLE

Treat this as information, not a software failure. Read the reason shown by
BreedOps and verify the experimental design/data completeness.

## Offline data will not synchronize

Check:

- network connectivity;
- session validity;
- whether the target record was archived;
- whether programme/trait configuration changed after the offline pack was
  created.

Do not clear browser storage while unsynchronized field operations remain.

## Statistical model fails

An administrator should verify the server-side R health check and `renv`
environment.

## Need administrator help

Provide:

- screen/module;
- programme name/code;
- time of the error;
- exact visible message;
- relevant record code.

Do not send passwords, access tokens or service-role keys.
