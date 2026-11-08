# Administration

Administrators manage user access, application configuration and operational
health.

## Roles

BreedOps uses three application roles:

- `system_admin`;
- `team_admin`;
- `user`.

Use elevated roles only where operationally required.

## User lifecycle

Administrators can create/invite users, assign a team/role, deactivate accounts
and reset credentials through supported workflows.

Do not share administrator accounts.

## Routine checks

Regularly review:

- application health;
- failed login patterns;
- disk space;
- backup completion;
- database/storage health;
- pending upgrades;
- R analytics health.

Sensitive secrets must stay outside Git.
