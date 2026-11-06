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
3. **Moteur statistique R V2-05** (durcissement post-revue indépendante, B-review blocker #1) — toujours rapide, sans base de données, suppose R/`renv` déjà installés dans cet environnement (même hypothèse que pour les CLI `supabase`/`docker`, jamais installées par ce script lui-même ; voir `docs/DEPLOYMENT_GUIDE.md` « Moteur statistique R ») : contrôle de santé (`analytics-r/scripts/health_check.R`), les 4 suites de tests de référence numériques (`test_met_base_v1.R`, `test_met_ammi_waasb.R`, `test_met_finlay_wilkinson.R`, `test_met_gge.R` — chacune invoque le vrai sous-processus `met_models.R`, exactement comme `src/lib/met/r-runner.ts`), puis `test:met-r-env` (régression prouvant qu'une variable d'environnement sensible synthétique n'atteint jamais un vrai sous-processus R).
4. Démarrage de la pile Supabase jetable décrite ci-dessus — migrations `000001` → la plus récente appliquées depuis zéro — puis `local:configure`, qui écrit `.local/release-check-backend.json` et déclenche le contrôle d'isolation ci-dessus.
5. Les suites pgTap : RLS (`test:rls`), identité/historique d'élevage (`test:identity`), configuration du phénotypage (`test:phenotyping`), médias (`test:media`), médias avancés (`test:advanced-media`), analytique des traits (`test:trait-analytics`), schéma multi-environnement/G×E (`test:multi-environment`), correspondance héritée emplacement/matériel (`test:legacy-met-mapping`), import MET en masse (`test:met-import`), workflows expérimentaux (`test:workflows`), import/export (`test:import-export`), achèvement métier — lots de graines, critères éliminatoires, couverture d'inventaire (`test:business-completion`), limitation des tentatives de connexion (`test:auth-rate-limiting`), régression du trigger `audit_logs` (`test:audit-logs-cleanup`, migration `000024`), centre de notifications (`test:notifications-rls`).
6. `build`, avec les clés/URL de la pile jetable passées comme variables d'environnement du processus (jamais écrites dans `.env.local`), puis `security:client-secrets` contre ce build.
7. `app:start` (`scripts/start-app.mjs`) : démarre `next start` en arrière-plan sur le port `3117` et attend qu'il réponde — les suites d'intégration ci-dessous font de vraies requêtes HTTP et n'ont, à la différence des specs E2E, aucune logique de démarrage automatique.
8. Les suites d'intégration Vitest : authentification, élevage, phénotypage, inventaire, opérations, QR, notifications, médias avancés, analytique des traits, **analytique multi-environnement/G×E (`test:multi-environment-integration`, qui exécute réellement le moteur R via une vraie requête HTTP sur l'application construite)**.
9. Les tests de bout en bout Playwright (`test:e2e`), qui réutilisent le serveur déjà démarré à l'étape 7 (`reuseExistingServer`) et couvrent le parcours critique complet **et** les tests automatiques d'accessibilité (`e2e/accessibility-smoke.spec.ts`) et de disposition responsive (`e2e/responsive-smoke.spec.ts`), ainsi que `e2e/multi-environment.spec.ts`.
10. `app:stop` puis arrêt et suppression complète de la pile Supabase jetable (tous deux toujours exécutés, même si une étape précédente a échoué).

Un résumé final liste explicitement chaque étape avec son statut (`PASS`, `FAIL` ou `SKIPPED (raison)`) — une étape jamais exécutée à cause d'un échec précédent apparaît toujours comme `SKIPPED`, jamais omise silencieusement. Le code de sortie du processus est non nul si une seule étape a échoué.

## GitHub Actions

Le workflow (`.github/workflows/ci.yml`) réutilise exactement le même mécanisme : ses jobs
`database` et `integration-e2e` positionnent `BREEDOPS_STACK_PROFILE: release-check` au
niveau du job, de sorte que le code testé en CI est le même que celui qu'un développeur
exécute localement via `npm run release:check` — pas un chemin canonique qui ne serait
jamais exercé que sur une machine réelle. Un nouvel exécuteur GitHub Actions n'a de toute
façon aucune pile retenue avec laquelle entrer en conflit, mais cette cohérence évite que
les deux chemins ne divergent avec le temps.

Job dédié **`met-r-engine`** (durcissement post-revue indépendante, B-review blocker #1) :
installe R (`r-lib/actions/setup-r@v2`, épinglé à la version exacte d'`analytics-r/renv.lock`)
et restaure/mets en cache les packages `renv` (`r-lib/actions/setup-renv@v2`,
`working-directory: analytics-r`) sur un exécuteur dédié, puis exécute le contrôle de santé,
les 4 suites de référence R et `test:met-r-env` — exactement ce que `npm run release:check`
exécute localement (étape 3 ci-dessus), avant qu'un GitHub Actions éphémère n'ait jamais eu
R installé. Le job **`integration-e2e`** installe séparément R/`renv` sur son propre
exécuteur, pour la même raison que `met-r-engine` : l'application qu'il démarre invoque le
vrai moteur R pour la suite d'intégration multi-environnement.

## Portée couverte

Migrations depuis zéro · tests unitaires · **moteur statistique R (contrôle de santé, tests de référence numériques, allowlist de l'environnement du sous-processus)** · RLS · élevage · phénotypage · médias avancés · analytique des traits · **multi-environnement/G×E (schéma, correspondance héritée, import)** · achèvement métier · inventaire · workflows · médias · import/export · authentification · intégration (dont multi-environnement, moteur R réel) · E2E (dont multi-environnement) · contrôle automatisé d'accessibilité · contrôle automatisé de disposition responsive · vérification TypeScript · lint · format · build de production · scan des secrets client.

## Ce que cette commande ne remplace pas

- Une revue humaine du code avant fusion.
- Une validation manuelle approfondie de l'accessibilité (clavier réel, lecteur d'écran) — les tests automatisés ci-dessus sont un filet de sécurité contre les régressions, pas une certification WCAG complète.
- Une validation sur la machine réelle de l'utilisateur (Mac mini ou serveur) — cette commande ne s'exécute que sur une infrastructure jetable, jamais sur un déploiement réel.
