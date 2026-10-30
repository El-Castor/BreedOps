# Checklist de sortie V1

Porte de sortie reproductible : une seule commande,

```sh
npm run release:check
```

qui exécute, dans l'ordre, et contre une pile Supabase jetable qu'elle démarre et arrête elle-même (jamais la base retenue/production) :

1. `typecheck`, `lint`, `format:check`, `security:client-secrets` (échec rapide avant de payer le coût d'une pile Supabase).
2. `test:unit`.
3. Démarrage d'une pile Supabase locale neuve — migrations `000001` → la plus récente appliquées depuis zéro.
4. Les suites pgTap : RLS (`test:rls`), identité/historique d'élevage (`test:identity`), configuration du phénotypage (`test:phenotyping`), médias (`test:media`), workflows expérimentaux (`test:workflows`), import/export (`test:import-export`), achèvement métier — lots de graines, critères éliminatoires, couverture d'inventaire (`test:business-completion`), limitation des tentatives de connexion (`test:auth-rate-limiting`).
5. `local:configure` puis `build` (nécessaires pour les tests d'intégration et E2E ci-dessous, qui ont besoin d'un serveur réel).
6. Les suites d'intégration Vitest : authentification, élevage, phénotypage, inventaire, opérations.
7. Les tests de bout en bout Playwright (`test:e2e`), qui couvrent le parcours critique complet **et** les tests automatiques d'accessibilité (`e2e/accessibility-smoke.spec.ts`) et de disposition responsive (`e2e/responsive-smoke.spec.ts`).
8. Arrêt de la pile Supabase jetable (toujours exécuté, même si une étape précédente a échoué).

Un résumé final liste explicitement chaque étape avec son statut (`PASS`, `FAIL` ou `SKIPPED (raison)`) — une étape jamais exécutée à cause d'un échec précédent apparaît toujours comme `SKIPPED`, jamais omise silencieusement. Le code de sortie du processus est non nul si une seule étape a échoué.

## Portée couverte

Migrations depuis zéro · tests unitaires · RLS · élevage · phénotypage · achèvement métier · inventaire · workflows · médias · import/export · authentification · intégration · E2E · contrôle automatisé d'accessibilité · contrôle automatisé de disposition responsive · vérification TypeScript · lint · format · build de production · scan des secrets client.

## Ce que cette commande ne remplace pas

- Une revue humaine du code avant fusion.
- Une validation manuelle approfondie de l'accessibilité (clavier réel, lecteur d'écran) — les tests automatisés ci-dessus sont un filet de sécurité contre les régressions, pas une certification WCAG complète.
- Une validation sur la machine réelle de l'utilisateur (Mac mini ou serveur) — cette commande ne s'exécute que sur une infrastructure jetable, jamais sur un déploiement réel.
