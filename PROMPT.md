# Mission — Développer une application web sécurisée de gestion d’un programme d’amélioration végétale

Tu agis comme un ingénieur logiciel principal spécialisé en :

* applications web scientifiques ;
* bases de données relationnelles ;
* sécurité applicative ;
* traçabilité expérimentale ;
* interfaces de gestion de données ;
* Next.js, TypeScript, PostgreSQL et Supabase ;
* tests automatisés, migrations et déploiement.

Ta mission est de concevoir et coder une application web sécurisée permettant de gérer un programme professionnel d’amélioration génétique végétale et de floriculture.

L’application doit rester générique et utilisable pour différentes espèces végétales. Le vocabulaire, les modèles de données et les interfaces doivent rester strictement dans un cadre agricole, botanique, scientifique et légal.

---

# 1. Objectif principal

Construire une première version fonctionnelle, sécurisée et déployable de l’application autour des cinq modules suivants :

1. authentification et gestion des rôles ;
2. registre des croisements, familles et lots de graines ;
3. notation phénotypique pondérée ;
4. inventaire de laboratoire et mouvements de stock ;
5. calendrier expérimental, alertes, Gantt et tableau de bord.

Les fonctionnalités suivantes ne doivent pas être implémentées dans le MVP, mais l’architecture doit permettre de les ajouter ultérieurement sans refonte majeure :

* pedigree graphique interactif ;
* génération et lecture de QR codes ;
* gestion avancée des photographies ;
* notifications par e-mail ou push ;
* analyses statistiques avancées ;
* comparaison entre campagnes ou années ;
* mode hors ligne et synchronisation différée ;
* application mobile native ;
* intégration avec des instruments de laboratoire ;
* authentification institutionnelle LDAP ou SSO.

---

# 2. Technologie recommandée

Utilise la pile suivante sauf contrainte technique importante découverte dans le dépôt :

## Frontend

* Next.js avec App Router ;
* TypeScript strict ;
* React ;
* Tailwind CSS ;
* composants accessibles et réutilisables ;
* React Hook Form ;
* Zod pour la validation ;
* TanStack Table pour les tableaux complexes ;
* bibliothèque graphique légère et compatible React pour le tableau de bord ;
* bibliothèque de dates robuste ;
* interface responsive pour ordinateur, tablette et téléphone.

## Backend et données

* Supabase ;
* PostgreSQL ;
* Supabase Auth ;
* Row-Level Security ;
* Supabase Storage uniquement si nécessaire dans le MVP ;
* migrations SQL versionnées ;
* fonctions PostgreSQL ou logique serveur pour les calculs critiques.

## Qualité

* ESLint ;
* Prettier ;
* tests unitaires ;
* tests d’intégration ;
* tests end-to-end avec Playwright ;
* validation TypeScript stricte ;
* CI GitHub Actions si le dépôt GitHub est disponible.

Utilise les versions stables compatibles avec le projet. Ne change pas de technologie principale sans documenter précisément la justification dans `agend.md`.

---

# 3. Règles générales d’exécution

Avant d’écrire du code :

1. inspecte entièrement le dépôt ;
2. identifie les fichiers, dépendances, conventions et éventuels composants existants ;
3. crée immédiatement un fichier `agend.md` à la racine du projet ;
4. remplis ce fichier avec la roadmap détaillée définie dans cette consigne ;
5. vérifie que l’architecture proposée est cohérente ;
6. commence seulement ensuite l’implémentation.

Ne supprime aucun fichier existant sans justification.

Ne remplace pas une architecture fonctionnelle déjà présente si elle peut être adaptée.

Ne demande pas confirmation pour les décisions techniques ordinaires. Prends une décision raisonnable, documente-la dans `agend.md` et poursuis.

Ne t’arrête que lorsqu’une information véritablement indispensable manque, par exemple :

* identifiants Supabase inexistants ;
* secret externe obligatoire ;
* incompatibilité technique bloquante ;
* absence d’accès à une ressource requise.

Dans ce cas, continue tout ce qui peut être réalisé sans cette information et documente précisément le blocage.

---

# 4. Fichier obligatoire `agend.md`

Le fichier `agend.md` est la source de vérité opérationnelle du projet.

Il doit être créé avant toute implémentation significative et maintenu à jour après chaque étape importante.

Il doit contenir au minimum les sections suivantes.

## 4.1 Informations générales

* nom du projet ;
* objectif ;
* stack retenue ;
* état actuel ;
* date de dernière mise à jour ;
* version cible ;
* environnement concerné ;
* liens utiles vers la documentation interne.

## 4.2 Principes d’architecture

Documenter :

* architecture frontend ;
* architecture backend ;
* stratégie d’authentification ;
* stratégie d’autorisation ;
* modèle de données ;
* stratégie de migrations ;
* stratégie de tests ;
* stratégie de déploiement ;
* stratégie de sauvegarde ;
* stratégie d’import et d’export.

## 4.3 Roadmap avec cases à cocher

La roadmap doit être organisée en phases :

### Phase 0 — Audit et initialisation

* [ ] Inspecter le dépôt
* [ ] Identifier la stack existante
* [ ] Installer ou vérifier les dépendances
* [ ] Configurer TypeScript strict
* [ ] Configurer ESLint et Prettier
* [ ] Créer `.env.example`
* [ ] Créer la structure documentaire
* [ ] Définir les conventions de nommage
* [ ] Définir les conventions Git
* [ ] Vérifier que les secrets ne sont pas versionnés

### Phase 1 — Architecture et base de données

* [ ] Définir le schéma relationnel
* [ ] Créer les migrations initiales
* [ ] Créer les contraintes et index
* [ ] Créer les fonctions de calcul
* [ ] Créer les politiques RLS
* [ ] Créer les données de démonstration
* [ ] Tester les migrations sur une base vide
* [ ] Documenter les relations entre tables

### Phase 2 — Authentification et rôles

* [ ] Connexion
* [ ] Déconnexion
* [ ] Gestion de session
* [ ] Réinitialisation du mot de passe
* [ ] Protection des routes
* [ ] Gestion des rôles
* [ ] Gestion des membres d’un programme
* [ ] Vérification des politiques RLS
* [ ] Journalisation des actions sensibles

### Phase 3 — Registre des croisements et lots

* [ ] Référentiel des parents et lignées
* [ ] Création d’un croisement
* [ ] Modification contrôlée d’un croisement
* [ ] Création d’une famille
* [ ] Création d’un lot de graines
* [ ] Test de germination
* [ ] Calcul automatique du taux de germination
* [ ] Calcul du rendement par unité pollinisée
* [ ] Gestion du statut du lot
* [ ] Recherche, tri et filtres
* [ ] Export CSV ou Excel
* [ ] Historique des modifications

### Phase 4 — Notation phénotypique

* [ ] Création d’un individu
* [ ] Création d’un modèle de notation
* [ ] Configuration des coefficients
* [ ] Saisie des notes
* [ ] Calcul du score pondéré
* [ ] Normalisation sur 100
* [ ] Classement des individus
* [ ] Décision automatique
* [ ] Gestion des critères éliminatoires
* [ ] Comparaison des individus
* [ ] Export de la matrice de sélection

### Phase 5 — Inventaire

* [ ] Référentiel des articles
* [ ] Gestion des lots de réactifs et consommables
* [ ] Gestion des équipements
* [ ] Réception de stock
* [ ] Consommation de stock
* [ ] Ajustement avec justification
* [ ] Historique des mouvements
* [ ] Calcul de la couverture estimée
* [ ] Alerte de stock minimal
* [ ] Alerte de péremption
* [ ] Recherche par CAS, lot ou emplacement
* [ ] Export de l’inventaire

### Phase 6 — Calendrier et Gantt

* [ ] Création de modèles de cycles
* [ ] Génération automatique des tâches
* [ ] Affectation des responsables
* [ ] Gestion des statuts
* [ ] Gestion des priorités
* [ ] Calcul des retards
* [ ] Contrôle SOP
* [ ] Vue tableau
* [ ] Vue calendrier
* [ ] Vue Gantt
* [ ] Filtres par programme, zone et responsable

### Phase 7 — Tableau de bord et alertes

* [ ] KPI des croisements
* [ ] KPI de germination
* [ ] KPI de sélection phénotypique
* [ ] KPI d’inventaire
* [ ] KPI du calendrier
* [ ] Alertes de stock
* [ ] Alertes de péremption
* [ ] Alertes de retard
* [ ] Graphiques
* [ ] Filtres par programme et campagne

### Phase 8 — Import et export

* [ ] Définir le format d’import
* [ ] Mapper les colonnes du classeur Excel
* [ ] Prévisualiser les données avant import
* [ ] Valider les données
* [ ] Produire un rapport d’erreurs
* [ ] Import transactionnel
* [ ] Export CSV
* [ ] Export Excel
* [ ] Export d’une sauvegarde fonctionnelle

### Phase 9 — Sécurité et audit

* [ ] Vérifier toutes les politiques RLS
* [ ] Vérifier les permissions côté serveur
* [ ] Protéger les Server Actions et routes API
* [ ] Configurer les cookies sécurisés
* [ ] Configurer les en-têtes de sécurité
* [ ] Configurer une Content Security Policy
* [ ] Vérifier les risques XSS
* [ ] Vérifier les risques d’injection
* [ ] Vérifier les risques CSRF
* [ ] Limiter les tentatives de connexion
* [ ] Créer le journal d’audit
* [ ] Tester la séparation entre utilisateurs

### Phase 10 — Tests et stabilisation

* [ ] Tests unitaires
* [ ] Tests des calculs métier
* [ ] Tests des formulaires
* [ ] Tests des politiques RLS
* [ ] Tests d’intégration
* [ ] Tests end-to-end
* [ ] Tests d’accessibilité
* [ ] Tests responsive
* [ ] Tests d’import
* [ ] Tests d’export
* [ ] Vérification des erreurs TypeScript
* [ ] Vérification du build de production

### Phase 11 — Documentation et livraison

* [ ] README
* [ ] Guide d’installation
* [ ] Guide Supabase
* [ ] Guide des migrations
* [ ] Guide de déploiement
* [ ] Guide administrateur
* [ ] Guide utilisateur
* [ ] Description du modèle de données
* [ ] Description des rôles
* [ ] Description des sauvegardes
* [ ] Liste des limites du MVP
* [ ] Roadmap V2

## 4.4 Journal de décisions

Créer un tableau contenant :

| Date | Décision | Justification | Impact | Statut |
| ---- | -------- | ------------- | ------ | ------ |

Toute décision structurante doit y être ajoutée.

## 4.5 Problèmes et blocages

Créer un tableau :

| ID | Problème | Gravité | Contournement | Action requise | Statut |
| -- | -------- | ------- | ------------- | -------------- | ------ |

## 4.6 Dette technique

Créer un tableau :

| ID | Élément | Risque | Priorité | Version cible | Statut |
| -- | ------- | ------ | -------- | ------------- | ------ |

## 4.7 Critères d’acceptation

Documenter les critères d’acceptation de chaque module et les cocher uniquement lorsqu’ils sont vérifiés.

## 4.8 Compte rendu de progression

À la fin de chaque session de travail, ajouter :

* tâches terminées ;
* fichiers modifiés ;
* migrations ajoutées ;
* tests exécutés ;
* résultats des tests ;
* décisions prises ;
* problèmes restants ;
* prochaine étape recommandée.

---

# 5. Modèle de données minimal

Crée un modèle relationnel normalisé.

Toutes les tables principales doivent comporter, lorsque pertinent :

* `id` de type UUID ;
* `created_at` ;
* `updated_at` ;
* `created_by` ;
* `updated_by` ;
* `deleted_at` pour la suppression logique ;
* `organization_id` ;
* `program_id` ;
* contraintes de clé étrangère ;
* index adaptés ;
* commentaires SQL utiles.

## 5.1 Organisations et utilisateurs

### `organizations`

* id
* name
* slug
* status
* created_at
* updated_at

### `profiles`

* id lié à `auth.users`
* first_name
* last_name
* display_name
* organization_id
* global_role
* is_active
* created_at
* updated_at

### `programs`

* id
* organization_id
* code
* name
* description
* species
* campaign
* start_date
* end_date
* status
* created_by
* created_at
* updated_at

### `program_members`

* id
* program_id
* user_id
* role
* joined_at
* is_active

Rôles minimaux :

* `system_admin`
* `organization_admin`
* `program_manager`
* `technician`
* `analyst`
* `viewer`
* `auditor`

---

# 6. Module 1 — Authentification et rôles

Implémenter :

* page de connexion ;
* déconnexion ;
* persistance sécurisée de session ;
* réinitialisation du mot de passe ;
* protection des routes privées ;
* redirection selon l’état de connexion ;
* gestion des rôles ;
* gestion des membres d’un programme ;
* contrôle des permissions côté serveur ;
* contrôle des permissions au niveau PostgreSQL par RLS.

Ne jamais considérer qu’un bouton masqué dans l’interface constitue une protection suffisante.

Chaque opération sensible doit être vérifiée :

1. dans l’interface ;
2. côté serveur ;
3. dans les politiques RLS.

## Permissions attendues

### Administrateur système

Accès complet.

### Administrateur d’organisation

Gestion des programmes et des utilisateurs de son organisation.

### Responsable de programme

Gestion des données de ses programmes.

### Technicien

Création et modification des données expérimentales autorisées.

### Analyste

Lecture et ajout de résultats analytiques, sans modifier les données brutes validées.

### Lecteur

Lecture seule.

### Auditeur

Lecture seule avec accès aux journaux d’audit.

---

# 7. Module 2 — Registre des croisements et lots

## Tables minimales

### `parent_lines`

* id
* program_id
* parent_code
* line_name
* generation
* origin
* description
* status
* notes

### `crosses`

* id
* program_id
* cross_code
* female_parent_id
* male_parent_id
* generation
* target_traits
* pollination_date
* harvest_date
* pollinated_units
* established_units
* total_seeds
* status
* priority
* notes

### `families`

* id
* program_id
* cross_id
* family_code
* generation
* status
* notes

### `seed_lots`

* id
* program_id
* cross_id
* family_id
* seed_lot_code
* harvest_date
* total_quantity
* quantity_unit
* storage_location
* genetic_purity_status
* verification_method
* status
* notes

### `germination_tests`

* id
* seed_lot_id
* test_date
* evaluation_day
* seeds_tested
* seeds_germinated
* germination_rate
* method
* operator_id
* notes

## Calculs

Le taux de germination doit être calculé automatiquement :

```text
germination_rate =
100 × seeds_germinated / seeds_tested
```

Le rendement moyen doit être calculé automatiquement :

```text
seed_yield_per_pollinated_unit =
total_seeds / pollinated_units
```

La durée du croisement doit être calculée automatiquement :

```text
harvest_date - pollination_date
```

Ne fais pas confiance à une valeur calculée envoyée par le navigateur. Recalcule côté serveur ou dans PostgreSQL.

## Fonctions attendues

* liste paginée ;
* recherche ;
* tri ;
* filtres ;
* création ;
* modification ;
* consultation détaillée ;
* historique ;
* export ;
* liens entre parents, croisements, familles et lots ;
* affichage des tests de germination.

---

# 8. Module 3 — Notation phénotypique

## Tables minimales

### `phenotypes`

* id
* program_id
* family_id
* seed_lot_id
* phenotype_code
* block
* replicate
* location
* status
* notes

### `selection_models`

* id
* program_id
* name
* version
* description
* maximum_score
* is_active
* created_at

### `selection_criteria`

* id
* selection_model_id
* code
* name
* description
* coefficient
* minimum_value
* maximum_value
* display_order
* is_eliminatory
* eliminatory_threshold

### `phenotype_evaluations`

* id
* phenotype_id
* selection_model_id
* evaluator_id
* evaluation_date
* weighted_score
* normalized_score
* automatic_decision
* validation_status
* notes

### `phenotype_scores`

* id
* phenotype_evaluation_id
* criterion_id
* raw_score
* weighted_value
* comment

## Modèle initial de notation

Créer par défaut les critères suivants :

| Critère                          | Coefficient | Note maximale |
| -------------------------------- | ----------: | ------------: |
| Vigueur végétative               |           1 |            10 |
| Architecture                     |           1 |            10 |
| Rendement                        |           2 |            10 |
| Qualité sanitaire et homogénéité |           2 |            10 |
| Qualité analytique post-récolte  |           3 |            10 |
| Stabilité sous stress            |           4 |            10 |

Score maximal :

```text
10 × (1 + 1 + 2 + 2 + 3 + 4) = 130
```

Score pondéré :

```text
weighted_score =
vigor × 1
+ architecture × 1
+ yield × 2
+ sanitary_quality × 2
+ analytical_quality × 3
+ stability × 4
```

Score normalisé :

```text
normalized_score =
weighted_score / 130 × 100
```

Décision automatique initiale :

```text
Élite :
score >= 110 et stabilité >= 9

Avancer :
score >= 100 et stabilité >= 8

Réserve :
score >= 90 et stabilité >= 7

Éliminer :
tous les autres cas
```

Les coefficients et seuils doivent être configurables en base de données.

Ne code pas ces valeurs uniquement en dur dans l’interface.

## Fonctions attendues

* notation sur mobile et ordinateur ;
* sauvegarde progressive ;
* contrôles de valeurs ;
* calcul automatique ;
* classement ;
* comparaison des individus ;
* filtres ;
* visualisation des critères ;
* historique des évaluations ;
* validation par un responsable ;
* verrouillage logique d’une évaluation validée ;
* correction uniquement avec justification et journalisation.

---

# 9. Module 4 — Inventaire et mouvements

## Tables minimales

### `inventory_items`

* id
* organization_id
* category
* name
* cas_number
* supplier_reference
* default_unit
* minimum_stock
* storage_requirements
* light_constraints
* required_ppe
* is_active

### `inventory_lots`

* id
* inventory_item_id
* batch_number
* received_at
* expiration_date
* initial_quantity
* current_quantity
* storage_location
* status
* notes

### `inventory_movements`

* id
* inventory_lot_id
* movement_type
* quantity
* unit
* movement_date
* related_program_id
* related_task_id
* performed_by
* reason
* notes

Types de mouvements :

* réception ;
* consommation ;
* ajustement positif ;
* ajustement négatif ;
* transfert ;
* destruction ;
* retour.

Le stock actuel ne doit pas pouvoir être modifié arbitrairement sans créer un mouvement ou une correction tracée.

## Calculs

```text
current_quantity =
initial_quantity
+ total_positive_movements
- total_negative_movements
```

```text
estimated_coverage =
current_quantity / average_weekly_consumption
```

```text
days_before_expiration =
expiration_date - current_date
```

Alertes :

* `COMMANDER` lorsque le stock atteint ou passe sous le seuil minimal ;
* `URGENT` lorsqu’une péremption est inférieure ou égale à 30 jours ;
* `À PLANIFIER` lorsqu’elle est comprise entre 31 et 90 jours ;
* `PÉRIMÉ` lorsque la date est dépassée.

Les seuils doivent être configurables.

## Fonctions attendues

* réception ;
* consommation ;
* transfert ;
* correction justifiée ;
* vue par article ;
* vue par lot ;
* historique ;
* filtres ;
* recherche CAS ;
* recherche lot ;
* recherche emplacement ;
* alertes ;
* export.

---

# 10. Module 5 — Calendrier, alertes, Gantt et tableau de bord

## Tables minimales

### `task_templates`

* id
* program_id nullable
* code
* name
* description
* relative_week
* relative_day
* zone
* priority
* sop_code
* expected_deliverable
* is_active

### `experimental_cycles`

* id
* program_id
* name
* start_date
* end_date
* status

### `tasks`

* id
* experimental_cycle_id
* program_id
* task_template_id
* title
* description
* planned_date
* due_date
* completed_at
* zone
* assigned_to
* priority
* status
* sop_code
* compliance_status
* expected_deliverable
* notes

### `task_checklist_items`

* id
* task_id
* label
* is_required
* is_completed
* completed_by
* completed_at
* comment

## Statuts

* non démarré ;
* planifié ;
* en cours ;
* bloqué ;
* terminé ;
* annulé.

## Calcul du retard

```text
delay_days =
max(0, current_date - due_date)
```

Une tâche terminée ne doit plus être considérée comme en retard.

## Fonctions attendues

* création manuelle ;
* création depuis un modèle ;
* vue tableau ;
* vue calendrier ;
* vue Gantt ;
* filtres ;
* affectation ;
* statut ;
* priorité ;
* checklist ;
* contrôle SOP ;
* livrable attendu ;
* retard ;
* alertes ;
* liens vers croisements, lots ou inventaire si pertinent.

---

# 11. Tableau de bord

Créer un tableau de bord lisible et responsive.

## KPI minimaux

### Croisements

* nombre de croisements ;
* nombre de lots ;
* nombre de lots validés ;
* germination moyenne ;
* rendement moyen ;
* croisements par génération.

### Sélection

* nombre de phénotypes évalués ;
* meilleur score ;
* score moyen ;
* nombre d’individus élites ;
* nombre d’individus à avancer ;
* distribution des scores.

### Inventaire

* nombre d’articles sous le seuil ;
* nombre de lots proches de la péremption ;
* nombre de lots périmés ;
* mouvements récents ;
* consommation par catégorie.

### Planning

* tâches à venir ;
* tâches en retard ;
* tâches bloquées ;
* progression globale ;
* progression par responsable ;
* progression par zone.

## Graphiques minimaux

* germination par croisement ;
* score phénotypique par individu ;
* répartition des décisions ;
* stock critique par article ;
* tâches par statut ;
* progression du cycle.

Les graphiques doivent toujours être accompagnés d’une alternative tabulaire ou textuelle accessible.

---

# 12. Import du classeur Excel existant

Prévoir un mécanisme d’import pour un classeur comportant les feuilles suivantes :

* `01_Registre_Croisements`
* `02_Sélection_Phénotypes`
* `03_Inventaire_Laboratoire`
* `04_Calendrier_Opérationnel`
* `05_Gantt`
* `Paramètres`
* `Dashboard`

Le fichier Excel reste un outil d’import et d’export, mais ne doit pas devenir la base de données de production.

## Processus d’import

1. chargement du fichier ;
2. vérification du format ;
3. sélection des feuilles détectées ;
4. association des colonnes ;
5. prévisualisation ;
6. validation ;
7. affichage des erreurs ;
8. import transactionnel ;
9. rapport final ;
10. possibilité de télécharger les lignes rejetées.

L’import doit être idempotent autant que possible en utilisant les codes métier :

* Cross ID ;
* Family ID ;
* Parent ID ;
* Seed Lot ID ;
* Phenotype ID ;
* Lot Number ;
* Task ID.

Ne crée pas de doublons silencieux.

---

# 13. Journal d’audit

Créer une table `audit_logs`.

Champs minimaux :

* id
* organization_id
* program_id
* user_id
* entity_type
* entity_id
* action
* old_values
* new_values
* reason
* created_at
* request_id
* ip_address si juridiquement et techniquement pertinent
* user_agent si pertinent

Actions minimales :

* création ;
* modification ;
* suppression logique ;
* restauration ;
* validation ;
* invalidation ;
* import ;
* export ;
* connexion administrative ;
* modification des rôles.

Les utilisateurs ordinaires ne doivent jamais pouvoir modifier ou supprimer le journal d’audit.

---

# 14. Sécurité obligatoire

Appliquer au minimum les mesures suivantes :

## Authentification

* connexion obligatoire ;
* sessions sécurisées ;
* expiration appropriée ;
* réinitialisation de mot de passe ;
* MFA prévu dans l’architecture ;
* limitation des tentatives.

## Autorisation

* RLS activée sur toutes les tables exposées ;
* accès limité à l’organisation ;
* accès limité aux programmes attribués ;
* vérification côté serveur ;
* aucune confiance dans les données du navigateur.

## Secrets

* aucune clé secrète dans le frontend ;
* aucun secret versionné ;
* `.env.example` sans valeur sensible ;
* clé de service uniquement côté serveur.

## Données

* suppression logique des données scientifiques ;
* intégrité référentielle ;
* contraintes de validation ;
* transactions pour les opérations multiples ;
* contrôle des imports ;
* protection contre les doublons.

## Web

* HTTPS en production ;
* CSP ;
* protection XSS ;
* protection CSRF selon l’architecture retenue ;
* validation Zod ;
* requêtes paramétrées ;
* cookies `HttpOnly`, `Secure` et `SameSite` lorsque pertinents ;
* en-têtes de sécurité ;
* pas d’injection HTML non contrôlée.

## Audit

* journalisation des opérations sensibles ;
* raison obligatoire pour certaines corrections ;
* conservation de l’auteur et de la date ;
* impossibilité pour un technicien d’effacer son propre historique.

---

# 15. Interface et expérience utilisateur

L’interface doit être :

* en français ;
* claire ;
* professionnelle ;
* responsive ;
* utilisable sur tablette pendant une expérimentation ;
* accessible au clavier ;
* compatible avec les lecteurs d’écran ;
* lisible avec des contrastes suffisants ;
* cohérente entre les modules.

Créer une navigation principale comprenant :

* Tableau de bord
* Programmes
* Parents et lignées
* Croisements
* Lots de graines
* Phénotypes
* Inventaire
* Calendrier
* Gantt
* Imports et exports
* Administration
* Journal d’audit
* Paramètres

## États d’interface obligatoires

Chaque page doit gérer :

* chargement ;
* absence de données ;
* erreur ;
* accès interdit ;
* succès ;
* données partielles ;
* confirmation de suppression ;
* validation en cours.

Les erreurs doivent être compréhensibles et ne pas exposer d’informations internes sensibles.

---

# 16. Jeux de données de démonstration

Créer un script de seed reproductible contenant au minimum :

* une organisation ;
* un administrateur ;
* un responsable de programme ;
* un technicien ;
* un analyste ;
* un lecteur ;
* deux programmes ;
* dix parents ;
* dix croisements ;
* plusieurs familles ;
* plusieurs lots ;
* dix phénotypes ;
* un modèle de notation ;
* des évaluations ;
* vingt articles d’inventaire ;
* des mouvements de stock ;
* un cycle expérimental ;
* quarante tâches ;
* plusieurs alertes.

Les données doivent être fictives, cohérentes et clairement identifiées comme données de démonstration.

---

# 17. Tests obligatoires

## Tests unitaires

Tester au minimum :

* taux de germination ;
* rendement par unité ;
* score pondéré ;
* score normalisé ;
* décision automatique ;
* couverture de stock ;
* alerte de seuil ;
* alerte de péremption ;
* calcul du retard.

## Tests d’intégration

Tester :

* création d’un croisement ;
* création d’un lot ;
* ajout d’un test de germination ;
* création d’une évaluation ;
* création d’un mouvement de stock ;
* génération des tâches ;
* permissions par rôle ;
* import transactionnel.

## Tests RLS

Créer des tests démontrant qu’un utilisateur :

* ne voit pas les données d’une autre organisation ;
* ne voit pas un programme non attribué ;
* ne peut pas modifier un rôle supérieur ;
* ne peut pas modifier un score validé sans permission ;
* ne peut pas altérer le journal d’audit ;
* ne peut pas modifier directement le stock sans mouvement autorisé.

## Tests end-to-end

Scénarios minimaux :

1. connexion ;
2. création d’un programme ;
3. création de deux parents ;
4. création d’un croisement ;
5. création d’un lot ;
6. ajout d’un test de germination ;
7. création d’un phénotype ;
8. notation ;
9. réception d’un article ;
10. consommation ;
11. création d’un cycle ;
12. réalisation d’une tâche ;
13. consultation du tableau de bord ;
14. export des données.

---

# 18. Documentation obligatoire

Créer ou compléter :

## `README.md`

Inclure :

* présentation ;
* prérequis ;
* installation ;
* configuration ;
* lancement local ;
* migrations ;
* seeds ;
* tests ;
* build ;
* déploiement ;
* résolution des problèmes fréquents.

## `docs/architecture.md`

* architecture générale ;
* flux de données ;
* composants ;
* décisions principales ;
* diagramme Mermaid.

## `docs/database.md`

* tables ;
* relations ;
* contraintes ;
* fonctions ;
* index ;
* politiques RLS ;
* diagramme entité-relation Mermaid.

## `docs/security.md`

* modèle de menace ;
* authentification ;
* autorisation ;
* RLS ;
* secrets ;
* journalisation ;
* sauvegarde ;
* limites connues.

## `docs/user-guide.md`

* connexion ;
* programmes ;
* croisements ;
* notation ;
* inventaire ;
* calendrier ;
* tableau de bord ;
* import et export.

## `docs/deployment.md`

* configuration Supabase ;
* variables d’environnement ;
* migrations ;
* hébergement ;
* domaine ;
* HTTPS ;
* vérifications après déploiement.

---

# 19. Critères d’acceptation du MVP

Le MVP est considéré comme terminé uniquement si :

* un utilisateur peut se connecter ;
* les rôles sont appliqués ;
* les routes sont protégées ;
* les politiques RLS sont testées ;
* un programme peut être créé ;
* des parents peuvent être créés ;
* un croisement peut être créé ;
* une famille et un lot peuvent être créés ;
* un test de germination peut être enregistré ;
* les calculs sont corrects ;
* un phénotype peut être évalué ;
* le score et la décision sont calculés ;
* un article d’inventaire peut être créé ;
* un lot de stock peut être réceptionné ;
* un mouvement peut être enregistré ;
* les stocks sont recalculés correctement ;
* les alertes de stock et de péremption fonctionnent ;
* un cycle expérimental peut être créé ;
* des tâches peuvent être générées ;
* les retards sont calculés ;
* le calendrier et le Gantt sont utilisables ;
* le tableau de bord affiche des KPI réels ;
* l’import Excel fonctionne sur un fichier conforme ;
* l’export fonctionne ;
* le journal d’audit fonctionne ;
* les tests passent ;
* le build de production réussit ;
* aucune erreur TypeScript bloquante n’existe ;
* la documentation est complète ;
* `agend.md` reflète fidèlement l’état réel du projet.

---

# 20. Roadmap V2 à préparer sans implémenter

Documenter dans `agend.md` une future version comprenant :

## Pedigree interactif

* arbre généalogique ;
* navigation parent-descendant ;
* calcul de profondeur généalogique ;
* détection des relations proches ;
* visualisation graphique.

## QR codes

* QR pour parent ;
* QR pour croisement ;
* QR pour lot ;
* QR pour emplacement ;
* QR pour article d’inventaire ;
* impression d’étiquettes.

## Photographies

* photographies standardisées ;
* métadonnées ;
* annotations ;
* comparaison temporelle ;
* stockage privé ;
* URLs signées.

## Notifications

* e-mail ;
* notifications internes ;
* rappels ;
* alertes de stock ;
* péremptions ;
* tâches en retard ;
* validations requises.

## Statistiques

* statistiques descriptives ;
* coefficient de variation ;
* répétabilité ;
* comparaison de familles ;
* réponse à la sélection ;
* graphiques avancés ;
* export R ou Python.

## Comparaison interannuelle

* campagnes ;
* sites ;
* environnements ;
* génotype × environnement ;
* progression génétique.

## Mode hors ligne

* PWA ;
* cache local ;
* file d’attente ;
* résolution des conflits ;
* synchronisation différée.

L’architecture du MVP doit utiliser des identifiants stables, des services métier séparés et des relations normalisées afin de faciliter ces extensions.

---

# 21. Méthode de travail attendue

Travaille par incréments cohérents.

Pour chaque incrément :

1. mets à jour `agend.md` ;
2. implémente une unité fonctionnelle ;
3. ajoute ou adapte les tests ;
4. exécute les tests concernés ;
5. corrige les erreurs ;
6. documente le résultat ;
7. réalise un commit logique si Git est disponible.

Ne déclare jamais une tâche terminée dans `agend.md` uniquement parce que le code existe.

Une tâche est terminée seulement si :

* le code est fonctionnel ;
* les types sont corrects ;
* les tests passent ;
* les permissions sont vérifiées ;
* la documentation est mise à jour.

---

# 22. Format de tes comptes rendus

Après chaque phase importante, donne un compte rendu concis contenant :

## Réalisé

* éléments implémentés ;
* fichiers principaux ajoutés ou modifiés ;
* migrations créées.

## Vérifications

* commandes exécutées ;
* tests passés ;
* build ;
* lint ;
* vérification TypeScript.

## Sécurité

* politiques RLS ajoutées ;
* permissions vérifiées ;
* risques restant à traiter.

## Suite

* prochaine étape ;
* blocages ;
* décisions nécessaires.

Ne donne pas uniquement une description générale. Effectue réellement les modifications dans le dépôt.

---

# 23. Première séquence d’exécution

Commence maintenant par les actions suivantes :

1. inspecter le dépôt ;
2. résumer son état actuel ;
3. créer `agend.md` ;
4. créer ou mettre à jour `README.md` ;
5. définir l’architecture ;
6. produire le schéma de base de données ;
7. créer les premières migrations ;
8. créer les politiques RLS initiales ;
9. initialiser l’authentification ;
10. créer la structure d’interface ;
11. implémenter le premier parcours complet :

* connexion ;
* création d’un programme ;
* création de deux parents ;
* création d’un croisement ;
* création d’un lot ;
* test de germination ;
* affichage du résultat dans le tableau de bord ;

12. tester ce parcours ;
13. mettre à jour `agend.md` avec les résultats réels.

À chaque étape, privilégie une solution simple, robuste, testable et documentée.
