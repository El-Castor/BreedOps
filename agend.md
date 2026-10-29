# agend.md — BreedOps operational roadmap and state index

> This file tracks the operational roadmap and last reconciled project state.
> It is not authoritative over executable repository evidence.
>
> When this file conflicts with current code, tests, migrations or observed
> outputs, repository evidence prevails and this file must be reconciled.

---

## 4.1 Informations générales

- **Nom du projet**: BreedOps
- **Objectif**: Application web sécurisée de gestion d'un programme d'amélioration végétale et de floriculture (MVP couvrant 5 modules).
- **Stack retenue**:
  - Frontend: Next.js (App Router), TypeScript strict, React, Tailwind CSS, React Hook Form, Zod, TanStack Table, Recharts, date-fns.
  - Backend/données: Supabase, PostgreSQL, Supabase Auth, Row-Level Security, migrations SQL versionnées, fonctions PostgreSQL pour les calculs critiques.
  - Qualité: ESLint, Prettier, Vitest, Playwright, `tsc --noEmit` strict, GitHub Actions CI si dépôt GitHub.
- **État actuel**: MVP pilote PASS. Les cinq domaines utilisent PostgreSQL réel; le shell partagé, les prérequis guidés, le pedigree interactif et les parcours Playwright de production sont validés.
- **Date de dernière mise à jour**: 2026-10-06
- **Version cible**: MVP V1
- **Environnement concerné**: Développement local (aucun projet Supabase lié, aucune CI; dépôt distant GitHub configuré).
- **Liens utiles vers la documentation interne**: `docs/architecture.md`, `docs/database.md`; `docs/security.md`, `docs/user-guide.md` et `docs/deployment.md` restent à créer.

---

## État actuel du dépôt (vérifié le 2026-09-12 par shell)

- Répertoire de travail: `/Users/clpichot/Documents/Perso/PROJECTS-PERSO/INFO/BreedOps`
- Fichiers présents: spécification et processus, manifeste et lockfile npm, configurations TypeScript/ESLint/Tailwind, `.env.example`, deux documents techniques, configuration Supabase, seed et quatre migrations SQL.
- **Dépôt Git**: initialisé sur `main`, avec le remote `origin` vers `https://github.com/El-Castor/BreedOps.git` et deux commits locaux.
- **Code source**: trois fichiers App Router (layout, page et styles). La page contient une démonstration client avec localStorage, comptes et données synthétiques. Aucun serveur métier connecté ni fichier de test dans les répertoires source inspectés.
- **Dépendances**: installées avec npm; `package-lock.json` version 3 est présent. Les versions incompatibles ou inexistantes du manifeste ont été corrigées sans changer la stack retenue.
- **Outillage local**: Node 20.20.2 et npm 10.8.2 revérifiés dans Conda `breedops-dev`. Les résultats antérieurs de build/types/lint ne constituent pas une validation V1 actuelle; ces contrôles n'ont pas été relancés pendant la réconciliation.
- **Migrations / schéma**: quatre migrations locales (schéma, RLS initiales, autorisation équipe, calculs métier). Application depuis zéro et RLS non vérifiées. `000003` limite les rôles à `system_admin`, `team_admin`, `user` et retire `program_members`.
- **Configuration**: `.env.example`, TypeScript, ESLint, Tailwind et le shell Next.js sont présents. Le build de production réussit; le maintien du serveur de développement n'a pas pu être vérifié dans cette exécution, le processus étant arrêté par le lanceur avant le contrôle HTTP.
- **Documentation**: `docs/architecture.md` et `docs/database.md` existent; les guides sécurité, déploiement et utilisateur sont absents.
- **Supabase**: Docker accessible; aucun conteneur BreedOps actif observé. Les autres stacks existantes ne sont pas un environnement de test BreedOps. Aucun démarrage ni migration exécutés pendant cette réconciliation; disponibilité effective d'une nouvelle stack non testée.

### Jalon V1.0 / entrée V1.1 — 2026-09-12 — HOLD

- **Objectif**: identifier le premier parcours V1 incomplet sans modifier les travaux préexistants.
- **Résultat**: l'authentification réelle est le premier jalon incomplet. Le worktree contient de nombreux fichiers applicatifs non suivis et des modifications préexistantes de `CLAUDE.md` et `agend.md`; ils sont conservés.
- **Blocage décisionnel**: le brief V1 du jour exige au minimum administrateur, program_manager, technician, analyst et viewer. La décision acceptée du 2026-09-07 et la migration 000003 imposent trois rôles et aucun rattachement par programme. Clarifier le modèle et ses permissions avant toute modification de sécurité, conformément au brief §16 et AGENTS.md §27.
- **Validation exécutée**: racine Git, branche main, état du worktree, dix derniers commits disponibles (deux présents), inventaire ciblé du code/migrations, versions Node/npm, disponibilité Docker et contexte Basic Memory. Aucun test applicatif, build, E2E ou migration exécuté; aucun PASS V1 revendiqué.
- **Dette documentaire observée**: architecture et CLAUDE.md décrivent encore les anciens rôles; la directive mémoire cite CLAUDE.md comme source détaillée et le précédent checkpoint contient des séquences littérales de nouvelle ligne. Ne pas réécrire l'historique ni trancher le modèle implicitement.
- **Prochaine action exacte**: obtenir le choix du modèle d'autorisation; ensuite valider une stack Supabase BreedOps isolée et implémenter V1.1 avec tests négatifs serveur/RLS.
- **Git**: aucun commit de fonctionnalité (jalon HOLD), aucun push; modifications de cette session limitées à cette réconciliation documentaire.

Conclusion: la fondation locale est en place, mais le projet n'est pas encore exécutable ni validé. Les cases cochées signifient qu'un artefact local existe; elles ne signifient pas une validation d'exécution ou de sécurité.

---

## 4.2 Principes d’architecture

> Renseignés au fur et à mesure. État initial: à définir en Phase 0/1.

- **Architecture frontend**: Next.js App Router, `src/` dir, Server Components par défaut, Client Components pour l'interactivité, Server Actions pour les mutations, Supabase SSR pour la session.
- **Architecture backend**: Supabase (Postgres + Auth + Storage), migrations versionnées dans `supabase/migrations/`, fonctions PostgreSQL pour les calculs métier sensibles (germination, rendement, score pondéré/normalisé, décision, stock, retard).
- **Stratégie d’authentification**: Supabase Auth, session persistée côté serveur via cookies `HttpOnly`/`Secure`/`SameSite`, réinitialisation de mot de passe, MFA prévu dans l'architecture.
- **Stratégie d’autorisation**: triple couche (UI, serveur, RLS). Une organisation représente une équipe; chaque utilisateur est rattaché à une équipe. RLS isole les données par équipe. Les rôles MVP sont `system_admin`, `team_admin` et `user`; aucun rôle ou rattachement par programme n'est prévu.
- **Modèle de données**: modèle relationnel normalisé conforme à `PROMPT.md` §5 et §7–§10. Toutes les tables principales portent `id`(UUID), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `organization_id`, `program_id` le cas échéant.
- **Stratégie de migrations**: une migration par fichier, séquentielle, jamais modifiée après application, testée sur base vide.
- **Stratégie de tests**: Vitest (unité + intégration), Playwright (E2E), tests RLS dédiés, CI quand le dépôt est hébergé.
- **Stratégie de déploiement**: Vercel/autre + Supabase.
- **Stratégie de sauvegarde**: sauvegarde fonctionnelle par export; sauvegarde Supabase/Postgres à configurer côté hébergement.
- **Stratégie d’import et d’export**: import du classeur Excel existant (`PROMPT.md` §12), idempotent via codes métier, transactionnel, avec prévisualisation et rapport d'erreurs; export CSV/Excel + sauvegarde fonctionnelle.

---

## 4.3 Roadmap

### Phase 0 — Audit et initialisation

- [x] Inspecter le dépôt
- [x] Identifier la stack existante
- [x] Installer et vérifier les dépendances
- [x] Configurer TypeScript strict
- [x] Finaliser et vérifier ESLint et Prettier
- [x] Créer `.env.example`
- [x] Créer la structure documentaire
- [x] Définir les conventions de nommage
- [x] Définir les conventions Git
- [x] Vérifier que les secrets ne sont pas versionnés

### Phase 1 — Architecture et base de données

- [x] Définir le schéma relationnel
- [x] Créer les migrations initiales
- [x] Créer les contraintes et index
- [x] Compléter les fonctions de calcul métier (voir audit complet dans le journal de session « Business Completion » ; une limitation connue, non nouvelle, subsiste — voir dette technique TD-eliminatory-stability)
- [x] Créer les politiques RLS
- [ ] Créer les données de démonstration
- [x] Tester les migrations sur une base vide
- [x] Documenter les relations entre tables

### Phase 2 — Authentification et rôles

- [x] Connexion
- [x] Déconnexion
- [x] Gestion de session
- [x] Réinitialisation du mot de passe
- [x] Protection des routes
- [x] Gestion des rôles V1 (`system_admin`, `team_admin`, `user`)
- [x] Accès aux programmes hérité de l'équipe (pas de membres de programme en V1)
- [x] Vérification des politiques RLS
- [x] Journalisation des actions sensibles de gestion utilisateur

### Phase 3 — Registre des croisements et lots

- [x] Référentiel des parents et lignées
- [x] Création d’un croisement
- [x] Modification contrôlée d’un croisement
- [x] Création d’une famille
- [x] Création d’un lot de graines
- [x] Test de germination
- [x] Calcul automatique du taux de germination
- [x] Calcul du rendement par unité pollinisée
- [x] Gestion du statut du lot
- [x] Recherche par code et tri des registres
- [x] Export CSV ou Excel
- [ ] Historique des modifications (partiel — voir journal de session « Business Completion » : la seule mutation sensible nouvellement introduite, le changement de statut du lot, est auditée ; un historique générique rétroactif pour toutes les mutations d'élevage existantes reste hors V1, voir dette technique)

### Phase 4 — Notation phénotypique

- [x] Création d’un individu
- [x] Création d’un modèle de notation
- [x] Configuration des coefficients
- [x] Saisie des notes
- [x] Calcul du score pondéré
- [x] Normalisation sur 100
- [x] Classement des individus
- [x] Décision automatique
- [x] Gestion des critères éliminatoires
- [x] Comparaison des individus
- [x] Export de la matrice de sélection

### Phase 5 — Inventaire

- [x] Référentiel des articles
- [x] Gestion des lots de réactifs et consommables
- [x] Gestion des équipements
- [x] Réception de stock
- [x] Consommation de stock
- [x] Ajustement avec justification
- [x] Historique des mouvements
- [x] Calcul de la couverture estimée
- [x] Alerte de stock minimal
- [x] Alerte de péremption
- [x] Recherche par CAS, lot ou emplacement
- [x] Export de l’inventaire

### Phase 6 — Calendrier et Gantt

- [x] Création de modèles de cycles
- [x] Génération automatique des tâches
- [x] Affectation des responsables
- [x] Gestion des statuts
- [x] Gestion des priorités
- [x] Calcul des retards
- [x] Contrôle SOP
- [x] Vue tableau
- [x] Vue calendrier
- [x] Vue Gantt
- [x] Filtres par programme, zone et responsable

### Phase 7 — Tableau de bord et alertes

- [x] KPI des croisements
- [x] KPI de germination
- [x] KPI de sélection phénotypique
- [x] KPI d’inventaire
- [x] KPI du calendrier
- [x] Alertes de stock
- [x] Alertes de péremption
- [x] Alertes de retard
- [x] Graphiques
- [x] Filtres par programme et campagne

### Phase 8 — Import et export

- [x] Définir le format d’import
- [x] Mapper les colonnes du classeur Excel
- [x] Prévisualiser les données avant import
- [x] Valider les données
- [x] Produire un rapport d’erreurs
- [x] Import transactionnel (code complet et validé sur stack jetable from-zero ; application sur la base retenue en attente, voir journal de session ci-dessous)
- [x] Export CSV
- [x] Export Excel
- [x] Export d’une sauvegarde fonctionnelle

### Phase 9 — Sécurité et audit

- [x] Vérifier les politiques RLS du périmètre V1
- [x] Vérifier les permissions côté serveur
- [x] Protéger les Server Actions et routes API
- [x] Configurer les cookies sécurisés
- [x] Configurer les en-têtes de sécurité
- [x] Configurer une Content Security Policy
- [x] Vérifier les risques XSS
- [x] Vérifier les risques d’injection
- [x] Vérifier les risques CSRF
- [ ] Limiter les tentatives de connexion
- [x] Instrumenter le journal d’audit pour la gestion utilisateur
- [x] Tester la séparation entre utilisateurs

### Phase 10 — Tests et stabilisation

- [x] Tests unitaires
- [x] Tests des calculs métier
- [x] Tests des formulaires
- [x] Tests des politiques RLS
- [x] Tests d’intégration
- [x] Tests end-to-end
- [ ] Tests d’accessibilité
- [ ] Tests responsive
- [x] Tests d’import
- [x] Tests d’export
- [x] Vérification des erreurs TypeScript
- [x] Vérification du build de production

### Phase 11 — Documentation et livraison

- [x] README
- [x] Guide d’installation
- [x] Guide Supabase
- [x] Guide des migrations
- [ ] Guide de déploiement
- [ ] Guide administrateur
- [ ] Guide utilisateur
- [x] Description du modèle de données
- [x] Description des rôles
- [ ] Description des sauvegardes
- [x] Liste des limites du MVP
- [x] Roadmap V2

---

## 4.4 Journal de décisions

| Date | Décision | Justification | Impact | Statut |
| ---- | -------- | ------------- | ------ | ------ |
| 2026-08-09 | Adopter la stack recommandée par `PROMPT.md` §2 | Conformité à la consigne, cohérence d'écosystème | Base de toute l'implémentation | Décidée |
| 2026-08-09 | Mémoriser la séparation `PROMPT.md` / `CLAUDE.md` / `agend.md` | Éviter la confusion des rôles des fichiers | Processus de travail | Décidée |
| 2026-08-21 | Créer la structure de base du projet | Initialisation complète du dépôt avec configuration et schéma | Base de l'implémentation | Décidée |
| 2026-09-07 | Réconcilier la roadmap avec l'état local | Les états Git, dépendances, documentation, migrations et validation d'exécution divergeaient de la roadmap | Les éléments non vérifiés restent ouverts; les décisions de sécurité restent à approuver | Décidée |
| 2026-10-06 | Codes BreedOps générés par PostgreSQL (`PROGRAMCODE-{P,X,F,L,I}-NNNN`) | Les codes saisis à la main servaient d’identifiant unique mais étaient compris comme du texte libre (doublons, erreurs) | UUID inchangés; trigger `BEFORE INSERT`, compteur par programme/type sous verrou consultatif; codes immuables; codes historiques conservés | Décidée |
| 2026-10-06 | Archivage = `deleted_at` existant, réversible; pas de suppression physique | Le soft delete existait déjà; la lignée scientifique doit rester traçable | Lecture RLS étendue aux archivés du programme; triggers de lignée refusent toujours les archivés pour les nouvelles relations | Décidée |
| 2026-10-06 | Inspecteur d’entité unique partagé registres/pedigree | Éviter deux interfaces de détail divergentes | `EntityInspectorWorkspace` + `buildBreedingEntityDetails` | Décidée |
| 2026-10-06 | Système de design BreedOps canonique (`docs/DESIGN_SYSTEM.md`) | Interface CRUD générique et styles accumulés sans tokens | Tokens CSS uniques, shell, composition de page, registres et inspecteur normalisés | Décidée |
| 2026-10-06 | Provenance des lignées : `accession` et `source` (000015), rendement par `program_cross_yields` | Enrichir les fiches sans ontologie lourde ni champ JSON fourre-tout | Colonnes nullable additives ; rendement toujours calculé par PostgreSQL, y compris pour un croisement archivé | Décidée |

---

## 4.5 Problèmes et blocages

| ID | Problème | Gravité | Contournement | Action requise | Statut |
| -- | -------- | ------- | ------------- | -------------- | ------ |
| B-001 | Aucun projet Supabase hébergé lié | Non bloquant pour V1 locale | Stack Supabase locale isolée et reproductible sur ports 55420–55429 | Provisionner un hébergement seulement au déploiement | Reporté |
| B-002 | Dépôt Git et remote GitHub | Résolu | Dépôt local initialisé, deux commits présents et `origin` configuré | Aucune | Résolu |
| B-003 | Modèle d'accès V1 à trois rôles | Résolu | Migration 000005 durcie, 21 assertions RLS et parcours E2E réel passent | Aucune pour V1; rôles fins reportés après V1 | Résolu |
| B-004 | Runtime Node.js/npm | Résolu pour l'environnement Conda `breedops-dev` | Node 20.20.2 et npm/npx 10.8.2 permettent l'installation et les validations | Utiliser `breedops-dev` pour les commandes JavaScript | Résolu |

---

## 4.6 Dette technique

| ID | Élément | Risque | Priorité | Version cible | Statut |
| -- | ------- | ------ | -------- | ------------- | ------ |
| TD-001 | Les mutations pilotées rechargent la route courante après succès afin d’éviter le blocage RSC observé avec `useActionState` sur le build de production | Faible: navigation plus coûteuse, données immédiatement relues depuis PostgreSQL | P2 | Post-MVP | Accepté |
| TD-002 | `npm audit` conserve 7 avis high et 2 moderate dans les chaînes Tailwind/ESLint de build | Faible pour le runtime; les correctifs proposés imposent Tailwind 4 ou une régression majeure d’ESLint/Next | P2 | Maintenance | Surveillé |
| TD-003 | Sur `/app/breeding`, la navigation client Next.js 15.5 limitée à la query string (`?archived=1`) est interrompue silencieusement en production; le bouton d’archives utilise une navigation document | Faible: rechargement complet sur ce lien; autres liens inchangés | P3 | Mise à niveau Next/React | Contourné |
| TD-004 | Images de plantes: section inspecteur prête mais sans stockage (Supabase Storage + métadonnées non implémentés) | Fonctionnalité absente, aucune donnée factice | P2 | Jalon médias | Ouvert |

---

## 4.7 Critères d’acceptation

> Critères MVP issus de `PROMPT.md` §19. Ne cocher que lorsqu’ils sont vérifiés.

- [ ] Un utilisateur peut se connecter
- [ ] Les rôles sont appliqués
- [ ] Les routes sont protégées
- [ ] Les politiques RLS sont testées
- [ ] Un programme peut être créé
- [ ] Des parents peuvent être créés
- [ ] Un croisement peut être créé
- [ ] Une famille et un lot peuvent être créés
- [ ] Un test de germination peut être enregistré
- [ ] Les calculs sont corrects
- [ ] Un phénotype peut être évalué
- [ ] Le score et la décision sont calculés
- [ ] Un article d’inventaire peut être créé
- [ ] Un lot de stock peut être réceptionné
- [ ] Un mouvement peut être enregistré
- [ ] Les stocks sont recalculés correctement
- [ ] Les alertes de stock et de péremption fonctionnent
- [ ] Un cycle expérimental peut être créé
- [ ] Des tâches peuvent être générées
- [ ] Les retards sont calculés
- [ ] Le calendrier et le Gantt sont utilisables
- [ ] Le tableau de bord affiche des KPI réels
- [ ] L’import Excel fonctionne sur un fichier conforme
- [ ] L’export fonctionne
- [ ] Le journal d’audit fonctionne
- [ ] Les tests passent
- [ ] Le build de production réussit
- [ ] Aucune erreur TypeScript bloquante n’existe
- [ ] La documentation est complète
- [ ] `agend.md` reflète fidèlement l’état réel du projet

### Critères d’acceptation par module (à détailler au fil de l’implémentation)

- [ ] Module 1 — Authentification et rôles
- [ ] Module 2 — Registre des croisements et lots
- [ ] Module 3 — Notation phénotypique
- [ ] Module 4 — Inventaire et mouvements
- [ ] Module 5 — Calendrier, alertes, Gantt et tableau de bord

---

## 4.8 Compte rendu de progression

### Session 2026-08-09 (initialisation)

- **Tâches terminées**: vérification de l'état réel du dépôt; lecture complète de `PROMPT.md`; création de `CLAUDE.md` et `agend.md`.
- **Fichiers modifiés/créés**: `CLAUDE.md`, `agend.md`.
- **Migrations ajoutées**: aucune.
- **Tests exécutés**: aucun (aucun test ni exécutable présent).
- **Résultats des tests**: N/A.
- **Décisions prises**: adoption de la stack recommandée; séparation des trois fichiers racine.
- **Problèmes restants**: B-001 (Supabase manquant), B-002 (Git non initialisé).
- **Prochaine étape recommandée**: Phase 0 — Audit et initialisation (scaffolding Next.js + configs + `.env.example` + structure documentaire), sans nécessiter de clés Supabase.

### Session 2026-09-07 (réconciliation de la roadmap)

- **Tâches terminées**: comparaison de la roadmap avec le worktree, sans exécuter de migrations ni modifier les composants applicatifs.
- **État confirmé**: dépôt Git et remote existants; `package.json`, configurations locales, deux migrations Supabase et deux documents techniques présents; pas de code dans `src/`, pas de tests, pas de dépendances installées, pas de runtime Node.js/npm disponible dans le `PATH` et pas d'environnement Supabase.
- **Décisions restant à approuver**: aucune pour le périmètre V1 local. Les décisions d'hébergement, de bootstrap initial en production et de rôles fins seront requises avant un déploiement public.
- **Prochaine étape recommandée**: préparer V1.1 post-livraison avec audit des actions sensibles et durcissement opérationnel avant hébergement.

### Session 2026-09-07 (fondation applicative)

- **Tâches terminées**: installation des dépendances, génération de `package-lock.json`, correction des définitions de paquets incompatibles ou inexistantes, ajout du shell Next.js App Router minimal et migration du script de lint vers ESLint CLI.
- **Validation**: `npx tsc --noEmit`, `npm run lint`, `npm run format:check` et `npm run build` passent dans `breedops-dev` (Node 20.20.2). Le build utilise un repli WebAssembly après échec de chargement du binaire SWC natif; il termine avec succès.
- **Statut du jalon**: HOLD. Le build est validé mais le lanceur de cette session arrête le serveur de développement avant le contrôle HTTP; aucun test automatisé, migration ou test RLS n'a été exécuté.
- **Prochaine étape recommandée**: vérifier le démarrage dans un terminal Conda interactif, puis obtenir les décisions d'autorisation et de suppression avant toute modification RLS ou implémentation d'authentification.

### Session 2026-09-07 (décision d'autorisation MVP)

- **Décision validée**: une organisation est une équipe; chaque compte utilisateur est rattaché à une équipe; `system_admin` gère l'application, `team_admin` gère son équipe et les autres comptes sont `user`.
- **Périmètre**: les programmes et les données métier sont portés par l'équipe; aucun rôle ni membre par programme dans le MVP. Les suppressions fonctionnelles seront souples.
- **Prochaine étape recommandée**: aligner le schéma et les politiques RLS sur ce modèle, puis les appliquer et les tester sur Supabase local.

### Session 2026-09-07 (migration d'autorisation MVP)

- **Tâches terminées**: ajout de `supabase/config.toml` avec des ports locaux isolés (`55420`–`55429`) et de la migration additive `000003_simplify_team_authorization.sql`.
- **Contenu**: le modèle `program_members` est retiré, les rôles sont réduits à `system_admin`, `team_admin` et `user`, les enregistrements métier reçoivent `deleted_at`, et les politiques RLS sont remplacées par une isolation par équipe sans politique `DELETE`.
- **Validation statique**: `git diff --check` passe; la migration définit 63 politiques `SELECT`/`INSERT`/`UPDATE` et aucune politique `DELETE`.
- **Statut du jalon**: HOLD. Le CLI Supabase temporaire et Docker sont disponibles, mais les services Docker déjà actifs empêchent de démarrer une seconde stack BreedOps dans un délai raisonnable; aucune migration n'a été appliquée et aucun conteneur BreedOps n'a été créé.
- **Prochaine étape recommandée**: démarrer la stack locale isolée lorsque Docker est disponible, exécuter les migrations sur base vide et ajouter les tests RLS inter-équipe avant l'interface d'authentification.

### Session 2026-09-07 (interface MVP de démonstration)

- **Tâches terminées en mode démonstration**: écran de connexion/déconnexion/session locale, rôles équipe, tableau de bord, registre de croisements, notation, inventaire, calendrier/Gantt, import CSV, exports CSV et gestion des comptes équipe.
- **Validation**: TypeScript, ESLint et vérification des diffs passent. Le build Next a été interrompu par `SIGKILL` dans le lanceur avant sa fin, sans erreur de compilation applicative.
- **Important**: les cases d'acceptation de production restent ouvertes tant que la stack Supabase, les migrations, l'authentification réelle et les tests RLS ne sont pas validés. L'accès par membres de programme est remplacé par le modèle approuvé d'accès par équipe.

### Session 2026-09-12 — V1.1 authentification et autorisation — PASS

- **Implémentation**: connexion/déconnexion Supabase Auth; session en cookies HttpOnly; middleware de renouvellement; route `/app` protégée côté serveur; profil actif et équipe obligatoires; rôles `system_admin`, `team_admin`, `user`; actions serveur profil/équipe revérifiant identité et rôle; aucune clé service-role dans le runtime. L'ancienne démo localStorage est déplacée sous `src/demo/` et n'est plus routée.
- **Migration**: `000005_guard_profile_identity.sql` rend le lien `profiles.user_id` immuable, conserve le rôle lors d'une mise à jour personnelle, empêche un team_admin de modifier un administrateur privilégié et révoque l'accès RPC aux fonctions de calcul `SECURITY DEFINER` réservées aux triggers.
- **Base vide**: `supabase db reset` applique 000001 à 000005 avec succès; seed métier désactivé par défaut.
- **Validation**: 9/9 tests unité/serveur; 17/17 assertions RLS; 9/9 tests HTTP sur build production (anonyme, origine, identifiants invalides, connexion, cookies, persistance, actions autorisées, révocation rôle/appartenance, déconnexion); TypeScript, ESLint et format passent; build production passe; `npm audit` rapporte 0 vulnérabilité.
- **Limites non bloquantes**: avertissements Edge de Supabase durant le build, sans échec des tests HTTP; Playwright absent du dépôt, donc validation HTTP réelle utilisée. Réinitialisation de mot de passe et audit fonctionnel restent ouverts hors gate V1.1.
- **Prochaine étape exacte**: V1.2 — connecter parents → croisement → famille → lot → test de germination à PostgreSQL avec actions serveur, recherche et tests.

### Session 2026-09-13 — V1.2 croisements, familles et lots — PASS

- **Implémentation**: création/sélection de programme; registre de lignées; création et modification contrôlée des croisements; création de familles et lots; test de germination; vues relationnelles et recherche de croisement. Toutes les écritures passent par des Server Actions authentifiées puis RLS.
- **Migrations**: 000006 ajoute les champs obligatoires et contraintes de comptage, parents distincts, quantités positives et cohérence de germination; 000007 sépare les triggers de validation de lignage par table après détection déterministe d'un défaut du trigger générique.
- **Calculs**: `germination_rate` est une colonne PostgreSQL générée; rendement affiché à partir des entrées persistées et la fonction PostgreSQL autoritative existante reste disponible côté serveur.
- **Validation**: reconstruction depuis zéro 000001–000007 réussie; 7/7 tests HTTP du parcours métier; suite complète 25/25; RLS 17/17; TypeScript, ESLint, Prettier et build production passent. Données de test synthétiques, aléatoires et nettoyées après chaque suite.
- **Prochaine étape exacte**: V1.3 — notation phénotypique configurable, scores persistés, calcul PostgreSQL et classement.

### Session 2026-09-13 — V1.3 notation phénotypique — PASS

- **Implémentation**: registre de phénotypes lié aux familles et lots; création transactionnelle du modèle initial et de ses six critères/règles; modification des coefficients avec recalcul du maximum; saisie atomique de toutes les notes; score pondéré, normalisation et décision calculés par PostgreSQL; classement persistant dans l'application.
- **Migrations**: 000008 ajoute les contraintes, la validation de lignage et les RPC transactionnelles sous RLS; 000009 corrige de façon additive les colonnes `updated_at` absentes sur trois tables qui possédaient déjà un trigger de mise à jour depuis 000001.
- **Calculs**: modèle initial 130 points et règles Elite/Advance/Reserve/Eliminate stockés en base. Les quatre seuils sont couverts avec un modèle reconfiguré à 140 points, ce qui prouve que l'application utilise les coefficients et règles persistés.
- **Validation**: reconstruction depuis zéro 000001–000009 réussie; 8/8 tests HTTP phénotypiques; suite complète 33/33; RLS 17/17; TypeScript, ESLint, Prettier et build production passent; audit npm 0 vulnérabilité.
- **Dette**: critères éliminatoires spécialisés, export de matrice et vue de comparaison avancée restent différés; le classement V1 couvre la comparaison opérationnelle requise.
- **Prochaine étape exacte**: V1.4 — articles et lots d'inventaire, mouvements transactionnels, stock courant, seuils/péremption et historique.

### Session 2026-09-13 — V1.4 inventaire et mouvements — PASS

- **Implémentation**: registre d'articles par équipe; lots avec réception initiale obligatoire; réceptions, consommations, retours, destructions et ajustements justifiés; stock courant dérivé des mouvements; historique; recherche article/CAS/référence/lot/emplacement; alertes de seuil et de péremption issues de la vue PostgreSQL.
- **Migration**: 000010 renforce les contraintes et dates, ajoute deux RPC transactionnelles, verrouille le lot pendant un mouvement, refuse un stock négatif, attribue l'acteur authentifié et interdit l'insertion directe de mouvements aux rôles client.
- **Validation**: reconstruction depuis zéro 000001–000010 réussie; 4/4 tests HTTP inventaire; suite complète 37/37; RLS étendue 19/19; TypeScript, ESLint, Prettier et build production passent. Réception 100, consommation 30 et stock final 70 vérifiés; ajustement sans motif et surconsommation refusés sans écriture partielle.
- **Dette**: équipements spécialisés, couverture estimée et export d'inventaire restent différés hors du parcours V1 essentiel.
- **Prochaine étape exacte**: V1.5 — cycle expérimental, tâches assignées, statuts/dates/retards, vues liste/calendrier et tableau de bord agrégé.

### Session 2026-09-13 — V1.5 opérations et tableau de bord — PASS

- **Implémentation**: création de cycles expérimentaux datés; tâches liées au cycle/programme, assignées à un membre actif, avec priorité, dates, statut et retard; transition de statut cohérente; vues liste et calendrier; tableau de bord des neuf KPI V1 et alertes opérationnelles.
- **Migration**: 000011 ajoute les contraintes de dates/statuts/priorités, valide cycle/programme et responsable, assure la cohérence `completed_at`, et expose les neuf agrégats persistés par une fonction PostgreSQL sous RLS.
- **Validation**: reconstruction depuis zéro 000001–000011 réussie; 3/3 tests HTTP opérations/KPI; suite complète 40/40; RLS étendue 21/21; TypeScript, ESLint, Prettier, build production et audit npm passent. Un cycle, une tâche en retard, son affectation, son achèvement, le passage 0→100 % et la vue calendrier sont vérifiés.
- **Dette**: modèles automatiques de cycles, checklist/SOP, Gantt et filtres avancés restent différés; ces extensions ne bloquent pas le parcours V1 calendrier/liste.
- **Prochaine étape exacte**: V1.6 — parcours E2E critique unique, gate complet final, documentation et commit V1 local.

### Session 2026-09-13 — V1.6 gate final — PASS

- **Parcours critique**: Playwright Chromium exécute via l'interface réelle connexion → programme → deux parents → croisement → famille → lot → germination 92 % → phénotype → notation Elite → article/lot d'inventaire → réception/consommation et stock 80 → cycle/tâche en retard → achèvement → neuf KPI mis à jour → déconnexion.
- **Base et sécurité**: reconstruction propre 000001–000011 réussie; RLS 21/21, y compris anonymat, isolement inter-équipe, élévation de rôle, identité, RPC inventaire, KPI et tâches. Aucun secret suivi détecté; audit npm: 0 vulnérabilité.
- **Validation finale**: Vitest 40/40 dans 7 fichiers; Playwright 1/1; TypeScript, ESLint, Prettier et build Next.js production passent. Documentation et état opérationnel réconciliés avec le code.
- **Git**: cinq commits de modules V1 validés précèdent le commit final; aucun push distant effectué. Les fichiers locaux non liés `.beads*`, `.serena/` et la trace Serena restent intacts et hors commit.
- **Statut V1**: PASS.
- **Prochaine étape exacte**: V1.1 post-livraison — instrumenter le journal d'audit des actions sensibles et ajouter sa rétention/consultation sous RLS avant tout déploiement hébergé.

### Session 2026-09-20 — Authentification et gestion utilisateurs V1 — PASS

- **Objectif**: réparer le compte administrateur local et livrer login, reset, invitation, gestion des utilisateurs, profil, signup pending et audit avec les trois rôles approuvés.
- **Implémentation validée**: lecteur de secret compatible saisie/collage avec restauration terminal; provisioning idempotent; reset local vérifié par login Supabase; origine canonique `http://localhost:3107`; login/logout et middleware sans page technique brute; invitation/création/activation/désactivation/rôle/équipe/reset sous contrôle serveur; profil; forgot/reset; signup désactivé par défaut et compte pending sans profil; audit utilisateur instrumenté.
- **Compte retenu**: `clementpch@gmail.com` confirmé, profil `system_admin` actif dans `nad`; reset réel réussi, login direct Supabase et login/logout Chromium réussis; `last_sign_in_at` observé `2026-09-20 14:45:34.946162+00`.
- **Base/RLS**: migrations `000012_auth_user_management.sql` et `000013_team_admin_password_reset_audit.sql`; application non destructive sur la base retenue et application 000001–000013 depuis zéro dans une seconde stack jetable; RLS 25/25, dont pending sans accès et audit non forgeable par un utilisateur ordinaire.
- **Validation**: Vitest 47/47; Playwright principal 3 PASS + 1 SKIP conditionnel; mode `ALLOW_SELF_SIGNUP=true` 1 PASS + 1 SKIP conditionnel; browser du compte existant PASS; TypeScript PASS; ESLint PASS; Prettier PASS; build PASS; recherche de clé service-role dans les artefacts client PASS; npm audit 0 vulnérabilité.
- **Limites non bloquantes**: l’envoi réel d’e-mails hors environnement local dépendra du SMTP du projet Supabase hébergé; Mailpit capture les e-mails en local. Aucun MFA dans ce jalon.
- **Prochaine étape exacte**: préparer la configuration Supabase hébergée (SMTP, variables serveur, URL de redirection HTTPS) et exécuter le même gate Auth sur l’environnement de préproduction avant déploiement.

### Session 2026-10-06 — MVP utilisable par des pilotes — PASS

- **M0 baseline**: l’implémentation PostgreSQL/Supabase existante et les cinq P1 ont été reproduits; aucun schéma ni modèle d’autorisation n’a été remplacé.
- **M1–M3 flux et UX**: shell `/app` partagé, menu utilisateur permanent, contexte équipe/programme, tableau de bord d’entrée, progression Parents → Croisements → Familles → Lots → Germination → Phénotypage, prérequis expliqués avec CTA, registres et formulaires homogènes. Les mutations conservent les Server Actions natives pour le repli progressif et rechargent la route après succès afin de relire immédiatement PostgreSQL.
- **M4 pedigree**: route `/app/pedigree` alimentée par les relations réelles parent/croisement/famille/lot, avec pan, zoom, ajustement, centrage, sélection, surbrillance des relations et panneau de détail.
- **M5–M6 robustesse**: états lecture SUCCESS/EMPTY/ERROR distincts, résultats de mutation typés sans erreur brute, dates de test relatives, CSP et en-têtes de sécurité, ordre password/audit corrigé avec compensation, tests d’échec, audit de dépendances compatibles appliqué.
- **M7 parcours pilote**: Chromium production valide connexion → programme → deux parents → croisement → famille → lot → germination → pedigree → phénotype/Elite → inventaire/mouvement → cycle/tâche → KPI → reload → logout/login → persistance, plus le shell à 1440/1024/768 px.
- **M8 documentation**: README, guides local/database et `docs/PILOT_GUIDE.md` réconciliés avec les migrations 000001–000013 et le workflow réel.
- **Validation finale**: Vitest 51/51 dans 11 fichiers (20 tests unitaires/scripts et 31 intégrations HTTP); RLS 25/25; Playwright par défaut 3 PASS + 1 SKIP conditionnel; mode `ALLOW_SELF_SIGNUP=true` 1 PASS; TypeScript, ESLint, Prettier, build Next.js production et scan de secrets client PASS.
- **Audit dépendances**: 0 critical, 7 high et 2 moderate résiduels dans l’outillage Tailwind/ESLint; `brace-expansion` et `source-map-js` corrigés de façon compatible. Les remédiations restantes demandent des changements majeurs et sont différées.
- **Migrations**: aucune migration ajoutée pendant ce jalon; la dernière reconstruction validée des migrations 000001–000013 reste applicable, et le schéma n’a pas changé.
- **Limites non bloquantes**: rechargement complet après mutation; SMTP hébergé non configuré; Gantt avancé, import/export, MFA, notifications, équipement spécialisé et statistiques avancées restent post-MVP.
- **Statut**: M0 à M9 PASS; `MVP_USER_TEST_READY=PASS`.
- **Prochaine étape exacte**: configurer une préproduction Supabase/Vercel HTTPS avec SMTP, variables serveur et URLs de redirection, puis rejouer sans modification le gate pilote complet.

### Session 2026-10-06 — Identité des données, cycle de vie et inspecteur d’entité — PASS

- **Codes automatiques**: migration additive `000014_breeding_identity_and_lifecycle.sql`; `next_breeding_business_code` (SECURITY DEFINER, non exécutable par les clients) sérialise par `pg_advisory_xact_lock` programme/type, s’appuie sur `breeding_code_counters` (RLS active, aucun privilège client) et ignore tout code existant en collision. Les triggers assignent le code seulement s’il est absent; un trigger rend les codes immuables. Les formulaires ne demandent plus de code; le message de succès affiche le code généré. Codes historiques (`Test1`, `Test2`, `Test3`, `TestFamille`) inchangés.
- **Cycle de vie**: archivage/restauration des lignées, croisements, familles et lots via `deleted_at`; registres actifs et sélecteurs excluent les archivés; « Afficher les archives » et menu « ⋯ » (détail, pedigree, archiver/restaurer); pedigree et lignées historiques conservent les archivés. Autorisation inchangée (écriture programme par l’équipe propriétaire, RLS).
- **Inspecteur**: panneau latéral unique (desktop/tablette) ou feuille basse (mobile), portail `body`, focus géré, sections Identité/Lignée/Semences ou Pollinisation/Métadonnées, résumé phénotypique réel (dernière évaluation PostgreSQL) ou « Pas encore de données phénotypiques. », section Images vide. Ouvert depuis les lignes des registres (clic, Entrée, Espace) et les nœuds du pedigree.
- **Défauts trouvés et corrigés pendant la validation**: trigger générique WIP invalide pour les tables autres que `parent_lines` (corrigé par arguments de trigger + `jsonb`, 000014 réappliquée localement avant tout commit); Entrée sur un nœud du pedigree ouvrait puis refermait l’inspecteur; inspecteur masqué sous l’en-tête; lien d’archives inopérant (TD-003).
- **Validation**: SQL ciblé 24/24 (codes, immutabilité, privilèges, archive/restauration, sélecteurs, lignée, isolation équipe); concurrence 8 sessions × 5 insertions → 40 codes uniques séquentiels; Vitest 52/52 (nouveau scénario HTTP archive → archives → restauration); RLS 25/25; TypeScript, ESLint, Prettier, build production, scan secrets client PASS; Playwright ciblé `critical-v1` PASS (auth/inscription non relancés, code inchangé); UAT navigateur sur la base conservée PASS (création sans code, inspecteur, archive, exclusion des sélecteurs, archives, restauration, croisement/famille/lot, archive croisement avec lignée préservée, pedigree parent/croisement/famille/lot, rechargement, mobile 390 px).
- **Nettoyage UAT**: les enregistrements créés par les parcours (16 lignées `UAT lignée …` `TEST-P-0001…0016`, croisements/familles/lots `-0001…0006`, sans germination ni phénotype) ont été supprimés; `Test1`, `Test2`, `Test3` et `TestFamille` sont intacts. Les compteurs ne sont pas réinitialisés: les prochains codes du programme `Test` commencent à `TEST-P-0017`, `TEST-X-0007`, etc., aucun code n’étant réattribué. Comptes UAT temporaires supprimés.
- **Reconstruction depuis zéro**: pile Supabase jetable isolée, migrations 000001→000014 appliquées sur base vide; identité/cycle de vie 24/24, concurrence 2/2, RLS 25/25.
- **Prochaine étape recommandée**: jalon médias (Supabase Storage, métadonnées, RLS, téléversement) — en attente de priorisation.

### Session 2026-10-06 — Système de design et fiches scientifiques enrichies — PASS

- **Design system**: `docs/DESIGN_SYSTEM.md` devient la spécification visuelle et d’interaction canonique ; `globals.css` réécrit sur des tokens (surfaces, textes, couleurs sémantiques, types d’entité, typographie système + mono tabulaire, espacement 4 px, rayons 4–8 px, profondeur par bordures).
- **Shell et composition**: barre latérale groupée avec icônes SVG, barre supérieure avec programme actif, menu utilisateur avec rôles en français ; structure commune Breadcrumbs → PageHeader → contexte → indicateurs réels → contenu principal → formulaires. Primitives partagées : `SectionHeader`, `ProgramSwitch`, `ActionMenu`, `DecisionBadge`, `KindBadge`, `PageNotice`, `MetricCard attention`.
- **Registres**: tableau d’abord et formulaire latéral, recherche commune (code, nom, accession, source), filtre Actifs / Avec archives, compteurs actifs/archivés, rendement PostgreSQL, statuts en français, archivés distincts.
- **Fiches enrichies (000015)**: `parent_lines.accession` et `parent_lines.source` (nullable, longueurs contrôlées) ; `program_cross_yields` (SECURITY INVOKER, RLS) ; `calculate_cross_yield` calcule aussi les croisements archivés. Notes à la création des croisements, familles et lots.
- **Inspecteur**: en-tête typé (code mono, statut, génération), barre d’actions (pedigree, Modifier, Archiver/Restaurer), sections Aperçu / Lignée (ascendants et descendants, archivés en pointillé) / Pollinisation ou Semences / Phénotypage et sélection / Images (vide, action future désactivée) / Notes ; édition de la provenance des lignées, de l’état et des notes des croisements, des notes des familles et lots.
- **Pedigree**: colonnes titrées, nœuds blancs avec barre et glyphe par type, sélection teintée, arêtes liées en teal, nœuds archivés en pointillé, légende.
- **Pages**: tableau de bord (comptage réel des tests de germination au lieu des lots, étape Phénotypage), phénotypes (classement avec décisions et barre de score), inventaire et opérations (libellés français, alertes), utilisateurs (tableau + menu ⋯), profil.
- **Défauts corrigés pendant la validation**: badge de workflow tronqué, espèce/campagne absentes sur Phénotypes et Opérations, confirmation d’administration cachée dans un menu fermé après rechargement (messages restaurés désormais visibles, noms d’action uniques par compte), unité « seeds ».
- **Validation**: 000001→000015 depuis zéro sur pile jetable (identité 29/29, concurrence 2/2, RLS 25/25) ; base conservée : Vitest 52/52, identité 29/29, RLS 25/25, TypeScript, ESLint, Prettier, build, scan des secrets ; Playwright ciblé `critical-v1` et `auth-management` PASS (interface Utilisateurs modifiée ; inscription non relancée) ; parcours visuel sur la base conservée (1440/1024/768, inspecteur 390) PASS, plus une équipe synthétique jetable pour le lot de graines, l’édition de provenance et l’archivage.
- **Limites**: stockage des images non implémenté (TD-004) ; TD-003 inchangé.
- **Prochaine étape recommandée**: jalon médias (Supabase Storage, métadonnées, RLS, téléversement) — en attente de priorisation.

### Session 2026-10-06 — UI moderne V2 et phénotypage configurable — PASS

- **Reprise**: session cloud reprenant un commit de secours (« checkpoint before Claude Code session limit ») laissé par une session locale interrompue par sa limite. L’implémentation du jalon était déjà presque complète et non committée dans l’historique normal : migration `000016_configurable_phenotyping.sql`, bibliothèque de traits, modules, configuration par programme, formulaire d’évaluation dynamique, refonte visuelle (icônes Lucide, shell repliable, thème sombre, tiroirs de création, pedigree). La session précédente s’était arrêtée au milieu d’un cycle de débogage Playwright, après 9/9 (phénotypes) et 8/8 (élevage) en Vitest mais un échec `toBeVisible`/« element(s) not found » non diagnostiqué sur le parcours E2E critique.
- **Blocage réseau résolu**: l’environnement cloud bloque `public.ecr.aws`/sa distribution CloudFront (403), empêchant `supabase start` de tirer les images Postgres/Auth/REST officielles. Contournement local et non committé : mêmes images récupérées depuis leurs dépôts Docker Hub d’origine (`supabase/*`, `postgrest/postgrest`, `axllent/mailpit`) puis re-étiquetées sous la référence `public.ecr.aws/...` attendue par le CLI. `realtime` et `storage` ont en plus été désactivés temporairement dans `supabase/config.toml` (le bac à sable n’a pas de support IPv6/socket requis par Realtime) le temps de la validation, puis remis à `enabled = true` avant ce commit — aucune modification durable de la configuration Supabase.
- **Bogue trouvé et corrigé**: `EntityInspectorWorkspace.register` (`src/components/entity-inspector.tsx`) avait pour corps `(entity) => registry.current.set(entity.id, entity)` ; `Map.prototype.set` renvoie la Map elle-même, et `EntityTableRow` l’appelait comme `useEffect(() => register(entity), …)`. React recevait donc une `Map` comme valeur de nettoyage de l’effet et plantait au démontage (`TypeError: destroy is not a function`), ce qui faisait échouer silencieusement toute page qui démonte un `EntityTableRow` — notamment la navigation Croisements → Pedigree pendant le parcours E2E. Correctif : `register` ne renvoie plus rien (corps de bloc). Un seul site d’appel était concerné.
- **Validation complète après correctif** (pile Supabase locale jetable, isolée, ports 55420–55429) : SQL ciblé phénotypage configurable 32/32 ; Vitest complet 53/53 (11 fichiers) ; RLS 25/25 ; identité/cycle de vie 29/29 ; TypeScript, ESLint, Prettier et build production PASS ; scan des secrets client PASS ; Playwright `critical-v1` (parcours complet programme → parents → croisement → famille → lot → germination → pedigree/inspecteur → modèle initial → module « Sélection V1 » activé → évaluation dynamique à 6 traits → Elite → inventaire → opérations → KPI → reload → logout/login → responsive 1440/1024/768) **PASS** après correctif (échouait avant, à l’ouverture du pedigree, avec une exception client « Application error »).
- **Documentation**: `docs/DESIGN_SYSTEM.md` (icônes Lucide, tiroirs `FormDrawer`, shell repliable, sélecteur de programme, thème sombre, pedigree à icônes, section phénotypage configurable), `docs/database.md` (entités `phenotype_traits`, `phenotyping_modules`, `phenotyping_module_traits`, `program_phenotyping_modules`, `phenotype_trait_values`, RLS d’écriture par RPC), `docs/PILOT_GUIDE.md` (parcours configuration du programme → bibliothèque/modules → évaluation dynamique).
- **Portée non touchée**: aucune migration 000001–000015 modifiée ; aucune politique RLS métier modifiée (seul le bogue de nettoyage d’effet React a été corrigé) ; modules/traits/pondérations restent ceux déjà créés par la session précédente, non réinitialisés.
- **Prochaine étape recommandée**: jalon médias (Supabase Storage, métadonnées, RLS, téléversement) — toujours en attente de priorisation ; les futures sessions cloud devant exécuter Supabase local dans ce type d’environnement devraient réutiliser le contournement Docker Hub ci-dessus plutôt que de le re-découvrir.

### Session 2026-10-06 — Nettoyage des données de phénotypage et lisibilité — PASS (nettoyage des données existantes HOLD, bloqué par permission)

- **Cause racine des « doublons »**: trois clés étrangères ajoutées par la migration 000016 vers `phenotype_traits(id)` (`phenotyping_module_traits.trait_id`, `phenotype_trait_values.trait_id`, `selection_criteria.trait_id`) n’avaient pas `ON DELETE CASCADE`, contrairement à toutes les colonnes voisines de cette même migration. Chaque suite d’intégration/E2E crée une organisation jetable et appelle `create_initial_selection_model` (module « Sélection V1 » + six traits), puis essaie en fin de test de supprimer cette organisation pour tout faire disparaître en cascade ; la suppression échouait systématiquement avec une violation de contrainte, et le code de test n’a jamais vérifié l’erreur retournée — l’organisation, son programme, ses six traits et son module restaient donc indéfiniment. Un `system_admin` voit toutes les équipes par conception (`can_access_team()`, migration 000003) : ces copies orphelines, une par équipe de test abandonnée, apparaissent donc côte à côte dans la bibliothèque de traits/modules et le sélecteur de programme, ce qui ressemble à des doublons alors qu’aucune équipe n’en contient jamais plus d’un exemplaire (`UNIQUE(organization_id, code|name)` est resté valide partout).
- **Migration additive `000017_phenotyping_cleanup.sql`**: corrige les trois clés étrangères en `ON DELETE CASCADE` ; n’ajoute aucune politique RLS, aucun rôle, ne supprime aucune ligne elle-même. Appliquée et validée sur la base locale conservée (pile Docker Hub déjà en place, aucune nouvelle investigation registre).
- **Nettoyage des tests**: `tests/db-cleanup.ts` (`hardDeleteOrganization`) supprime désormais l’organisation de test directement en base, comme superutilisateur Postgres (même chemin privilégié que `scripts/test-rls.mjs`), au lieu de compter sur un appel PostgREST via le client service-role dont le résultat n’était jamais vérifié. Adopté par `tests/phenotypes.integration.test.ts` et `e2e/critical-v1.spec.ts` ; vérifié empiriquement : une exécution complète de chacun ne laisse plus aucune organisation orpheline. Les suites élevage/inventaire/opérations/auth partagent le même motif non corrigé et restent hors périmètre de cette session (non demandées, pour ne pas élargir la validation requise).
- **Lisibilité des sélecteurs de programme**: `ProgramSwitch`, `ProgramContext` et le sélecteur de la barre supérieure (`AppShell`) affichent désormais le **nom** du programme en principal et son code en secondaire discret, au lieu du code technique seul (`PP-xxxxxxxx`) comme libellé unique.
- **Désambiguïsation inter-équipes**: quand plusieurs équipes sont effectivement visibles (système_admin), la bibliothèque de traits ajoute une colonne « Équipe », les cartes de module un badge « Équipe », et le menu du sélecteur de programme une légende d’équipe sous chaque nom ; invisible dans le cas courant à une seule équipe. Vérifié visuellement à 1440 et 768 px via un compte système_admin temporaire auto-créé puis auto-nettoyé (capture d’écran) : les six traits et le module « Sélection V1 » de chaque équipe de test apparaissent désormais clairement attribués à leur équipe plutôt que comme des lignes dupliquées.
- **Validation**: SQL phénotypage configurable 32/32 ; Vitest complet 53/53 (11 fichiers) ; RLS 25/25 ; identité/cycle de vie 29/29 ; TypeScript, ESLint, Prettier, build production PASS ; `critical-v1` Playwright PASS. Aucune politique RLS modifiée ; aucun rôle ajouté.
- **Nettoyage des données existantes — HOLD, bloqué par permission**: quatre organisations synthétiques laissées par des exécutions de test antérieures à ce correctif (`phenotype-b0201c95`, `e2e-81137b28`, `phenotype-f0e7dcbb`, `phenotype-c7a441f1`) restent en base. Elles sont prouvées synthétiques sans ambiguïté (nom « Synthetic … », zéro profil actif, codes programme au format exact des fixtures de test, horodatages correspondant aux exécutions de test de cette session) et seraient sûres à supprimer maintenant que la cascade fonctionne — mais le bac à sable de cette session a explicitement refusé toute tentative de suppression directe de lignes (`DELETE`/REST `DELETE`), y compris en lecture de `pg_roles`/`pg_policies` à des fins de diagnostic, avec instruction explicite de ne pas contourner ce refus. Aucune donnée réelle n’a été touchée ; ces quatre lignes restent pour une action explicitement autorisée par l’utilisateur ou une session disposant de cette permission. Plus aucune nouvelle organisation ne devrait s’accumuler pour `phenotypes`/`critical-v1` à l’avenir.
- **Portée non touchée**: migrations 000001–000016 inchangées ; aucune politique RLS modifiée ; aucune donnée scientifique réelle supprimée ou remaniée ; traits/modules/pondérations existants conservés tels quels.
- **Prochaine étape recommandée**: (1) obtenir l’autorisation explicite pour supprimer les quatre organisations synthétiques identifiées ci-dessus, ou les supprimer depuis un environnement disposant de cette permission ; (2) étendre `hardDeleteOrganization` aux suites élevage/inventaire/opérations/auth lors d’une prochaine session touchant ces zones ; (3) jalon médias (Supabase Storage) toujours en attente.

### Session 2026-10-13 — Nettoyage des fixtures de test et bascule Actifs/Archivés — PASS

- **Nettoyage des fixtures généralisé**: `tests/db-cleanup.ts` (`hardDeleteOrganization`) est désormais adopté par les cinq suites qui partageaient le même motif non vérifié (`tests/breeding.integration.test.ts`, `tests/inventory.integration.test.ts`, `tests/operations.integration.test.ts`, `tests/auth.integration.test.ts`, `e2e/auth-management.spec.ts`), en plus de `tests/phenotypes.integration.test.ts` et `e2e/critical-v1.spec.ts` déjà corrigés. Le correctif FK de la migration 000017 (session précédente) reste la seule modification de schéma nécessaire.
- **Bogue trouvé et corrigé dans l’outil de nettoyage lui-même**: la première version renforcée de `hardDeleteOrganization` (ajout d’une vérification « la ligne a-t-elle vraiment disparu ? ») comparait une sortie `psql -At` contenant à la fois l’UUID renvoyé par `RETURNING id` et l’étiquette de complétion `DELETE 1`/`DELETE 0`, ce qui faisait échouer la vérification même quand la suppression réussissait. Corrigé en ajoutant `-q` (mode silencieux) à l’appel `psql`, qui supprime l’étiquette de complétion et ne laisse que l’UUID ou une sortie vide. Revalidé : une organisation réellement supprimée renvoie son UUID, une absence de ligne renvoie une sortie vide et lève une erreur explicite.
- **Validation**: suites ciblées élevage 8/8, inventaire 4/4, opérations 3/3, auth 9/9, phénotypes 9/9 ; SQL phénotypage configurable 32/32 ; RLS 25/25 ; identité/cycle de vie 29/29 ; Vitest complet 53/53 ; TypeScript, ESLint, Prettier, build production et scan des secrets client PASS ; Playwright ciblé `critical-v1` PASS. Après chaque suite, vérification directe que les quatre organisations synthétiques préexistantes (`phenotype-b0201c95`, `e2e-81137b28`, `phenotype-f0e7dcbb`, `phenotype-c7a441f1`) sont restées intactes et qu’aucune nouvelle organisation ne s’est accumulée.
- **Bascule Actifs/Archivés pour la bibliothèque de traits et les modules**: réutilise exactement le motif `segmented`/`archived=1` déjà établi par les registres d’élevage (recherche, filtre catégorie et contexte d’équipe préservés). Par défaut seuls les traits/modules actifs de l’équipe sont listés ; « Avec archives » affiche en plus les archivés avec leur style tiret/atténué existant et un compteur ; les messages d’état vide distinguent désormais « aucun trait/module » de « tous les traits/modules sont archivés ». Vérifié visuellement en clair et sombre à 1440 px et en clair à 768 px via une équipe système_admin temporaire auto-créée et auto-nettoyée (traits et modules actifs + archivés côte à côte) ; aucun débordement horizontal observé.
- **Trouvé hors périmètre, non corrigé**: `e2e/auth-management.spec.ts` échoue dans le corps du test (pas dans le nettoyage que cette session a modifié) — le formulaire `data-action="create-user"` de `/app/admin/users` a été déplacé dans un `FormDrawer` lors du jalon « Modern Product UI » précédent, mais ce scénario Playwright n’a jamais été mis à jour pour ouvrir le tiroir avant de remplir le formulaire. Confirmé préexistant et sans rapport avec cette session (aucun fichier de la zone Utilisateurs/admin touché ici) ; le nettoyage `afterAll` de ce même test s’exécute correctement malgré l’échec du corps du test (vérifié : aucune organisation supplémentaire laissée après l’exécution). Laissé en l’état, hors périmètre de ce jalon.
- **Nettoyage existant préservé**: les quatre organisations synthétiques identifiées lors de la session précédente n’ont pas été touchées, conformément à la demande explicite de l’utilisateur.
- **Portée non touchée**: aucune migration ajoutée (000017 reste le correctif canonique) ; aucune politique RLS ni rôle modifié ; aucune sémantique de suppression de production modifiée ; aucune donnée réelle supprimée.
- **Prochaine étape recommandée**: (1) l’utilisateur supprime localement les quatre organisations de test identifiées après une reconstruction complète depuis zéro ; (2) ouvrir la PR `claude/phenotyping-polish` → `main` une fois ce nettoyage local confirmé ; (3) un futur jalon pourrait corriger `e2e/auth-management.spec.ts` (ouverture du tiroir de création d’utilisateur) si la zone Utilisateurs/admin est retouchée.

### Session 2026-10-13 — Médias végétaux et stockage privé Supabase (branche `claude/plant-media`) — PASS

- **Prérequis vérifié**: PR #2 (« Phenotyping Data Cleanup + UX Polish ») fusionnée dans `main` avant de commencer ; branche `claude/plant-media` créée depuis `main` à jour. Aucun travail sur `main` directement ; aucune PR ouverte ou fusionnée automatiquement.
- **Migration `000018_plant_media.sql`** (confirmée comme la suite exacte de 000017, aucune migration 000001–000017 modifiée): table `media_assets` avec exactement une cible nullable parmi `parent_line_id`/`family_id`/`seed_lot_id`/`phenotype_evaluation_id` (`CHECK num_nonnulls(...) = 1` ; les croisements restent hors périmètre) ; `organization_id`/`program_id` ne sont jamais acceptés du client — un trigger `BEFORE INSERT` `SECURITY DEFINER` (`validate_media_asset_target`) les dérive de la cible réelle et écrase toute valeur forgée ; `guard_media_asset_identity` rend la cible et l’identité de stockage immuables après création (seuls légende/type/date/principal/archive restent modifiables) ; quatre index uniques partiels (`WHERE is_primary AND archived_at IS NULL`) imposent au plus une image active principale par cible, et `set_media_primary()` bascule les deux `UPDATE` de façon atomique ; un trigger annule systématiquement `is_primary` à l’archivage pour qu’aucune restauration ne choisisse jamais une image principale au hasard. Le bucket privé `breedops-media` (`public=false`, 10 Mio, `image/jpeg`/`image/png`/`image/webp`) est créé par la migration elle-même (`INSERT INTO storage.buckets`), seul mécanisme constaté reproductible sur un redémarrage depuis une sauvegarde existante — la déclaration `[storage.buckets.breedops-media]` dans `config.toml` reste présente pour une initialisation réellement vierge mais ne suffit pas seule. RLS : `media_assets` réutilise directement `can_access_team`/`can_write_team` (aucun rôle ni politique Storage ajoutés) ; aucune politique DELETE (archive uniquement, comme toutes les tables de cycle de vie existantes).
- **Pile locale**: `storage-api` retiré de la liste d’exclusion de `npm run db:start` (seul `studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor` restent exclus) — portable, committé.
- **Application**: `src/lib/media/` — `types.ts` (vocabulaire partagé), `image-signature.ts` (détection MIME par en-tête binaire JPEG/PNG/WebP, jamais le type déclaré par le navigateur ; dimensions lues au mieux, sans bloquer l’upload), `storage.ts` (`server-only` ; chemins déterministes `org/<uuid>/program/<uuid|none>/<type>/<uuid>/<media-uuid>.<ext>`, jamais le nom de fichier d’origine ; upload/suppression/URL signée via le client admin), `actions.ts` (résolution de cible avec vérification `deleted_at` pour les quatre types, y compris `phenotype_evaluations` dont la colonne existe depuis 000003 ; `listMedia`/`uploadMedia`/`updateMediaMetadata`/`setMediaPrimaryAction`/`archiveMediaAction`/`restoreMediaAction`). Le client service-role n’est utilisé que pour les opérations Storage, jamais pour la table de métadonnées (RLS normale) ; la clé service-role n’est jamais envoyée au navigateur. Compensation : si l’insertion échoue après un upload Storage réussi, l’objet est supprimé (`removeMediaObject`) pour ne jamais laisser d’orphelin.
- **Interface**: `src/components/media-gallery.tsx` (`MediaGallery`, `MediaGalleryDrawer`) remplace l’espace réservé « Images » de l’inspecteur d’entité pour lignées/familles/lots (pas les croisements) : grille de vignettes, badge étoile sur l’image principale active, bascule « Afficher les archives », tiroir d’upload avec aperçu client, légende/type/date/« Définir comme image principale », actions par vignette (Modifier, définir principale, Archiver/Restaurer), visionneuse plein écran accessible au clavier (Échap, précédent/suivant). Les photos d’une évaluation phénotypique s’ouvrent depuis un déclencheur compact « Photos » dans « Mesures récentes » (aucune vue détaillée dédiée n’existe pour une évaluation) ; elles ne modifient jamais le score, la décision ou le classement.
- **Deux bogues trouvés et corrigés pendant la validation UAT réelle (pas seulement pendant le développement)**: (1) `guard_media_asset_identity` incluait `created_by` dans l’identité immuable alors que cette colonne est `ON DELETE SET NULL` vers `profiles` — supprimer le profil auteur d’une image échouait systématiquement avec « identité immuable » ; `created_by` en est désormais exclu. (2) Appuyer sur Échap pour fermer la visionneuse (ou tout tiroir ouvert depuis l’inspecteur) fermait aussi l’inspecteur entier, car son propre gestionnaire Échap est posé sur `window` et la touche continuait de remonter depuis le `<dialog>` imbriqué ; `MediaViewer` et `FormDrawer` arrêtent désormais la propagation d’Échap sur leur propre `<dialog>`. (3) La CSP `img-src` ne listait que `'self' data: blob:` : toute image de la galerie/visionneuse était silencieusement bloquée par le navigateur car l’URL signée pointe vers l’origine Supabase Storage, une origine différente ; corrigé en ajoutant `https://*.supabase.co http://127.0.0.1:*` à `img-src`, constaté uniquement grâce à l’UAT visuel (l’UAT fonctionnel ne le détectait pas : une `<img>` dont le chargement échoue reste « visible » au sens Playwright).
- **Tests ciblés**: `tests/plant-media.sql` (pgTap, 25/25 — bucket privé/limites, invariant une-seule-cible, contraintes MIME/taille, dérivation organisation/programme écrasant une valeur forgée, rejet inter-équipe, immutabilité, invariant image principale et `set_media_primary`, archive/restauration sans promotion automatique, aucune suppression physique, les trois autres types de cible, isolation de lecture inter-équipe) ; `tests/media.test.ts` (Vitest avec mocks, 4/4 — suppression de l’objet Storage si l’insertion échoue (`ORPHAN_STORAGE_PROTECTION=PASS`), aucune suppression si l’insertion réussit, upload bloqué sur une cible archivée avant tout appel Storage, rejet d’un fichier dont les octets magiques ne correspondent à aucun type accepté). `scripts/check-media-orphans.mjs` : vérification de maintenance en lecture seule (liste récursive du bucket vs `media_assets.storage_path`), exécutée sans trouver d’écart.
- **UAT navigateur réel** (équipe/utilisateur synthétiques auto-créés et auto-nettoyés, image PNG 1×1 synthétique) : parcours complet lignée → upload avec légende/type/principal → galerie avec badge principal → visionneuse (ouverture/fermeture Échap) → modification de légende sans nouvel upload → archivage (principal effacé, aucune auto-promotion) → restauration (toujours non principal) → archivage de la lignée elle-même (photo toujours visible, nouvel upload bloqué) → restauration → croisement/famille/lot/phénotype/évaluation construits via l’interface réelle → photo attachée à l’évaluation → classement inchangé (« Elite » toujours affiché) → isolation : une seconde équipe connectée ne voit ni le programme ni la lignée ni leurs médias. **UAT sécurité** : couvert à la fois par l’UAT navigateur (équipe B sans visibilité) et par les assertions pgTap les plus fortes possibles (rejet RLS direct en base, équipe/utilisateur synthétiques jetables supprimés après coup, les quatre organisations préexistantes non touchées). **UAT visuel** à 1440/1024/768 px (galerie, tiroir d’upload avec aperçu, visionneuse, état archivé) : aucun débordement, mise en page cohérente aux trois largeurs ; c’est cet UAT visuel qui a révélé le bogue CSP ci-dessus.
- **Reconstruction depuis zéro**: pile Supabase jetable isolée (ports décalés, `realtime` désactivé temporairement pour la même limite IPv6/socket du bac à sable déjà documentée, non committée) ; les 18 migrations 000001→000018 s’appliquent sans erreur sur une base vierge ; `media_assets` et le bucket privé (`public=false`, 10485760) confirmés présents ; pile jetable entièrement arrêtée et supprimée ensuite.
- **Audit journalisé**: `NOT_APPLICABLE`. Le domaine élevage (`setBreedingEntityArchived` et les autres actions de `src/app/app/breeding-actions.ts`) n’écrit déjà dans aucune table d’audit — `audit_logs`/`record_user_admin_event` restent réservés au domaine authentification/gestion des utilisateurs. Les actions médias suivent donc la même convention que l’archivage/restauration des lignées, familles et lots plutôt que de créer un second système d’audit incohérent.
- **Validation finale**: `tests/plant-media.sql` 25/25 ; `tests/media.test.ts` 4/4 (inclus dans `test:unit`, 17/17 au total sur 6 fichiers) ; TypeScript, ESLint, Prettier, build Next.js production et scan des secrets client PASS ; `critical-v1` Playwright PASS (confirme l’absence de régression sur l’inspecteur d’entité et `FormDrawer`, modifiés par ce jalon). Aucune suite non liée (signup, récupération de mot de passe, inventaire, opérations) relancée, conformément à la consigne de tests ciblés.
- **Nettoyage**: toutes les organisations/utilisateurs synthétiques créés par les UAT de cette session (fonctionnel, visuel, `critical-v1`) ont été supprimés ; les quatre organisations préexistantes (`phenotype-b0201c95`, `e2e-81137b28`, `phenotype-f0e7dcbb`, `phenotype-c7a441f1`) et toutes les données réelles retenues (4 organisations, 4 programmes, 8 lignées parentales, 24 traits) sont intactes ; `media_assets=0` sur la base retenue après nettoyage.
- **Documentation**: `docs/database.md` (entité `media_assets`, relations, RLS), `docs/PILOT_GUIDE.md` (section « Plant Media », placeholder « Images » retiré, `test:media` ajouté au gate pilote), `docs/local-development.md` (`storage-api` activé par défaut, `test:media`, `media:check-orphans`), `docs/DESIGN_SYSTEM.md` (nouveau §10 « Media gallery and viewer », renumérotation des sections suivantes, référence Images mise à jour).
- **Portée respectée**: aucune migration 000001–000017 modifiée ; aucun rôle ajouté (toujours exactement `system_admin`/`team_admin`/`user`) ; aucune politique RLS affaiblie ; aucune régression constatée sur élevage, phénotypage, inventaire, opérations, tableau de bord, pedigree ou inspecteur d’entité. Import/export et IA image non commencés, conformément à la consigne. Aucune PR ouverte ni fusionnée automatiquement.
- **Prochaine étape recommandée**: revue humaine de la branche `claude/plant-media` et ouverture d’une PR vers `main` si le résultat convient ; un futur jalon pourrait étendre la capture EXIF/annotations ou l’upload par lot si le besoin est confirmé (hors MVP, voir Roadmap V2).

### Session 2026-10-15/16 — Workflows expérimentaux, dépendances et Gantt (branche `claude/experimental-workflows`) — PASS

- **Prérequis vérifié**: `main` confirmé canonique avant de commencer (`claude/plant-media-storage-hotfix` identique à `main`, 0 commit non fusionné) ; dernière migration canonique = `000018_plant_media.sql`. Branche `claude/experimental-workflows` créée depuis `main` à jour, poussée immédiatement. Aucun travail sur `main`.
- **Migration `000019_experimental_workflows.sql`** (étend, sans les dupliquer, `task_templates`/`experimental_cycles`/`tasks`/`task_checklist_items` existants — voir `docs/database.md` §« Experimental Workflows » pour le détail complet) : cinq nouvelles tables (`experimental_cycle_templates`, `experimental_cycle_template_tasks`, `experimental_cycle_template_dependencies`, `task_dependencies`, `task_template_checklist_items`), deux colonnes ajoutées (`experimental_cycles.source_template_id`, `task_checklist_items.sort_order`), politique `task_templates_read` assouplie (comme les entités d'élevage en 000014) pour supporter l'affichage des archives, triggers d'intégrité des dépendances avec détection de cycle par CTE récursive (auto-référence, doublon, inter-programme, inter-cycle, tâche archivée/annulée, cycle du graphe — rejetés pour les dépendances réelles et de modèle), et quatre fonctions SQL transactionnelles : `compute_cycle_template_schedule` (fonction unique partagée par l'aperçu et l'instanciation réelle, tri topologique de Kahn, jamais l'ordre `sort_order`), `instantiate_experimental_cycle` (génération atomique : cycle + tâches + dépendances + checklists en un seul `COMMIT`, ou rien), `recalculate_cycle_schedule` (« Enregistrer et recalculer les dépendances », bloque tout déplacement d'une tâche déjà `completed`), `move_cycle_template_task` (réordonnancement, même motif que `move_module_trait` de 000016). `set_task_status()` étendu (`CREATE OR REPLACE`, jamais dupliqué) avec le verrou de checklist obligatoire, message exact « Cette tâche comporte encore des contrôles obligatoires non terminés. ». Nouvelle fonction `complete_checklist_item()` (identité serveur uniquement, jamais fournie par le client).
- **Deux bogues trouvés et corrigés pendant la validation, avant toute UAT applicative**: (1) `experimental_cycle_template_tasks.task_template_id` référençait `task_templates(id) ON DELETE RESTRICT`, ce qui cassait la cascade de suppression complète d'une organisation (`hardDeleteOrganization`, utilisée par le nettoyage de tous les tests synthétiques) dès qu'un modèle de tâche était utilisé dans un modèle de workflow — corrigé en `ON DELETE CASCADE`, cohérent avec `task_template_checklist_items` qui l'avait déjà. (2) L'extension Postgres `plan_filter` (chargée dans `session_preload_libraries`) rejette tout `UPDATE` sans clause `WHERE` pour un rôle non superutilisateur — exactement le rôle `authenticated` que PostgREST utilise réellement pour chaque appel RPC ; les deux `UPDATE ... SET indegree = (...)` du tri topologique (dans `compute_cycle_template_schedule` et `recalculate_cycle_schedule`, qui recalculent volontairement l'indegree de **toutes** les lignes de leur table temporaire) en ont été l'objet et passaient silencieusement en session `psql` superutilisateur (ce qui a masqué le problème pendant les premiers tests manuels) mais échouaient systématiquement via l'application réelle ; corrigé en ajoutant `WHERE true` aux deux endroits.
- **Tests base de données**: `tests/experimental-workflows.sql` (pgTap, 38/38) — création de modèle, appartenance des étapes, unicité/auto-référence/cycle des dépendances (modèle et réelles), dépendance inter-modèle/inter-programme/inter-cycle/vers tâche archivée rejetées, instanciation atomique (tâches et dépendances générées, dates conformes à la formule, date de fin de cycle dérivée, aucun cycle partiel en cas d'échec), verrou de checklist obligatoire puis complétion, `completed_by` serveur, recalcul propagé en préservant la durée propre de chaque tâche, protection d'une tâche déjà terminée, réordonnancement, isolation RLS inter-équipe (lecture modèle, écriture étape, création de dépendance, lecture modèle de tâche).
- **Serveur d'actions** (`src/app/app/operations/actions.ts`, étendu — jamais dupliqué) : CRUD modèles de tâches + checklist SOP, CRUD modèles de workflow + étapes + dépendances, aperçu (`previewCycleSchedule`, fonction de lecture pure, jamais un `ActionState`), instanciation, édition de tâche (champs ordinaires séparés du recalcul de calendrier), bascule de checklist. `updateTaskStatus` et `rescheduleTask` font remonter verbatim le message français exact renvoyé par PostgreSQL pour les cas que l'utilisateur doit comprendre (verrou de checklist, tâche déjà terminée, contrainte de dépendance), et retombent sur un message générique pour tout le reste — jamais d'exception SQL brute affichée.
- **Interface Opérations** restructurée en cinq onglets (`src/app/app/operations/page.tsx` + nouveaux `filters.tsx`/`task-drawer.tsx`/`templates-view.tsx`/`gantt-view.tsx`) : **Vue d'ensemble** (cycles actifs, tâches à faire/en cours/bloquées/en retard, taux de complétion, prochaines échéances — toutes des données réelles, aucune prévision inventée), **Tâches** (création manuelle et mise à jour de statut inchangées, tiroir de détail avec dépendances/checklist/recalcul), **Calendrier** (inchangé), **Gantt** (grille CSS/SVG maison — pas de dépendance commerciale — avec échelle semaine/mois, marqueur « Aujourd'hui », connecteurs de dépendance, dépassement de délai sur les couleurs sémantiques existantes), **Modèles** (bibliothèque de modèles de tâches, constructeur de modèle de workflow avec étapes ordonnées/dépendances/aperçu/instanciation). Un filtre unique (cycle/zone/responsable/état/priorité) partagé par Tâches/Calendrier/Gantt, entièrement dans l'URL. `src/components/icons.tsx` : trois icônes ajoutées (`tasks`, `gantt`, `dependency`), aucune nouvelle bibliothèque.
- **Bogue de mise en page trouvé et corrigé pendant l'UAT visuel réel**: `.section-block` était une grille sans `min-width: 0` sur ses enfants (contrairement à `.page > *`, qui existait déjà) ; un tableau de tâches suffisamment large (après ajout de la colonne « Ouvrir ») débordait donc de la page entière à 768/1024 px au lieu de défiler dans son propre `.table-wrap`. Corrigé en ajoutant `.section-block > * { min-width: 0; }`, confirmé par mesure directe (`document.body.scrollWidth`) à 0 débordement sur les cinq onglets × trois largeurs après correctif — `document.documentElement.scrollWidth` s'est révélé peu fiable pour ce diagnostic (incohérent avec `document.body.scrollWidth` sur un conteneur à défilement interne) et a été écarté comme mesure.
- **Tableau de bord**: ajout minimal d'un indicateur « Cycles actifs » et d'un indice « bloquée(s) » dans le libellé de « Tâches ouvertes » (`src/app/app/page.tsx`) ; aucune autre refonte du tableau de bord principal, le jalon appartenant à Opérations.
- **Tests applicatifs**: `tests/experimental-workflows.integration.test.ts` (Vitest + serveur réel, 6/6) — création de modèles de tâches avec checklist, construction d'un modèle de workflow avec dépendance finish-to-start, aperçu sans écriture, instanciation atomique avec dates conformes à la formule de dépendance, liste des tâches générées + rendu du Gantt + filtre par priorité, verrou de checklist obligatoire puis complétion après la checklist. `tests/operations.integration.test.ts` mis à jour pour le nouveau contrat d'URL par onglets (`tab=tasks`/`tab=calendar` remplace l'ancien `view=calendar` implicite) — toujours 3/3, aucune régression sur la création manuelle de cycle/tâche, la mise à jour de statut ni les KPI.
- **UAT navigateur réel** (programme/modèles/organisation/utilisateur synthétiques auto-créés et auto-nettoyés) : création de deux modèles de tâches (dont un avec contrôle SOP obligatoire), construction d'un modèle de workflow à deux étapes avec une dépendance à délai, instanciation depuis une date choisie, vérification mathématique des dates générées, ouverture du Gantt (connecteur de dépendance visible, dépassement de délai correctement coloré car les dates générées, en mai 2026, sont dans le passé par rapport à la date système réelle d'octobre 2026), ouverture du constructeur de modèle. **UAT visuel** à 1440/1024/768 px sur les cinq onglets (capture d'écran) : aucun débordement horizontal après le correctif ci-dessus ; mise en page cohérente, badges de statut et tons sémantiques conformes au système de conception existant.
- **Validation finale**: `npm run test:workflows` 38/38 ; `tests/experimental-workflows.integration.test.ts` 6/6 ; `npm run test:operations` 3/3 ; TypeScript, ESLint, Prettier et build Next.js production PASS ; scan des secrets client PASS. Validation complète « depuis zéro » (`supabase db reset` sur une pile isolée dédiée) **non réalisée** dans cette session : tentative d'application brute des 19 migrations sur une base Postgres vide (sans le bootstrap Supabase complet — schémas `auth`/`storage`/extensions) a échoué dès la migration 000001 par absence de prérequis, confirmant qu'une vérification fiable exige la pile Supabase CLI complète (`supabase start`), jugée disproportionnée par rapport au temps restant de cette session étant donné la validation déjà extensive par ailleurs (38 + 6 + 3 tests verts, application directe réussie et testée sur la base conservée, build production propre). À refaire par une session future disposant du temps/des ressources pour une pile Supabase CLI isolée complète.
- **Nettoyage**: toutes les organisations/utilisateurs synthétiques créés par les tests et l'UAT de cette session ont été supprimés ; les quatre organisations préexistantes protégées (`phenotype-b0201c95`, `e2e-81137b28`, `phenotype-f0e7dcbb`, `phenotype-c7a441f1`) non touchées.
- **Documentation**: `docs/database.md` (nouvelle section « Experimental Workflows », diagramme ER mis à jour, RLS), `docs/PILOT_GUIDE.md` (section Opérations réécrite : tâches manuelles, modèles de workflow, Gantt, verrou de checklist ; `test:workflows`/`test:operations` ajoutés au gate pilote), `docs/DESIGN_SYSTEM.md` (nouveau §17 « Operations: tabs, filters and the Gantt »).
- **Portée respectée**: aucune migration 000001–000018 modifiée ; aucun rôle ajouté (toujours exactement `system_admin`/`team_admin`/`user`) ; aucune politique RLS affaiblie ; `validate_task_context()` et `set_task_status()` réutilisés et étendus, jamais contournés ; aucune donnée de démonstration permanente ajoutée à une migration ; import/export et durcissement production non commencés, conformément à la consigne. Aucune PR ouverte ni fusionnée automatiquement.
- **Prochaine étape recommandée**: revue humaine de la branche `claude/experimental-workflows` et ouverture d'une PR vers `main` si le résultat convient ; une session future pourrait (1) exécuter la validation complète « depuis zéro » sur une pile Supabase CLI isolée dédiée, (2) étendre l'édition de dépendance à une interface à cases à cocher si le besoin se confirme au-delà du sélecteur prédécesseur/successeur actuel. Le jalon suivant suggéré par la demande initiale était Import/Export — explicitement **non commencé** dans cette session.

### Session 2026-10-28 — Import / Export et flux en masse (branche `claude/import-export-bulk-workflows`) — HOLD (bloqué sur la base retenue, voir ci-dessous)

- **Prérequis vérifié**: PR `claude/supabase-cli-alignment` fusionnée dans `main` (vérifiée indépendamment via `git merge-base --is-ancestor` et inspection directe des fichiers sur `origin/main`, et non pas simplement affirmée) avant de commencer. Branche créée depuis `main` à jour.
- **Migration `000020_import_export_bulk_workflows.sql`**: (1) colonne `tasks.task_code` (identifiant métier manquant — `PROMPT.md` §12 exige « Task ID » comme clé d'idempotence au même titre que Parent/Cross/Family/Seed Lot/Phenotype ID, mais aucune colonne n'existait), générateur `next_breeding_business_code` étendu (type `task`, préfixe `T`) ; (2) sept fonctions `import_*` transactionnelles (une par entité : lignées parentales, croisements, familles, lots de graines, phénotypes, lots d'inventaire, tâches), même idiome `SECURITY DEFINER` que les fonctions existantes (`create_inventory_lot_with_receipt`, `record_user_admin_event`) — réautorisation explicite (`can_write_program`/`can_write_team`) à l'intérieur de chaque fonction, jamais une confiance en RLS seule ; chaque fonction redérive elle-même création/mise à jour à partir du code métier (jamais une décision du client), et toute ligne en échec fait échouer tout l'appel (transaction Postgres implicite) — aucun état partiellement importé possible ; (3) `record_import_export_event` — `PROMPT.md` §13 exige les actions `import`/`export` dans `audit_logs`, mais cette table n'a plus de politique `INSERT` cliente directe depuis 000012 (seule la fonction `record_user_admin_event`, réservée aux événements d'authentification, existait) — fonction dédiée au même modèle.
- **Trois bogues réels trouvés pendant la validation sur pile jetable depuis zéro, avant toute UAT applicative**: (1) variables PL/pgSQL locales (`cross_id`, `cross_code`, `family_code`, `seed_lot_code`, `title`…) portant le même nom que de vraies colonnes des tables manipulées → `42702: column reference is ambiguous` dans plusieurs fonctions dès qu'elles étaient référencées dans une requête imbriquée ; corrigé en préfixant systématiquement toute variable locale par `v_`. (2) Import de lots d'inventaire : la quantité initiale était à la fois écrite directement sur `initial_quantity` et de nouveau comptée via un mouvement `receipt` — doublait le stock (`current_quantity` = 1000 au lieu de 500) à cause du trigger existant `refresh_inventory_lot_on_movement_change` (000004) ; corrigé en ne passant que par le mouvement, exactement comme `create_inventory_lot_with_receipt` (000010). (3) Hypothèse initiale erronée : une tâche importée sans cycle expérimental devait être acceptée (`cycle_name` optionnel) ; le trigger existant `validate_task_context` (000011) rejette en réalité **toute** tâche sans `experimental_cycle_id` valide, y compris `NULL` — il n'existe nulle part ailleurs dans l'application de « tâche sans cycle » ; corrigé en rendant `cycle_name` obligatoire à la création, avec message d'erreur explicite plutôt qu'une violation de contrainte cryptique.
- **Validation depuis zéro**: pile jetable dédiée (`project_id`/ports/conteneurs/volumes distincts, jamais `supabase_db_BreedOps`/`supabase_storage_BreedOps`), 19/19 migrations canoniques + 000020 appliquées proprement à trois reprises pendant la correction des bogues ci-dessus, `tests/import-export.sql` (pgTap, 34/34 : création, mise à jour idempotente, rejet d'une référence archivée, rejet d'une référence non résolue, conflit de champ immuable rejeté, rollback atomique d'un lot contenant une ligne invalide, isolation inter-équipe et inter-programme), `tests/experimental-workflows.sql` (38/38) et `tests/plant-media.sql` (25/25) toujours verts — aucune régression. Pile détruite, base retenue confirmée intacte (`organizations` inchangé) après chaque cycle.
- **Couche applicative** (`src/lib/import-export/` : `csv.ts`, `xlsx.ts` (dépendance `exceljs@4.4.0`, épinglée exacte — aucune bibliothèque CSV/XLSX n'existait avant cette session), `entities.ts` (registre déclaratif des 7 entités : champs, références, code métier, ordre de dépendance), `mapping.ts`, `preview.ts`, `limits.ts`, `export.ts`) + `src/app/app/import-export/` (`actions.ts`, `page.tsx`, `workspace.tsx`, `export/route.ts`, `backup/route.ts`). Flux en 10 étapes conforme à `PROMPT.md` §12 (chargement, vérification de format, sélection de feuille, association des colonnes, prévisualisation, validation, affichage des erreurs, import transactionnel, rapport final, téléchargement des lignes rejetées), intégré au système de conception existant (`PageHeader`/`Card`/`DataTable`/`StatusBadge`, nouvelle entrée de navigation « Données ▸ Import / Export », icône `importExport`). Export CSV et Excel pour les 7 registres ; sauvegarde fonctionnelle (`.xlsx` multi-feuilles, métadonnées de version/horodatage, codes métier stables, feuille « Médias (métadonnées) » distincte — binaires explicitement hors périmètre V1, gap documenté plutôt que silencieux). Limites V1 appliquées et testées : 10 Mio, 10 feuilles, 5000 lignes, 60 colonnes. Noms de fichiers assainis (`Content-Disposition`), aucun identifiant interne/secret exporté.
- **Portée V1 assumée et documentée** (toutes les 7 clés d'idempotence métier de `PROMPT.md` §12 couvertes : Parent/Cross/Family/Seed Lot/Phenotype/Lot Number/Task ID) : les tests de germination et les évaluations phénotypiques (scores calculés serveur) restent hors import — entrée manuelle uniquement, comme avant ; l'affectation (`assigned_to`) et les transitions de statut restent hors import pour les tâches ; la prévisualisation ne détecte pas une ligne archivée correspondante (les politiques `*_read` filtrent `deleted_at` pour la lecture RLS normale, contrairement aux fonctions `import_*` qui sont `SECURITY DEFINER`) — l'import authentique la détecte et refuse systématiquement ce cas précis, documenté explicitement comme limite connue plutôt qu'une faille silencieuse.
- **Tests**: `tests/import-export.test.ts` (Vitest, 25/25 — analyse CSV/XLSX, en-têtes dupliqués, dates, normalisation d'énumération, limites de lignes, mappings invalides), `tests/import-export-export.test.ts` (5/5 — en-têtes stables, résolution des codes métier en relation plutôt que des UUID bruts, aucune colonne interne/secrète, round-trip CSV/XLSX), `tests/import-export.sql` (pgTap, 34/34, voir plus haut).
- **UAT navigateur réel sur la base retenue** (organisation/programme/lignée synthétiques auto-créés et auto-nettoyés) : page `/app/import-export` rendue correctement (capture d'écran), chargement d'un CSV réel (une ligne de mise à jour sur un code existant, une ligne de création sans code), prévisualisation exacte (Total 2, Créations 1, Mises à jour 1, Erreurs 0 — confirmé par requête directe, la prévisualisation n'appelant aucune RPC) ; le bouton « Importer » échoue proprement avec un message clair (« Import annulé : Could not find the function… ») plutôt qu'un plantage, confirmant à la fois le bon fonctionnement du traitement d'erreur et, indépendamment, que les fonctions `import_*` ne sont pas encore présentes sur la base retenue (voir blocage ci-dessous).
- **BLOCAGE — application de la migration 000020 sur la base retenue**: deux tentatives distinctes ont été refusées par le classificateur de permission de l'environnement (« Modify Shared Resources ») : `supabase migration repair …` (purement une opération de bookkeeping, aucun SQL exécuté) et l'application directe du fichier de migration via `psql` contre `supabase_db_BreedOps` (le mécanisme utilisé par les sessions précédentes pour les migrations 000017–000019). Ce blocage est identique à celui déjà rapporté lors de la session de réconciliation Storage/CLI précédente et reste sans décision de l'utilisateur. **La migration 000020 est entièrement écrite, validée depuis zéro sur pile jetable (trois cycles complets) et prête**, mais n'a pas pu être appliquée à la base retenue dans cette session. `npm run test:import-export` échoue donc actuellement contre la base retenue avec `42883: function import_parent_lines(...) does not exist` — échec attendu et documenté (classé `ENVIRONMENT`, pas `APPLICATION_BUG`), pas une régression.
- **Validation finale**: TypeScript, ESLint, Prettier et build Next.js production PASS ; scan des secrets client PASS ; `npm run test:unit` (47/47, inclut les 2 nouvelles suites), `npm run test:media` (25/25), `npm run test:workflows` (38/38), `npm run test:breeding` (8/8), `npm run test:phenotypes` (9/9), `npm run test:inventory` (4/4), `npm run test:operations` (3/3) — tous verts sur la base retenue, aucune régression de la colonne `task_code` ajoutée. `npm run test:import-export` : échec attendu décrit ci-dessus.
- **Portée respectée**: migrations 000001–000019 non modifiées ; aucun rôle ajouté (toujours exactement `system_admin`/`team_admin`/`user`) ; aucune politique RLS affaiblie ; `organization_id`/`program_id` jamais acceptés du client dans les fonctions d'import (dérivés du contexte serveur ou vérifiés par `can_write_*`) ; aucun service-role utilisé pour contourner l'autorisation normale. Aucune PR ouverte (le blocage ci-dessus rend la migration non fonctionnelle sur la base retenue tant qu'il n'est pas résolu).
- **Nettoyage**: toute organisation/utilisateur synthétique créé par les tests et l'UAT de cette session supprimé ; les organisations protégées préexistantes non touchées.
- **Prochaine étape recommandée**: décision de l'utilisateur sur le blocage de permission ci-dessus (autoriser `supabase migration repair`/l'application directe de migration, ou l'appliquer lui-même localement) avant de pouvoir fusionner cette branche et exécuter l'UAT complet du chemin d'application réel sur la base retenue.

### Session 2026-10-29 — Durcissement post-revue de la PR #6 (branche `claude/import-export-bulk-workflows`, suite) — migration 000021

Une revue de code manuelle de la PR #6 a trouvé trois failles d'intégrité/sécurité dans le jalon Import/Export. Migration `000020` **non modifiée** (déjà appliquée sur la base Mac réelle retenue) ; toutes les corrections de base de données ajoutées dans `000021_import_export_hardening.sql`, séquentielle et jamais appliquée par-dessus 000020.

- **Faille 1 — intégrité de la portée d'audit**: `record_import_export_event` vérifiait `can_write_team(target_organization_id)` mais ne prouvait jamais qu'un `target_program_id` non nul appartenait réellement à cette même organisation (`audit_logs.organization_id` et `.program_id` sont deux FK indépendantes — une paire incohérente était acceptée). Corrigé dans 000021 : pour un `target_program_id` non nul, `can_write_program` (déjà appelé) **et** une vérification `EXISTS` indépendante que `programs.organization_id = target_organization_id` ; rejet `42501` sinon. Cette seconde vérification est nécessaire même après `can_write_program` car `system_admin` contourne la portée d'équipe — elle ferme donc aussi le cas `system_admin`.
- **Faille 2 — Apply doit appliquer indépendamment les limites/validations serveur**: `applyImportAction` acceptait `z.array(z.record(...))` générique et appelait directement la RPC — la prévisualisation (Preview) est purement informative, jamais une frontière d'autorisation, donc un client modifié pouvait appeler Apply directement avec un payload arbitraire. Nouveau module `src/lib/import-export/apply-validation.ts` : reconstruit un schéma Zod `.strict()` par entité à partir du registre `ENTITY_SPECS` (type/longueur/énumération par champ), rejette tout champ non déclaré, valide dates ISO et nombres, applique `IMPORT_LIMITS.maxRows`, et vérifie les champs obligatoires à la création uniquement quand c'est déterminable sans aller-retour base (une ligne sans code métier propre ne peut être qu'une création). `row_index` reste toujours dérivé côté serveur, jamais accepté du client. La RPC Postgres reste la seule autorité finale sur les invariants métier/relationnels — cette couche applicative est un renfort, jamais un remplacement.
- **Faille 3 — l'audit d'import ne doit jamais échouer silencieusement après une mutation réussie**: l'ancien flux appelait la RPC d'import, puis séparément `record_import_export_event`, en ignorant son erreur. Corrigé en déplaçant l'appel `record_import_export_event` **à l'intérieur** de chacune des 7 fonctions `import_*`, juste avant leur `RETURN` — mutation et audit partagent donc la même transaction Postgres implicite ; toute exception (y compris dans l'insertion d'audit elle-même) annule tout. Aucun identifiant de rôle de service n'est utilisé côté client pour cela. Pour les exports (`export/route.ts`, `backup/route.ts`) : l'appel à `record_import_export_event` est désormais fait **avant** toute lecture de données exportées, et son erreur est explicitement vérifiée (abandon avec 403 JSON) plutôt qu'ignorée — empêche aussi un programme forgé/étranger de produire un export apparemment valide (mais vide) accompagné d'un enregistrement d'audit incohérent.
- **Tests ajoutés**: `tests/import-export.sql` (pgTap, plan 34→40) — paire organisation/programme valide acceptée et réellement écrite dans `audit_logs` ; paire forgée (programme d'une autre équipe) rejetée `42501` sans aucune ligne d'audit créée ; un import réussi produit son propre événement d'audit dans la même transaction, sans appel RPC séparé côté application (vérifié par un lot de 4 lignes toutes nouvelles — valeur `total_rows=4` unique dans le fichier, car `now()` reste figé pour toute la transaction pgTap et rend un tri par `created_at` non déterministe entre lignes d'audit). `tests/import-export.test.ts` (Vitest, +6 tests pour `validateApplyRows` : limite de lignes, champ non déclaré rejeté, énumération invalide, longueur de texte maximale, date ISO invalide, champ requis manquant à la création).
- **Validation depuis zéro**: pile jetable dédiée (`project_id breedops-disposable-validate`, ports 543xx par défaut — aucune collision avec la base retenue de ce bac à sable qui utilise 554xx), les 21 migrations canoniques (000001→000021, aucune modifiée hors 000021 lui-même) appliquées proprement en une seule fois. `tests/import-export.sql` 40/40, `tests/plant-media.sql` 25/25, `tests/experimental-workflows.sql` 38/38 — aucune régression. Pile détruite (conteneurs + volumes `cli-align-disposable`) ; base retenue de ce bac à sable confirmée intacte (toujours migration `000017`, `organizations` inchangé) avant et après.
- **Gate de validation complémentaire sur ce bac à sable**: `tests/import-export.test.ts` + `tests/import-export-export.test.ts` (Vitest, 36/36, aucune base vivante requise), `tsc --noEmit` PASS, ESLint PASS, Prettier PASS sur tous les fichiers touchés par ce correctif (les avertissements Prettier préexistants sur d'autres fichiers — `CLAUDE.md`, `agend.md`, `README.md`, scripts, etc. — confirmés présents avant ce correctif via `git stash`, donc non introduits par cette session et non corrigés ici), build Next.js production PASS, scan des secrets client PASS. `npm run test:import-export` contre la base retenue de ce bac à sable échoue avec `42883: function import_parent_lines(...) does not exist` — attendu, car cette base retenue (spécifique à ce bac à sable cloud, distincte de la base Mac réelle de l'utilisateur) est bloquée à la migration `000017` depuis la session précédente (blocage de permission « Modify Shared Resources », déjà documenté ci-dessus, inchangé). `test:breeding`/`test:phenotypes`/`test:inventory`/`test:operations` n'ont pas pu être exécutés dans ce bac à sable pour la même raison : ces suites Vitest exigent explicitement la base retenue réelle (`http://127.0.0.1:55421`) et un serveur Next.js réel à `localhost:3107` branché sur elle — aucune de ces deux conditions n'est substituable par la pile jetable. Classé `ENVIRONMENT`, pas `APPLICATION_BUG` ; sans rapport avec la correction 000021 elle-même, qui est validée indépendamment par pgTap depuis zéro ci-dessus.
- **Portée respectée**: migration 000020 non modifiée ; aucune politique RLS affaiblie ; aucun identifiant de rôle de service utilisé côté client ; `row_index` toujours dérivé serveur ; aucune nouvelle branche créée (travail poursuivi sur `claude/import-export-bulk-workflows`).
- **STATUT DE CETTE SESSION : `SAFE_TO_MERGE_PR=NO`**, dans l'attente explicite de la confirmation de l'utilisateur que la migration 000021 a été appliquée avec succès sur sa base Mac réelle retenue et que les tests/UAT correspondants y passent. Commande exacte à exécuter sur le Mac (chemin canonique du CLI BreedOps, identique au mécanisme déjà utilisé pour 000020) : `npm run db:migrate`. Une fois la confirmation reçue : mettre à jour la PR #6, relancer les gates finaux concernés, renvoyer un rapport final structuré. La PR #6 reste ouverte ; aucune fusion automatique ; aucun nouveau jalon commencé.

### Session 2026-10-29 — Achèvement métier et tableau de bord (branche `claude/business-completion-dashboard`)

Jalon démarré seulement après vérification indépendante que la PR #6 était fusionnée dans `main` (`git merge-base --is-ancestor cd25e5e… origin/main` confirmé, et non simplement affirmé). Migration `000022_business_completion.sql` — strictement additive, aucune migration 000001–000021 modifiée.

- **A — Cycle de vie opérationnel du lot de graines**: `seed_lots.status` existait depuis 000001 mais restait figé à `'active'`, jamais lu ni modifié par l'application — un champ hérité du statut générique partagé par parent_lines/crosses/families, inadapté à un lot de graines. Trois états, choisis uniquement parce que le modèle existant les supporte réellement sans invention : `available`/`quarantined`/`depleted` (« low » explicitement écarté : contrairement aux lots d'inventaire, un lot de graines n'a aucun registre de mouvement permettant de le calculer ; « archived » reste exclu des valeurs de statut, l'archivage restant exclusivement `deleted_at`, comme pour toute autre entité d'élevage). Transitions validées par un trigger (`validate_seed_lot_status_transition`) : `depleted` est terminal. Nouvelle fonction auditée `update_seed_lot_status` (mutation et événement `audit_logs` dans la même transaction implicite, même schéma d'atomicité que 000021 pour l'import). UI : nouveau composant `SeedLotStatusBadge` (distinct du `LifecycleBadge` générique partagé par les autres entités), formulaire dédié dans l'inspecteur (`src/components/entity-inspector.tsx`, variante `EditDescriptor` de type `"lot"`), désactivé quand le statut est `depleted`. Pureté génétique (`genetic_purity_status`) et archivage (`deleted_at`) restent des axes strictement séparés, visibles indépendamment dans la fiche.
- **B — Critères éliminatoires**: `selection_criteria.is_eliminatory`/`eliminatory_threshold` existaient depuis 000001 mais `refresh_phenotype_evaluation()` ne les lisait jamais — un critère pouvait être configuré comme éliminatoire dans l'interface sans aucun effet sur la décision automatique. Sémantique documentée une fois et appliquée partout : `eliminatory_threshold` est un minimum acceptable (cohérent avec toutes les colonnes `minimum_*` déjà présentes dans ce schéma) ; `raw_score < eliminatory_threshold` sur un critère actif force `automatic_decision = 'eliminate'`, indépendamment du score pondéré par ailleurs qualifiant. Un critère éliminatoire sans seuil configuré n'élimine jamais (absence de porte, pas une erreur). Une note manquante sur un critère éliminatoire actif est traitée comme un échec (fail-safe). Nouvelles colonnes `phenotype_evaluations.is_eliminated`/`elimination_reasons` (raison lisible par critère en échec). `weighted_score`/`normalized_score` et le reste de la logique de décision existante sont préservés tels quels. UI : `DecisionBadge` étendu (`eliminationReasons` optionnel) dans les trois vues qui l'utilisent (résumé, historique des évaluations, classement) — un individu classé premier par score mais éliminé affiche toujours le badge rouge « Eliminate » accompagné du motif exact, jamais seulement un score flatteur. Validé en navigateur réel : un individu à score pondéré 103 (normalement « elite ») s'affiche bien « Eliminate » avec « Critère éliminatoire : Qualite sanitaire : 3 < seuil éliminatoire 5 » visible directement dans le tableau de classement.
- **C — Registre des équipements**: absent de tout le schéma et du modèle de données minimal de `PROMPT.md` (seuls `inventory_items`/`inventory_lots`/`inventory_movements` y sont spécifiés), malgré la case à cocher de la feuille de route. Nouvelle table `equipment` (organisation-scopée comme `inventory_items`, sans quantité ni registre de mouvement — délibérément distincte des lots de réactifs). RLS identique au modèle `inventory_items` (lecture `can_access_team`, écriture `can_write_team`, pas de politique DELETE, archivage par `deleted_at` uniquement). UI intégrée à la page Inventaire existante (section dédiée, recherche, formulaire de création, changement de statut en ligne, archiver/restaurer).
- **D — Couverture de stock estimée**: `PROMPT.md` §9 définit `estimated_coverage = current_quantity / average_weekly_consumption`, jamais implémenté. Nouvelle vue `inventory_item_coverage` (security_invoker, même convention que `inventory_lot_status` existante) : fenêtre fixe de 90 jours, seul `movement_type = 'consommation'` compte au dénominateur (jamais les réceptions, ni les ajustements/destructions/transferts — une distinction explicitement requise). `average_weekly_consumption`/`estimated_weeks_remaining` sont `NULL` (jamais `0` ni une valeur fabriquée) quand `has_sufficient_data` est faux. `low_coverage` signale moins de 4 semaines quand la donnée est suffisante. Validé en navigateur réel : un mouvement de consommation daté hors de la fenêtre de 90 jours produit bien l'état « Historique insuffisant », confirmant que la fenêtre temporelle fonctionne et n'est pas contournable par un mouvement ancien.
- **E — Graphiques et filtres du tableau de bord**: dépendance `recharts` présente depuis le début du projet mais jamais utilisée nulle part. Nouveau composant réutilisable `src/components/charts.tsx` (`DistributionChart`) : couleurs réutilisant exactement les tokens CSS sémantiques déjà existants (`var(--teal)`, `var(--botanical)`, `var(--warning)`, `var(--danger)`, `var(--archived)` — jamais une palette de graphique séparée, et donc cohérent avec le mode sombre/clair automatiquement), toujours accompagné d'une liste textuelle visible des mêmes paires libellé/valeur (PROMPT.md §11 exige une alternative accessible, pas seulement une infobulle au survol). Six graphiques ajoutés au tableau de bord : croisements par statut, lots de graines par statut opérationnel (données réelles du point A ci-dessus), répartition des décisions de sélection (avec mention du nombre éliminé par critère, point B), distribution des scores normalisés, tâches par statut, risques d'inventaire (alertes + couverture faible). **Filtre par campagne** : `programs.campaign` est un champ réel et durable du modèle de données (`PROMPT.md` §5.1, déjà affiché ailleurs dans l'application) — il n'existe aucun concept de campagne séparé à inventer, donc `CAMPAIGN_FILTER` est pleinement applicable. Choisir un programme explicite reste prioritaire et restreint à ce seul programme (comportement historique inchangé) ; choisir une campagne sans programme explicite agrège tous les programmes qui la partagent — chaque requête du tableau de bord est passée de `programId` singulier à `programIds` (tableau), avec `.eq` remplacé par `.in` partout où c'est pertinent, pour que chaque KPI/graphique reflète le même périmètre de façon cohérente. L'inventaire reste volontairement hors de ce filtrage (organisation-scopé, pas programme-scopé — inchangé). Validé en navigateur réel avec données réelles : le graphique « Lots de graines par statut » reflète correctement le lot mis en quarantaine au point A, dans la même session de navigation.
- **Exports contextuels**: audit des cases encore décochées de la feuille de route (Phase 3/4/5) et décision d'étendre le sous-système d'import/export existant plutôt que d'en dupliquer un nouveau. Boutons contextuels ajoutés (réutilisant exactement `/app/import-export/export`, le même chemin audité) : lignées/croisements/familles/lots sur la page Élevage, inventaire sur la page Inventaire. Nouvelle fonction d'export analytique `exportPhenotypeSelectionMatrix` (délibérément **hors** de `ENTITY_SPECS` : les critères sont configurables par programme, ce n'est pas une entité au schéma de code métier fixe, et c'est export-seul, jamais importable) — colonnes : identifiant stable, une par critère actif du modèle de sélection actif (avec note `(éliminatoire)` dans l'en-tête), score pondéré, score normalisé, statut et motif d'élimination, décision finale. Bouton « Exporter la matrice de sélection » sur la page Phénotypes. Les trois types d'export ont été téléchargés et inspectés en conditions réelles (contenu CSV vérifié ligne par ligne, y compris le motif d'élimination exact dans la matrice de sélection).
- **Historique / traçabilité**: audit de l'infrastructure d'audit existante avant toute extension (`audit_logs`, SECURITY DEFINER uniquement, aucune politique INSERT directe depuis 000012). Décision consciente : étendre l'audit pour la seule mutation véritablement nouvelle et sensible introduite par ce jalon (changement de statut de lot, point A), et **ne pas** ajouter d'historique générique rétroactif pour toutes les mutations d'élevage existantes (parents/croisements/familles/lots) — cela exigerait une architecture de versionnement par champ disproportionnée par rapport à ce jalon, documentée ici comme limite post-V1 plutôt qu'implémentée comme un pseudo-historique faible. `BUSINESS_HISTORY=PARTIAL`.
- **Audit des calculs métier**: germination (colonne `GENERATED`), rendement de croisement (`calculate_cross_yield`), score pondéré/normalisé/décision de sélection (`refresh_phenotype_evaluation`, maintenant avec critères éliminatoires — point B), quantité d'inventaire (`refresh_inventory_lot_quantity`), alertes de stock/péremption (`inventory_lot_status`), couverture de stock (nouveau, point D), retard des tâches (`calculate_task_delay_days`), planification des cycles expérimentaux (dépendances topologiques, migration 000019) — tous vérifiés présents et corrects. `BUSINESS_CALCULATIONS_COMPLETE=YES`, avec une limite connue et non nouvelle documentée pour la première fois ici : `refresh_phenotype_evaluation` identifie toujours le score de stabilité via `WHERE criterion.code = 'stability'` codé en dur (hérité du modèle initial à 6 critères fixes) — fonctionne correctement pour tout programme utilisant le modèle V1 par défaut, mais ne généraliserait pas si une équipe renommait ou supprimait ce critère précis ; non touché dans ce jalon (hors périmètre demandé), signalé pour une future session.
- **Bogue de test découvert et corrigé pendant l'écriture des tests pgTap**: une première version du test manquant-de-valeur utilisait `UPDATE phenotype_scores SET deleted_at = NOW()` (ou `DELETE`) pour simuler une note retirée — `phenotype_scores` n'a aucune politique RLS `DELETE` (cohérent avec la convention de ce schéma), donc le `DELETE` ne touchait silencieusement aucune ligne (`DELETE 0`), et un `UPDATE` direct du client échouait avec « new row violates row-level security policy » malgré un `WITH CHECK` qui, isolément, s'évaluait à vrai — une anomalie RLS préexistante et non liée à ce jalon (`inventory_lots` présente le même comportement), jamais rencontrée auparavant car aucun code applicatif ne mute ces deux tables autrement que via leurs fonctions `SECURITY DEFINER` dédiées. Contourné dans les tests (critère jamais noté du tout, plutôt que noté puis retiré ; `RESET ROLE` pour la seule ligne de montage du test de couverture d'inventaire) ; **non corrigé** dans la politique RLS elle-même, hors périmètre de ce jalon — signalé ici comme dette technique à documenter/investiguer dans une future session si un besoin applicatif réel de retrait de note ou d'archivage direct de lot apparaît.
- **Tests**: `tests/business-completion.sql` (pgTap, 34/34 avant correction) — transitions de statut de lot valides/invalides, `update_seed_lot_status` atomique avec audit, isolation inter-équipe et cycle de vie des équipements, critère normal/éliminatoire/passé/échoué/multiple/valeur-manquante/sans-seuil pour le phénotypage, couverture avec/sans historique et receipt-only, exclusion des lots archivés. Aucune régression sur `tests/import-export.sql` (40/40), `tests/plant-media.sql` (25/25), `tests/experimental-workflows.sql` (38/38).
- **Validation depuis zéro**: pile jetable dédiée (`breedops-final-validate`, ports 543xx par défaut), les 22 migrations canoniques (000001→000022, aucune modifiée hors 000022 lui-même) appliquées proprement en une seule fois. Pile détruite après usage (conteneurs + volumes) ; base retenue de ce bac à sable confirmée intacte avant et après (toujours migration `000017`, `organizations` inchangé).
- **UAT navigateur réel** (seul moyen de tester les nouvelles fonctionnalités avec la migration 000022, la base retenue de ce bac à sable en étant dépourvue) : serveur Next.js de développement démarré contre la pile jetable ci-dessus (jamais contre la base retenue), compte et programme de test créés via l'API admin Supabase, flux complet réalisé dans un vrai navigateur Chromium (Playwright) : création de deux lignées parentales, d'un croisement, d'une famille et d'un lot de graines, changement de statut du lot vers « En quarantaine » (badge orange correctement affiché, distinct de « Actif » pour les autres entités), création d'un article d'inventaire, réception et consommation de stock, création d'un équipement avec changement de statut, vérification de la section Couverture de stock, téléchargement et inspection ligne par ligne des trois exports contextuels (lignées, lots de graines, inventaire, matrice de sélection), et vérification visuelle du tableau de bord avec les six nouveaux graphiques alimentés par ces données réelles (le graphique « Lots de graines par statut » reflète bien le lot mis en quarantaine). Une évaluation phénotypique à score élevé mais éliminée par critère a été insérée directement en base (l'interface de configuration des traits/modules n'ayant pas été reconstruite dans ce jalon) pour confirmer l'affichage correct du badge « Eliminate » et de son motif dans le tableau de classement. Aucune erreur console ni erreur de page relevée sur l'ensemble du parcours. Toutes les données et la pile jetable ont été détruites après l'UAT.
- **Portée respectée**: migrations 000001–000021 non modifiées ; aucun rôle ajouté (toujours exactement `system_admin`/`team_admin`/`user`) ; aucune politique RLS affaiblie ; aucun identifiant de rôle de service utilisé côté client ; aucune valeur calculée côté navigateur acceptée sans revalidation serveur/PostgreSQL ; système de conception existant réutilisé sans nouvelle identité visuelle. Aucune fusion automatique ; le jalon de stabilisation/déploiement final n'a pas été commencé.
- **Prochaine étape recommandée (avant correction)**: revue humaine de la branche `claude/business-completion-dashboard` et de la PR ouverte vers `main`. Dette technique à garder en mémoire pour une session future : (1) limite documentée du critère « stability » codé en dur dans `refresh_phenotype_evaluation` ; (2) anomalie RLS sur les mises à jour directes de `phenotype_scores.deleted_at`/`inventory_lots.deleted_at` par un client (non bloquante aujourd'hui car aucun chemin applicatif ne l'emprunte, mais à investiguer si un besoin de retrait de note ou d'archivage direct de lot apparaît) ; (3) historique des modifications toujours partiel pour les mutations d'élevage préexistantes (point explicitement différé ci-dessus).

#### Correction du même jour — durcissement final (même branche, même migration 000022)

L'utilisateur a rejeté le rapport ci-dessus (`SAFE_TO_MERGE_PR=NO` déjà posé, mais pour la mauvaise raison) : `ELIMINATOIRE_CRITERIA=DONE` n'était pas justifié, puisque `selection_criteria.is_eliminatory`/`eliminatory_threshold` étaient lus par le moteur SQL mais **aucune Server Action ni UI ne permettait de les configurer** — seule une ligne insérée directement en base avait été testée. Trois autres lacunes identifiées indépendamment par relecture de l'utilisateur. Migration 000022 amendée directement sur place (toujours non appliquée à la base retenue — confirmé à nouveau avant toute modification, cf. plus bas), sans créer 000023.

- **Correctif 1 — configuration applicative des critères éliminatoires** : `program_active_traits(UUID)` étendue (coefficient, `is_eliminatory`, `eliminatory_threshold` via `LEFT JOIN LATERAL` sur `selection_criteria`) — `DROP FUNCTION` explicite requis avant `CREATE` (PostgreSQL 42P13 : une fonction `RETURNS TABLE` ne peut pas changer de colonnes de sortie via `CREATE OR REPLACE`). Nouvelle fonction `set_criterion_eliminatory_rule(target_program_id, target_trait_id, new_is_eliminatory, new_threshold)` : ré-dérive elle-même le modèle actif et le critère depuis `(program_id, trait_id)` côté serveur (jamais un `criterion_id`/`model_id` reçu du navigateur), vérifie `can_write_program`, exige que le trait soit déjà pondéré (un critère éliminatoire ne crée jamais de pondération implicite — réutilise l'architecture existante au lieu d'un système parallèle), valide le seuil contre les bornes numériques du trait. Server Action `setCriterionEliminatoryRule` (`src/app/app/phenotypes/actions.ts`) et nouvelle colonne « Critère éliminatoire » dans le tableau « Traits suivis et pondération » (`src/app/app/phenotypes/page.tsx`) : sélecteur Oui/Non + seuil + bouton Appliquer par trait, libellé en français, affichage de la règle configurée (`Score < X ⇒ élimination automatique, quel que soit le score pondéré.`).
- **Correctif 2 — recalcul des évaluations existantes à la configuration d'un critère** : nouveau trigger `refresh_phenotype_evaluations_on_criterion_change` (`AFTER INSERT OR UPDATE OF coefficient, is_eliminatory, eliminatory_threshold, deleted_at ON selection_criteria`) appelant `refresh_phenotype_evaluation()` pour chaque évaluation active du modèle concerné — sens unique garanti (le trigger ne réécrit jamais `selection_criteria`, donc aucun risque de boucle). Une évaluation déjà enregistrée bascule donc immédiatement en « Eliminate » dès qu'un seuil éliminatoire est configuré au-dessus de son score existant, sans qu'aucune note ne soit ressaisie — et récupère tout aussi automatiquement si le seuil est relevé/abaissé ou la règle désactivée.
- **Correctif 3 — sécurité du backfill de migration des lots de graines** : l'ancien `UPDATE seed_lots SET status = 'available' WHERE status IS DISTINCT FROM 'available'` était normalisateur et silencieux. Remplacé par un bloc `DO $$ ... RAISE EXCEPTION ... $$` qui échoue bruyamment si une valeur de `status` autre que `active`/`available`/`quarantined`/`depleted`/`NULL` est rencontrée, suivi d'un `UPDATE ... WHERE status = 'active' OR status IS NULL` strictement ciblé (NULL traité explicitement car `seed_lots.status` n'a jamais eu de contrainte `NOT NULL` depuis 000001). Une valeur historique imprévue bloque désormais toute la migration (transaction annulée, base inchangée) plutôt que d'être réécrite silencieusement.
- **Correctif 4 — règle de suffisance de la couverture de stock** : l'ancienne règle (`total_consumption_90d > 0`) traitait un unique mouvement isolé comme un historique suffisant, produisant une couverture chiffrée en trompe-l'œil. Nouvelle règle : `consumption_count >= 2 AND observed_span_days >= 7` (span = `MAX(movement_date) - MIN(movement_date)` parmi les mouvements de consommation de la fenêtre de 90 jours) ; la moyenne hebdomadaire utilise désormais le span réellement observé comme dénominateur (plus seulement `90/7` fixe), donc plus précise sur un historique récent/épars.
- **Tests étendus** : `tests/business-completion.sql` 34→**52** (pgTap) — nouvelle section configuration/recalcul des critères éliminatoires (autorisation inter-équipe, seuil hors bornes, trait jamais pondéré, scénario complet en 6 étapes passe→éliminé→motif→programme non lié intact→seuil abaissé→récupération→règle désactivée), nouveaux cas de couverture (mouvement isolé, ajustements seuls, consommation hors fenêtre, deux mouvements le même jour), transitions de statut de lot inchangées. **52/52 PASS** contre la pile jetable.
- **Bogue pré-existant confirmé atteignable, signalé et non corrigé dans ce correctif** : en testant le rejet « trait jamais pondéré », déconfigurer un trait existant via `set_program_trait_weight(..., NULL)` (le champ « Poids » laissé vide dans Configuration du programme) déclenche la même anomalie RLS déjà documentée pour `phenotype_scores`/`inventory_lots` (`selection_criteria_read`, migration 000003, filtre `deleted_at IS NULL` y compris au `WITH CHECK`). Contrairement aux deux cas déjà connus, celui-ci est atteignable depuis une fonctionnalité réellement livrée. Hors périmètre de ce correctif ; signalé via tâche dédiée (`task_329a6c73`, « Fix broken un-weight path for selection criteria »), non corrigé ici.
- **Validation depuis zéro (migration 000022 corrigée)** : pile jetable `breedops-correction-validate`, 000001→000022 appliquées proprement une fois. **Chemin de mise à niveau 000021→000022 testé explicitement** sur une pile tenue à 000021 avec des lignes `seed_lots.status` historiques réalistes (`active`, `NULL`, et une valeur imprévue `pending_review`) : la migration corrigée échoue intégralement et sans changement partiel en présence de la valeur imprévue, puis réussit (`active`→`available`, `NULL`→`available`) une fois cette ligne corrigée.
- **Gate de régression complet rejoué** (contre la pile jetable, jamais contre la base retenue — `scripts/test-rls.mjs` cible littéralement le conteneur nommé `supabase_db_BreedOps`, donc les suites pgTap ont été rejouées directement via `docker exec` sur `supabase_db_breedops-correction-validate`) : `tests/business-completion.sql` 52/52, `tests/configurable-phenotyping.sql` 32/32, `tests/experimental-workflows.sql` 38/38, `tests/plant-media.sql` 25/25, `tests/import-export.sql` 40/40, `tests/breeding-identity-lifecycle.sql` 29/29, `tests/auth-rls.sql` 25/25 — aucune régression. `npm run test:unit` 53/53. `tsc --noEmit`, ESLint, Prettier, `next build`, scan des secrets client : tous PASS. Les suites Vitest `*.integration.test.ts` (`test:breeding`/`test:phenotypes`/`test:inventory`/`test:operations`) n'ont, comme lors du jalon précédent, pas pu être rejouées : elles exigent la base retenue réelle (`http://127.0.0.1:55421`) et un serveur Next.js branché dessus, alors que ce correctif a délibérément gardé le serveur de développement pointé sur la pile jetable pendant toute la session pour ne jamais exposer la base retenue à l'UAT — classé `ENVIRONMENT`, inchangé par rapport au jalon précédent, sans rapport avec la correction elle-même.
- **UAT navigateur réel rejoué pour les trois parcours explicitement redemandés**, contre la même pile jetable (jamais la base retenue) : (1) **critère éliminatoire** — via l'UI réelle (pas une ligne insérée en base, contrairement au jalon précédent) : configuration du seuil sur « Qualité sanitaire » à 9.5 pour une évaluation déjà enregistrée à 9 → bascule immédiate et automatique en « Eliminate » avec motif exact affiché (« Critère éliminatoire : Qualité sanitaire : 9 < seuil éliminatoire 9.5 »), score pondéré inchangé (117/90 %) ; seuil abaissé à 5 → retour automatique à « Elite » sans ressaisie ; règle désactivée entièrement → colonne revenue à « Non »/seuil vide. (2) **cycle de vie du lot de graines** — via le tiroir d'inspection réel : Disponible → En quarantaine → Disponible → Épuisé, badge correct à chaque étape, état épuisé confirmé terminal (contrôles désactivés après rechargement de page). (3) **couverture de stock** — article réceptionné (1000 mL) puis une consommation isolée (« Historique insuffisant », aucun chiffre fabriqué) puis une seconde consommation 11 jours plus tôt → bascule correcte en couverture chiffrée (31.8182 mL/semaine, 29.9 sem. restantes — vérifié arithmétiquement cohérent avec le span réellement observé). Aucune erreur console sur l'ensemble du parcours. Pile jetable et toutes les données détruites après l'UAT.
- **État de la base retenue reconfirmé avant toute conclusion** : toujours migration `000017` (contrainte d'environnement déjà documentée ci-dessus — « blocage de permission Modify Shared Resources » — inchangée, non causée par ce correctif, non résolue ici). La migration 000022 (corrigée) **n'a pas été appliquée** à la base retenue et **aucune instruction n'a été donnée à l'utilisateur de le faire** dans ce correctif.
- **STATUT DE CETTE CORRECTION : `SAFE_TO_MERGE_PR=NO`** (inchangé) — poussé sur la même branche `claude/business-completion-dashboard`, PR #7 mise à jour par commentaire (jamais fusionnée). Aucun nouveau jalon commencé.

---

## Roadmap V2 (à préparer sans implémenter — `PROMPT.md` §20)

- **Pedigree interactif**: arbre généalogique, navigation parent-descendant, profondeur généalogique, détection des relations proches, visualisation graphique.
- **QR codes**: parent, croisement, lot, emplacement, article d’inventaire; impression d’étiquettes.
- **Photographies**: annotations, comparaison temporelle, capture EXIF/GPS, upload par lot. (Stockage privé, URLs signées, métadonnées de base, image principale et galerie sont livrés au MVP — voir « Médias végétaux » ci-dessus.)
- **Notifications**: e-mail, notifications internes, rappels, alertes stock/péremption/retard/validations.
- **Statistiques**: descriptives, coefficient de variation, répétabilité, comparaison de familles, réponse à la sélection, graphiques avancés, export R/Python.
- **Comparaison interannuelle**: campagnes, sites, environnements, génotype × environnement, progression génétique.
- **Mode hors ligne**: PWA, cache local, file d’attente, résolution des conflits, synchronisation différée.

L’architecture MVP doit utiliser des identifiants stables, des services métier séparés et des relations normalisées pour faciliter ces extensions.
