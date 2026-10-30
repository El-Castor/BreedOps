# Checklist de sortie V1

Porte de sortie reproductible : une seule commande,

```sh
npm run release:check
```

## Isolation : pourquoi cette commande est sûre même sur la machine de développement

`npm run release:check` démarre et arrête **son propre projet Supabase jetable**, entièrement
distinct de la pile BreedOps retenue (`supabase/config.toml` : `project_id = "BreedOps"`,
port API `55421`, port base `55422`, conteneur `supabase_db_BreedOps`) :

| | Pile retenue (canonique) | Pile jetable (`release:check`) |
| --- | --- | --- |
| `project_id` | `BreedOps` | `BreedOpsReleaseCheck` |
| Port API | `55421` | `55521` |
| Port base de données | `55422` | `55522` |
| Conteneur base de données | `supabase_db_BreedOps` | `supabase_db_BreedOpsReleaseCheck` |
| Répertoire de configuration | `supabase/` (le dépôt) | `.release-check/supabase/` (généré, ignoré par git) |
| Fichier de secrets de test | `.local/test-backend.json` | `.local/release-check-backend.json` |
| Port de l'application | `3107` | `3117` |
| `.env.local` | modifié par `npm run local:configure` | **jamais touché** |

Ce mapping est défini une seule fois dans `scripts/lib/stack-identity.mjs` (deux profils,
`canonical` et `release-check`, sélectionnés par la variable d'environnement
`BREEDOPS_STACK_PROFILE`) et lu par chaque script conscient de la pile
(`db-start.mjs`, `db-stop.mjs`, `configure-local.mjs`, `test-rls.mjs`, les tests
d'intégration, les specs E2E). `npm run release:check` positionne cette variable sur
`release-check` pour tous les processus qu'il lance ; une commande `npm run <script>`
ordinaire ne la positionne jamais et conserve donc son comportement canonique habituel.

Avant toute suite destructive, `scripts/release-check.mjs` relit l'identité réellement
démarrée (`supabase status`) et **abandonne** (`assertStatusMatchesProfile`,
`scripts/lib/stack-identity.mjs`) si elle coïncide avec un seul des axes de la pile
canonique — projet, port API, port base, conteneur, fichier de secrets, ou port
d'application. Ce n'est pas une simple convention documentée : c'est un contrôle de
code qui s'exécute à chaque lancement, avant la moindre suite de tests.

`npm run release:check` n'appelle jamais `supabase db reset` contre le projet canonique,
ni `supabase stop --no-backup`, `docker volume prune`, `docker system prune`, ou toute
autre opération Docker destructrice globale. Il ne lit, ne démarre, n'arrête et ne
modifie jamais le projet `BreedOps` retenu — celui-ci peut rester démarré avant, pendant
et après l'exécution de la commande.

En fin d'exécution (y compris en cas d'échec), `npm run db:stop` arrête le projet jetable
avec `--no-backup` et supprime `.release-check/` : le projet `BreedOpsReleaseCheck` et son
volume Docker n'existent plus. `--no-backup` est délibéré ici précisément parce que ce
projet est jetable — il ne doit **jamais** être utilisé contre le projet canonique, et ne
l'est pas : `db-stop.mjs` ne l'emploie que sous le profil `release-check`.

## Ce que la commande exécute, dans l'ordre

1. `typecheck`, `lint`, `format:check` (échec rapide avant de payer le coût d'une pile Supabase).
2. `test:unit`.
3. Démarrage de la pile Supabase jetable décrite ci-dessus — migrations `000001` → la plus récente appliquées depuis zéro — puis `local:configure`, qui écrit `.local/release-check-backend.json` et déclenche le contrôle d'isolation ci-dessus.
4. Les suites pgTap : RLS (`test:rls`), identité/historique d'élevage (`test:identity`), configuration du phénotypage (`test:phenotyping`), médias (`test:media`), workflows expérimentaux (`test:workflows`), import/export (`test:import-export`), achèvement métier — lots de graines, critères éliminatoires, couverture d'inventaire (`test:business-completion`), limitation des tentatives de connexion (`test:auth-rate-limiting`).
5. `build`, avec les clés/URL de la pile jetable passées comme variables d'environnement du processus (jamais écrites dans `.env.local`), puis `security:client-secrets` contre ce build.
6. `app:start` (`scripts/start-app.mjs`) : démarre `next start` en arrière-plan sur le port `3117` et attend qu'il réponde — les suites d'intégration ci-dessous font de vraies requêtes HTTP et n'ont, à la différence des specs E2E, aucune logique de démarrage automatique.
7. Les suites d'intégration Vitest : authentification, élevage, phénotypage, inventaire, opérations.
8. Les tests de bout en bout Playwright (`test:e2e`), qui réutilisent le serveur déjà démarré à l'étape 6 (`reuseExistingServer`) et couvrent le parcours critique complet **et** les tests automatiques d'accessibilité (`e2e/accessibility-smoke.spec.ts`) et de disposition responsive (`e2e/responsive-smoke.spec.ts`).
9. `app:stop` puis arrêt et suppression complète de la pile Supabase jetable (tous deux toujours exécutés, même si une étape précédente a échoué).

Un résumé final liste explicitement chaque étape avec son statut (`PASS`, `FAIL` ou `SKIPPED (raison)`) — une étape jamais exécutée à cause d'un échec précédent apparaît toujours comme `SKIPPED`, jamais omise silencieusement. Le code de sortie du processus est non nul si une seule étape a échoué.

## GitHub Actions

Le workflow (`.github/workflows/ci.yml`) réutilise exactement le même mécanisme : ses jobs
`database` et `integration-e2e` positionnent `BREEDOPS_STACK_PROFILE: release-check` au
niveau du job, de sorte que le code testé en CI est le même que celui qu'un développeur
exécute localement via `npm run release:check` — pas un chemin canonique qui ne serait
jamais exercé que sur une machine réelle. Un nouvel exécuteur GitHub Actions n'a de toute
façon aucune pile retenue avec laquelle entrer en conflit, mais cette cohérence évite que
les deux chemins ne divergent avec le temps.

## Portée couverte

Migrations depuis zéro · tests unitaires · RLS · élevage · phénotypage · achèvement métier · inventaire · workflows · médias · import/export · authentification · intégration · E2E · contrôle automatisé d'accessibilité · contrôle automatisé de disposition responsive · vérification TypeScript · lint · format · build de production · scan des secrets client.

## Ce que cette commande ne remplace pas

- Une revue humaine du code avant fusion.
- Une validation manuelle approfondie de l'accessibilité (clavier réel, lecteur d'écran) — les tests automatisés ci-dessus sont un filet de sécurité contre les régressions, pas une certification WCAG complète.
- Une validation sur la machine réelle de l'utilisateur (Mac mini ou serveur) — cette commande ne s'exécute que sur une infrastructure jetable, jamais sur un déploiement réel.
