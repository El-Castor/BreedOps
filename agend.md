# agend.md — BreedOps operational source of truth

> This file is the living roadmap and the **actual** implementation state of the project.
> It is maintained after every meaningful change. A task is marked complete **only** when
> implementation exists, validation passes, tests pass, permissions are verified, and docs are updated.
>
> Roles of the three root files: `PROMPT.md` = spec (what to build);
> `CLAUDE.md` = engineering process (how to work); `agend.md` = roadmap + real state (where we are).

---

## 4.1 Informations générales

- **Nom du projet**: BreedOps
- **Objectif**: Application web sécurisée de gestion d'un programme d'amélioration végétale et de floriculture (MVP couvrant 5 modules).
- **Stack retenue**:
  - Frontend: Next.js (App Router), TypeScript strict, React, Tailwind CSS, React Hook Form, Zod, TanStack Table, Recharts, date-fns.
  - Backend/données: Supabase, PostgreSQL, Supabase Auth, Row-Level Security, migrations SQL versionnées, fonctions PostgreSQL pour les calculs critiques.
  - Qualité: ESLint, Prettier, Vitest, Playwright, `tsc --noEmit` strict, GitHub Actions CI si dépôt GitHub.
- **État actuel**: Dépôt non initialisé — aucun code, aucune dépendance, aucun schéma, aucun test. Voir « État actuel du dépôt » ci-dessous.
- **Date de dernière mise à jour**: 2026-08-09
- **Version cible**: MVP V1
- **Environnement concerné**: Développement local (aucun projet Supabase lié, aucune CI, aucun dépôt distant pour le moment).
- **Liens utiles vers la documentation interne**: `docs/architecture.md`, `docs/database.md`, `docs/security.md`, `docs/user-guide.md`, `docs/deployment.md` (à créer en Phase 0/11).

---

## État actuel du dépôt (vérifié le 2026-08-09 par shell)

- Répertoire de travail: `/Users/clpichot/Documents/Perso/PROJECTS-PERSO/INFO/BreedOps`
- Fichiers présents: `PROMPT.md`, `CLAUDE.md`, `agend.md`, `assets/` (8 images PNG de maquettes).
- **Dépôt Git**: absent (non initialisé).
- **Code source**: aucun.
- **Dépendances**: aucune (pas de `package.json`).
- **Migrations / schéma**: aucune.
- **Tests**: aucun.
- **Configuration**: aucune (pas de `.env.example`, `tsconfig`, `next.config`, etc.).
- **Supabase**: aucun projet lié, aucune clé configurée.

Conclusion: le projet démarre de zéro. Toutes les cases de la roadmap sont **non cochées**.

---

## 4.2 Principes d’architecture

> Renseignés au fur et à mesure. État initial: à définir en Phase 0/1.

- **Architecture frontend**: Next.js App Router, `src/` dir, Server Components par défaut, Client Components pour l'interactivité, Server Actions pour les mutations, Supabase SSR pour la session. *(à mettre en place)*
- **Architecture backend**: Supabase (Postgres + Auth + Storage), migrations versionnées dans `supabase/migrations/`, fonctions PostgreSQL pour les calculs métier sensibles (germination, rendement, score pondéré/normalisé, décision, stock, retard). *(à mettre en place)*
- **Stratégie d’authentification**: Supabase Auth, session persistée côté serveur via cookies `HttpOnly`/`Secure`/`SameSite`, réinitialisation de mot de passe, MFA prévu dans l'architecture. *(à mettre en place)*
- **Stratégie d’autorisation**: triple couche (UI, serveur, RLS). RLS active sur toutes les tables exposées, isolation par `organization_id` et `program_id`, rôles: `system_admin`, `organization_admin`, `program_manager`, `technician`, `analyst`, `viewer`, `auditor`. *(à mettre en place)*
- **Modèle de données**: modèle relationnel normalisé conforme à `PROMPT.md` §5 et §7–§10. Toutes les tables principales portent `id`(UUID), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `organization_id`, `program_id` le cas échéant. *(à définir, Phase 1)*
- **Stratégie de migrations**: une migration par fichier, séquentielle, jamais modifiée après application, testée sur base vide. *(à mettre en place)*
- **Stratégie de tests**: Vitest (unité + intégration), Playwright (E2E), tests RLS dédiés, CI quand le dépôt est hébergé. *(à mettre en place)*
- **Stratégie de déploiement**: à définir (Vercel/autre + Supabase). *(à définir)*
- **Stratégie de sauvegarde**: sauvegarde fonctionnelle par export; sauvegarde Supabase/Postgres à configurer côté hébergement. *(à définir)*
- **Stratégie d’import et d’export**: import du classeur Excel existant (`PROMPT.md` §12), idempotent via codes métier, transactionnel, avec prévisualisation et rapport d'erreurs; export CSV/Excel + sauvegarde fonctionnelle. *(Phase 8)*

---

## 4.3 Roadmap

### Phase 0 — Audit et initialisation

- [ ] Inspecter le dépôt
- [ ] Identifier la stack existante
- [ ] Installer ou vérifier les dépendances
- [ ] Configurer TypeScript strict
- [ ] Configurer ESLint et Prettier
- [ ] Créer `.env.example`
- [ ] Créer la structure documentaire
- [ ] Définir les conventions de nommage
- [ ] Définir les conventions Git
- [ ] Vérifier que les secrets ne sont pas versionnés

### Phase 1 — Architecture et base de données

- [ ] Définir le schéma relationnel
- [ ] Créer les migrations initiales
- [ ] Créer les contraintes et index
- [ ] Créer les fonctions de calcul
- [ ] Créer les politiques RLS
- [ ] Créer les données de démonstration
- [ ] Tester les migrations sur une base vide
- [ ] Documenter les relations entre tables

### Phase 2 — Authentification et rôles

- [ ] Connexion
- [ ] Déconnexion
- [ ] Gestion de session
- [ ] Réinitialisation du mot de passe
- [ ] Protection des routes
- [ ] Gestion des rôles
- [ ] Gestion des membres d’un programme
- [ ] Vérification des politiques RLS
- [ ] Journalisation des actions sensibles

### Phase 3 — Registre des croisements et lots

- [ ] Référentiel des parents et lignées
- [ ] Création d’un croisement
- [ ] Modification contrôlée d’un croisement
- [ ] Création d’une famille
- [ ] Création d’un lot de graines
- [ ] Test de germination
- [ ] Calcul automatique du taux de germination
- [ ] Calcul du rendement par unité pollinisée
- [ ] Gestion du statut du lot
- [ ] Recherche, tri et filtres
- [ ] Export CSV ou Excel
- [ ] Historique des modifications

### Phase 4 — Notation phénotypique

- [ ] Création d’un individu
- [ ] Création d’un modèle de notation
- [ ] Configuration des coefficients
- [ ] Saisie des notes
- [ ] Calcul du score pondéré
- [ ] Normalisation sur 100
- [ ] Classement des individus
- [ ] Décision automatique
- [ ] Gestion des critères éliminatoires
- [ ] Comparaison des individus
- [ ] Export de la matrice de sélection

### Phase 5 — Inventaire

- [ ] Référentiel des articles
- [ ] Gestion des lots de réactifs et consommables
- [ ] Gestion des équipements
- [ ] Réception de stock
- [ ] Consommation de stock
- [ ] Ajustement avec justification
- [ ] Historique des mouvements
- [ ] Calcul de la couverture estimée
- [ ] Alerte de stock minimal
- [ ] Alerte de péremption
- [ ] Recherche par CAS, lot ou emplacement
- [ ] Export de l’inventaire

### Phase 6 — Calendrier et Gantt

- [ ] Création de modèles de cycles
- [ ] Génération automatique des tâches
- [ ] Affectation des responsables
- [ ] Gestion des statuts
- [ ] Gestion des priorités
- [ ] Calcul des retards
- [ ] Contrôle SOP
- [ ] Vue tableau
- [ ] Vue calendrier
- [ ] Vue Gantt
- [ ] Filtres par programme, zone et responsable

### Phase 7 — Tableau de bord et alertes

- [ ] KPI des croisements
- [ ] KPI de germination
- [ ] KPI de sélection phénotypique
- [ ] KPI d’inventaire
- [ ] KPI du calendrier
- [ ] Alertes de stock
- [ ] Alertes de péremption
- [ ] Alertes de retard
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

- [ ] Vérifier toutes les politiques RLS
- [ ] Vérifier les permissions côté serveur
- [ ] Protéger les Server Actions et routes API
- [ ] Configurer les cookies sécurisés
- [ ] Configurer les en-têtes de sécurité
- [ ] Configurer une Content Security Policy
- [ ] Vérifier les risques XSS
- [ ] Vérifier les risques d’injection
- [ ] Vérifier les risques CSRF
- [ ] Limiter les tentatives de connexion
- [ ] Créer le journal d’audit
- [ ] Tester la séparation entre utilisateurs

### Phase 10 — Tests et stabilisation

- [ ] Tests unitaires
- [ ] Tests des calculs métier
- [ ] Tests des formulaires
- [ ] Tests des politiques RLS
- [ ] Tests d’intégration
- [ ] Tests end-to-end
- [ ] Tests d’accessibilité
- [ ] Tests responsive
- [ ] Tests d’import
- [ ] Tests d’export
- [ ] Vérification des erreurs TypeScript
- [ ] Vérification du build de production

### Phase 11 — Documentation et livraison

- [ ] README
- [ ] Guide d’installation
- [ ] Guide Supabase
- [ ] Guide des migrations
- [ ] Guide de déploiement
- [ ] Guide administrateur
- [ ] Guide utilisateur
- [ ] Description du modèle de données
- [ ] Description des rôles
- [ ] Description des sauvegardes
- [ ] Liste des limites du MVP
- [ ] Roadmap V2

---

## 4.4 Journal de décisions

| Date | Décision | Justification | Impact | Statut |
| ---- | -------- | ------------- | ------ | ------ |
| 2026-08-09 | Adopter la stack recommandée par `PROMPT.md` §2 | Conformité à la consigne, cohérence d'écosystème | Base de toute l'implémentation | Décidée |
| 2026-08-09 | Mémoriser la séparation `PROMPT.md` / `CLAUDE.md` / `agend.md` | Éviter la confusion des rôles des fichiers | Processus de travail | Décidée |

---

## 4.5 Problèmes et blocages

| ID | Problème | Gravité | Contournement | Action requise | Statut |
| -- | -------- | ------- | ------------- | -------------- | ------ |
| B-001 | Aucun projet Supabase lié / aucune clé d'environnement | Majeur (bloque l'exécution locale complète et les tests RLS/e2e) | Scaffolding, schéma, migrations et calculs peuvent être implémentés sans clés; `.env.example` documente les variables attendues | Fournir un projet Supabase + URL/clé anon + clé service-role | Ouvert |
| B-002 | Aucun dépôt Git initialisé | Mineur | `git init` local possible; CI GitHub Actions différée | Décision utilisateur sur l'hébergement distant | Ouvert |

---

## 4.6 Dette technique

| ID | Élément | Risque | Priorité | Version cible | Statut |
| -- | ------- | ------ | -------- | ------------- | ------ |
| (aucune pour le moment) | | | | | |

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
