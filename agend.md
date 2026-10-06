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
- [ ] Compléter les fonctions de calcul métier
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
- [ ] Gestion du statut du lot
- [x] Recherche par code et tri des registres
- [ ] Export CSV ou Excel
- [ ] Historique des modifications

### Phase 4 — Notation phénotypique

- [x] Création d’un individu
- [x] Création d’un modèle de notation
- [x] Configuration des coefficients
- [x] Saisie des notes
- [x] Calcul du score pondéré
- [x] Normalisation sur 100
- [x] Classement des individus
- [x] Décision automatique
- [ ] Gestion des critères éliminatoires
- [x] Comparaison des individus
- [ ] Export de la matrice de sélection

### Phase 5 — Inventaire

- [x] Référentiel des articles
- [x] Gestion des lots de réactifs et consommables
- [ ] Gestion des équipements
- [x] Réception de stock
- [x] Consommation de stock
- [x] Ajustement avec justification
- [x] Historique des mouvements
- [ ] Calcul de la couverture estimée
- [x] Alerte de stock minimal
- [x] Alerte de péremption
- [x] Recherche par CAS, lot ou emplacement
- [ ] Export de l’inventaire

### Phase 6 — Calendrier et Gantt

- [ ] Création de modèles de cycles
- [ ] Génération automatique des tâches
- [x] Affectation des responsables
- [x] Gestion des statuts
- [x] Gestion des priorités
- [x] Calcul des retards
- [ ] Contrôle SOP
- [x] Vue tableau
- [x] Vue calendrier
- [ ] Vue Gantt
- [ ] Filtres par programme, zone et responsable

### Phase 7 — Tableau de bord et alertes

- [x] KPI des croisements
- [x] KPI de germination
- [x] KPI de sélection phénotypique
- [x] KPI d’inventaire
- [x] KPI du calendrier
- [x] Alertes de stock
- [x] Alertes de péremption
- [x] Alertes de retard
- [ ] Graphiques
- [ ] Filtres par programme et campagne

### Phase 8 — Import et export

- [ ] Définir le format d’import
- [ ] Mapper les colonnes du classeur Excel
- [ ] Prévisualiser les données avant import
- [ ] Valider les données
- [ ] Produire un rapport d’erreurs
- [ ] Import transactionnel
- [ ] Export CSV
- [ ] Export Excel
- [ ] Export d’une sauvegarde fonctionnelle

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
- [ ] Tests d’import
- [ ] Tests d’export
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

---

## Roadmap V2 (à préparer sans implémenter — `PROMPT.md` §20)

- **Pedigree interactif**: arbre généalogique, navigation parent-descendant, profondeur généalogique, détection des relations proches, visualisation graphique.
- **QR codes**: parent, croisement, lot, emplacement, article d’inventaire; impression d’étiquettes.
- **Photographies**: standardisées, métadonnées, annotations, comparaison temporelle, stockage privé, URLs signées.
- **Notifications**: e-mail, notifications internes, rappels, alertes stock/péremption/retard/validations.
- **Statistiques**: descriptives, coefficient de variation, répétabilité, comparaison de familles, réponse à la sélection, graphiques avancés, export R/Python.
- **Comparaison interannuelle**: campagnes, sites, environnements, génotype × environnement, progression génétique.
- **Mode hors ligne**: PWA, cache local, file d’attente, résolution des conflits, synchronisation différée.

L’architecture MVP doit utiliser des identifiants stables, des services métier séparés et des relations normalisées pour faciliter ces extensions.
