# Guide administrateur

Ce guide couvre l'exploitation de BreedOps une fois installé : administration quotidienne, sauvegardes, mises à niveau, diagnostic et reprise d'urgence. Pour l'installation initiale elle-même, voir `docs/DEPLOYMENT_GUIDE.md` (choix Mac mini ou Linux). Pour le développement local, voir `docs/local-development.md`. Pour l'usage fonctionnel au quotidien, voir `docs/PILOT_GUIDE.md`.

## 1. Installation initiale et premier démarrage

Résumé (détails complets dans `docs/DEPLOYMENT_GUIDE.md`) :

```sh
npm ci
npm run db:start            # démarre la pile Supabase locale, applique toutes les migrations
npm run local:configure     # écrit .env.local à partir du statut Supabase local
npm run local:provision-admin   # crée le premier compte system_admin (terminal interactif requis)
npm run build
npm run start -- --hostname 127.0.0.1 --port 3107
```

`npm run db:start` applique automatiquement toutes les migrations versionnées (`supabase/migrations/`) depuis zéro sur une pile neuve — il n'y a rien d'autre à faire pour le schéma initial.

## 2. Provisionnement du premier administrateur

`npm run local:provision-admin` (terminal interactif, mot de passe masqué) crée ou répare l'équipe, le compte Auth et le profil `system_admin` requis, et vérifie le mot de passe par une vraie connexion Supabase avant de confirmer le succès. Rejouable sans risque. Ne jamais exécuter cette commande contre un environnement hébergé/tiers — elle est conçue pour le provisionnement initial local/auto-hébergé uniquement.

## 3. Gestion des utilisateurs et des équipes

Depuis `/app/admin/users`, en tant que `system_admin` :

- Inviter un nouvel utilisateur (crée une identité Auth + email d'invitation).
- Assigner une équipe et un rôle (`system_admin`, `team_admin`, `user`) à une identité en attente (inscription libre, si activée via `ALLOW_SELF_SIGNUP=true`).
- Désactiver/réactiver un compte.
- Un `team_admin` peut gérer les utilisateurs ordinaires de sa propre équipe uniquement.

Toute action d'administration utilisateur est journalisée dans `audit_logs` (voir §7).

## 4. Réinitialisation de mot de passe

- Compte local administrateur : `npm run local:reset-password` (terminal interactif, ne journalise jamais le mot de passe en clair, vérifie la nouvelle connexion avant de confirmer).
- Pour un autre utilisateur : flux de récupération standard Supabase Auth (email de récupération — capturé localement par Mailpit sur `http://127.0.0.1:55424` en développement ; un serveur SMTP réel est requis en production, voir `docs/DEPLOYMENT_GUIDE.md`).

## 5. Limitation des tentatives de connexion

Chaque échec de connexion est compté côté serveur, par email et par adresse IP cliente (deux compteurs indépendants). À partir de la 5ᵉ tentative consécutive échouée, un verrou de plus en plus long s'applique (30 s, 60 s, 120 s… plafonné à 15 min). Un mot de passe correct réinitialise immédiatement le compteur. Rien de ceci n'est visible ou modifiable depuis le navigateur ; aucun mot de passe n'est jamais stocké. Si le site est servi via un reverse proxy, celui-ci doit transmettre l'en-tête `X-Forwarded-For` pour que la limitation par IP soit pertinente (sinon toutes les requêtes directes partagent le même compteur "direct" — document voulu, voir le commentaire dans `src/app/auth/login/route.ts`). Une protection complémentaire au niveau du reverse proxy est recommandée (voir `docs/DEPLOYMENT_GUIDE.md` §Sécurité réseau) mais n'est pas un prérequis pour que cette protection applicative fonctionne.

## 6. Migrations

- **Nouvelle installation** : `npm run db:start` applique tout depuis zéro, contre le projet Supabase canonique défini par `supabase/config.toml` de ce checkout (celui que `npm run release:check` ne touche jamais — voir l'encadré ci-dessous).
- **Pile déjà en service, nouvelle version du code apportant de nouvelles migrations** : `npm run db:migrate` (`supabase migration up --local`) applique uniquement les migrations non encore appliquées, sans toucher aux données existantes.
- **Ne jamais** exécuter `supabase db reset` ni `supabase stop --no-backup` contre une base contenant de vraies données — ces deux commandes détruisent les données locales. `npm run db:stop` arrête la pile en conservant son volume de données.
- Toujours sauvegarder (§8) avant d'appliquer une nouvelle migration à une base réelle.

> **`npm run db:start` n'est jetable que sous le profil `release-check`.** Par défaut
> (sans `BREEDOPS_STACK_PROFILE=release-check`), `db:start`/`db:stop`/`local:configure`
> opèrent sur le projet canonique de ce checkout — c'est le comportement voulu pour une
> installation réelle. `npm run release:check` (voir `docs/RELEASE_CHECKLIST.md`) utilise
> en interne un projet Supabase entièrement séparé (identité, ports, conteneur et volume
> différents) précisément pour pouvoir s'exécuter sans risque sur une machine où la pile
> réelle tourne déjà ; il ne faut pas en déduire que `db:start` lui-même est toujours
> jetable.
- Les migrations sont strictement additives et versionnées (`supabase/migrations/000001...`) ; aucune n'est jamais modifiée après avoir été appliquée à une base réelle.

## 7. Journaux et audit

- **Journal d'audit applicatif** (`audit_logs`, table PostgreSQL) : toute mutation sensible (changement de statut de lot, administration utilisateur, import/export, réinitialisation de mot de passe par un administrateur) y est enregistrée avec qui, quand, quoi — visible depuis l'interface pour les rôles autorisés.
- **Logs applicatifs** : sortie standard du processus `next start` (stdout/stderr) — à rediriger vers un fichier ou un service de supervision de processus (voir `docs/DEPLOYMENT_GUIDE.md` pour la supervision recommandée par plateforme).
- **Logs PostgreSQL/Supabase** : `docker logs supabase_db_<project_id>` (et `supabase_auth_<project_id>`, `supabase_rest_<project_id>`, `supabase_storage_<project_id>` pour les autres services). Utile pour diagnostiquer une erreur qui n'apparaît pas clairement côté application.

## 8. Sauvegardes et restauration

Voir `docs/BACKUP.md` pour la stratégie complète (deux couches : export fonctionnel applicatif, et sauvegarde infrastructure PostgreSQL + Stockage). Commandes :

```sh
node scripts/backup-infra.mjs \
  --db-url <url de connexion PostgreSQL> \
  --storage-url <url de l'API Stockage> \
  --service-role-key <clé service-role> \
  --bucket breedops-media \
  --out backups
```

Ne jamais tester une restauration contre l'instance réelle/retenue — toujours sur une infrastructure jetable d'abord (procédure complète dans `docs/BACKUP.md`).

## 9. Mises à niveau

1. Sauvegarder (§8).
2. `git pull` / déployer la nouvelle version du code.
3. `npm ci` (réinstalle les dépendances exactement comme verrouillées).
4. `npm run db:migrate` (applique les nouvelles migrations, s'il y en a).
5. `npm run build`.
6. Redémarrer le processus de production (voir `docs/DEPLOYMENT_GUIDE.md` pour la supervision de processus propre à chaque plateforme).
7. Vérifier `GET /api/health` (§10) et effectuer un contrôle fonctionnel rapide (connexion, une page clé).

## 10. Contrôle de santé (health check)

`GET /api/health` (sans authentification, pour un reverse proxy ou un superviseur de processus) renvoie `{"status":"ok"}` (200) si le processus est démarré et sa configuration requise est présente, ou `{"status":"degraded","reason":"configuration"}` (503) sinon. Il ne révèle jamais de détail d'infrastructure (pas de chaîne de connexion, pas de nom d'hôte interne, pas d'identifiant). Il ne fait pas d'appel réseau vers PostgreSQL/Stockage — c'est un contrôle de démarrage/configuration, pas une sonde de bout en bout.

## 11. Dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| `GET /api/health` renvoie 503 | Variable d'environnement requise manquante (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`) | Vérifier `.env.local`/les variables d'environnement du service de production contre `.env.example` |
| Le serveur de production refuse de démarrer avec une erreur citant une variable manquante | Même cause — vérification au démarrage (`src/instrumentation.ts`), volontairement bloquante en production | Fournir la variable manquante avant de redémarrer |
| Connexion impossible, message « Erreur de configuration serveur » | `SUPABASE_SERVICE_ROLE_KEY` absent ou invalide | Vérifier la clé dans `.env.local`/l'environnement du service |
| Connexion refusée après plusieurs essais corrects | Limitation des tentatives de connexion encore active (§5) | Attendre le délai indiqué, ou vérifier `auth_rate_limits` en base si besoin d'une levée manuelle exceptionnelle |
| Upload d'image rejeté avec un message de format | Fichier non JPEG/PNG/WebP réel (le serveur vérifie le contenu, pas seulement l'extension) ou dépassant 10 Mo | Attendu — vérifier le fichier source |
| `npm run db:migrate` échoue | Migration en conflit avec l'état réel de la base | Ne pas réessayer en boucle ; inspecter manuellement l'état (`supabase migration list --local`) avant toute action corrective |

## 12. Stockage des médias (Plant Media)

Les fichiers images vivent dans le bucket privé Supabase Storage `breedops-media`, jamais dans un bucket public, et ne sont jamais servis par une URL permanente — uniquement par une URL signée à courte durée de vie générée à la demande. `npm run media:check-orphans` est une vérification de maintenance en lecture seule : elle compare les objets du bucket aux métadonnées `media_assets.storage_path` et signale les incohérences (objet sans métadonnée, ou métadonnée sans objet) sans rien supprimer.

## 13. Récupération d'urgence

1. Ne jamais paniquer-exécuter une commande destructive (`supabase db reset`, `supabase stop --no-backup`) sur la base réelle en espérant « repartir propre » — cela détruit les données.
2. Identifier précisément le problème (service arrêté ? base corrompue ? migration en échec ? disque plein ?) via les journaux (§7) avant d'agir.
3. Si la base réelle est effectivement perdue ou corrompue de façon irrécupérable : provisionner une nouvelle pile (`npm run db:start` — migrations appliquées depuis zéro) puis restaurer la sauvegarde la plus récente validée (`docs/BACKUP.md` §Procédure de secours).
4. Si seul le processus applicatif est en cause (pas la base) : redémarrer le processus de production ; les données PostgreSQL/Stockage ne sont pas affectées par un redémarrage du processus Next.js.
5. Après toute récupération, exécuter la suite d'acceptation (`npm run release:check`, voir `docs/RELEASE_CHECKLIST.md`) contre une pile jetable avant de déclarer l'incident clos — jamais contre la base réelle elle-même.
