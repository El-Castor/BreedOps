# Sauvegardes BreedOps

BreedOps a **deux couches de sauvegarde distinctes**, avec des objectifs différents. Ne pas les confondre : la première ne remplace jamais la seconde.

## A. Export fonctionnel BreedOps (déjà livré)

Accessible depuis l'interface (`/app/import-export`), pour chaque programme et pour l'inventaire de l'équipe :

- **Exports CSV/Excel par registre** : lignées, croisements, familles, lots de graines, phénotypes, cycles expérimentaux, tâches, inventaire — un fichier par entité, réutilisable pour ré-importer ou pour une analyse externe (tableur, R, Python).
- **Classeur de sauvegarde fonctionnelle** (`/app/import-export/backup?program=<id>`) : un classeur Excel multi-feuilles contenant, pour **un programme donné** (plus l'inventaire de l'équipe, non scopé par programme) :
  - une feuille par entité (lignées, croisements, familles, lots, phénotypes, inventaire, cycles, tâches), liées entre elles par leurs codes métier stables (`PROGRAMCODE-P-0001`, etc.) ;
  - une feuille de métadonnées (métriques de version de format `breedops-backup-1`, date de génération, programme, utilisateur).
- **Export de la matrice de sélection** (`/app/phenotypes`) : un export CSV analytique dédié (scores par critère, décision, motif d'élimination), volontairement hors du modèle d'entités réimportables.

### Ce que l'export fonctionnel inclut

- Toutes les lignes **actives** des entités listées ci-dessus, pour le programme choisi (inventaire : pour l'équipe entière).
- Les relations entre entités, via leurs codes métier stables — pas de clés internes UUID exposées.

### Ce que l'export fonctionnel n'inclut PAS

- **Les fichiers binaires des images** (Médias des plantes) — seule leur métadonnée (qui, quand, quelle entité) apparaît dans la feuille `media`, le fichier lui-même n'y est jamais inclus. Limitation documentée du jalon Médias, pas un oubli.
- **Les lignes archivées** (`deleted_at` renseigné) des registres d'élevage.
- **Le journal d'audit** (`audit_logs`), les comptes utilisateurs, les mots de passe, les rôles.
- **La configuration des critères de sélection** (modèles, pondérations, règles éliminatoires) — seules les évaluations déjà calculées apparaissent, pas la configuration qui les a produites.
- Tout ce qui n'appartient pas au programme choisi (l'export est volontairement scopé).

### Usage prévu

- Partage d'un sous-ensemble de données avec un collaborateur externe, un rapport, une analyse ponctuelle.
- Point de départ pour un **ré-import** dans un autre programme ou une autre instance BreedOps (via `/app/import-export`, avec aperçu et validation avant application).

### Limites de restauration

Ce n'est **pas** un mécanisme de reprise après sinistre : il ne restaure ni les comptes, ni les droits, ni la configuration du phénotypage, ni les images, ni l'historique d'audit. Pour cela, voir la couche B ci-dessous.

---

## B. Sauvegarde infrastructure (PostgreSQL + Stockage)

Couvre tout ce que l'export fonctionnel ne couvre pas : la base PostgreSQL complète (tous les programmes, tous les comptes, toute la configuration, tout l'historique) et les fichiers binaires du bucket Stockage (`breedops-media`).

### Outils

- `scripts/backup-infra.mjs` — sauvegarde : schéma + données PostgreSQL (via le CLI Supabase déjà utilisé partout ailleurs dans ce dépôt) et chaque fichier du bucket Stockage choisi, téléchargés via l'API REST de Stockage (jamais en accédant directement aux volumes Docker — fonctionne à l'identique en local ou en auto-hébergement réel).
- `scripts/restore-infra.mjs` — restauration, dans une base/bucket cible fournis explicitement en ligne de commande.

### Ce qu'elle inclut

- Le schéma PostgreSQL complet (`schema.sql`) — utile en reprise après sinistre si les migrations elles-mêmes sont indisponibles, mais **le schéma de référence reste les migrations versionnées** (`supabase/migrations/`), jamais ce fichier.
- Toutes les données de tous les schémas (`data.sql`), à l'exception délibérée de `storage.buckets`/`storage.migrations` (bookkeeping interne de Supabase, déjà recréé par le démarrage d'une pile fraîche — les restaurer provoquerait un conflit de clé primaire sans rien restaurer d'utile).
- Tous les fichiers binaires du bucket Stockage, avec leur type MIME d'origine (`media-content-types.json`), pour que la restauration réussisse même avec la liste blanche stricte de types MIME du bucket.

### Fréquence recommandée (V1, auto-hébergement)

- **Quotidienne** pour les données (faible volume attendu en V1 ; un `pg_dump` quotidien est largement suffisant).
- **Avant toute mise à niveau** (nouvelle migration, mise à jour de version) — toujours sauvegarder juste avant.
- **Hebdomadaire** pour une copie complète archivée à long terme (rétention ci-dessous).

### Rétention recommandée

- 7 sauvegardes quotidiennes glissantes.
- 4 sauvegardes hebdomadaires glissantes.
- 1 sauvegarde mensuelle conservée au moins 6 mois.
- Avant suppression d'une sauvegarde ancienne, vérifier qu'au moins une sauvegarde plus récente a déjà été validée par une restauration de test (voir ci-dessous).

### Stockage et chiffrement

- Chaque sauvegarde (`backups/<horodatage>/`) contient un dump SQL complet **et** les fichiers binaires — à traiter comme aussi sensible que la base elle-même (données personnelles des comptes, données scientifiques du programme).
- Ne jamais commiter un répertoire de sauvegarde dans Git.
- Copier chaque sauvegarde vers un support **hors de la machine qui héberge BreedOps** (disque externe chiffré, stockage objet chiffré côté serveur) — une sauvegarde qui ne quitte jamais le Mac mini ne protège pas contre une panne matérielle de ce même Mac mini.
- Si la sauvegarde est stockée sur un support partagé ou dans le cloud, chiffrer l'archive elle-même (ex. `age`, `gpg`, ou le chiffrement natif du support de stockage) avant de la transférer.

### Vérification de restauration

Une stratégie de sauvegarde n'est validée que si une restauration a réellement été testée. Voir « Exercice de restauration » ci-dessous pour la procédure — **toujours sur une infrastructure jetable**, jamais sur l'instance retenue/production.

### Procédure de secours (reprise après sinistre)

1. Provisionner une nouvelle pile Supabase locale (`npm run db:start` — applique automatiquement toutes les migrations versionnées depuis zéro).
2. Restaurer les données de la sauvegarde la plus récente validée :
   ```
   node scripts/restore-infra.mjs \
     --backup backups/<horodatage> \
     --db-url <url de la nouvelle base> \
     --storage-url <url Stockage de la nouvelle pile> \
     --service-role-key <clé service-role de la nouvelle pile> \
     --bucket breedops-media \
     --skip-schema \
     --confirm-disposable
   ```
   (`--skip-schema` : la pile fraîchement provisionnée a déjà le bon schéma via ses migrations ; ne l'omettre que si on restaure dans une base sans aucun schéma BreedOps.)
3. Reconfigurer `.env.local`/les variables d'environnement de production vers la nouvelle pile.
4. Exécuter un test applicatif de base (connexion, lecture d'un programme, d'une image) avant de considérer l'environnement de nouveau fiable.

---

## Exercice de restauration (validé pour ce jalon)

Un exercice complet a été réalisé sur infrastructure strictement jetable (jamais la base retenue) :

1. Données représentatives créées sur une pile jetable (organisation, programme, lignées, croisement, famille, lot de graines, modèle de sélection, évaluation phénotypique, article et lot d'inventaire, une image de média réelle).
2. Sauvegarde produite via `scripts/backup-infra.mjs`.
3. Restauration dans une **seconde** pile jetable, entièrement neuve (migrations appliquées depuis zéro, puis données restaurées avec `--skip-schema`).
4. Vérification : comptages identiques sur chaque table (`organizations`, `programs`, `parent_lines`, `crosses`, `families`, `seed_lots`, `phenotype_evaluations`, `inventory_items`, `media_assets`, `auth.users`, `storage.objects`) entre la source et la cible restaurée.
5. Test applicatif réel : connexion avec le compte restauré, navigation sur le registre d'élevage, le classement phénotypique, l'inventaire, et l'image de média restaurée **s'affiche réellement** (chargement binaire confirmé, pas seulement sa métadonnée).

Résultat : `BACKUP_RESTORE_DRILL=PASS`. Les deux piles jetables ont été détruites après l'exercice ; la base retenue de ce bac à sable n'a jamais été touchée.
