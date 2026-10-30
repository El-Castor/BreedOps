# Guide de déploiement

BreedOps V1 est d'abord destiné à un hébergement propre (self-hosted), sur un Mac mini, puis potentiellement sur un serveur interne (par exemple INRAE). Ce guide couvre les deux cas. Pour l'exploitation une fois déployé (sauvegardes, mises à niveau, dépannage), voir `docs/ADMIN_GUIDE.md`. Pour l'accès à distance, voir `docs/REMOTE_ACCESS.md`.

**Important** : ce guide a été écrit et vérifié sur une infrastructure jetable (sandbox cloud), jamais sur le Mac mini réel de l'utilisateur. Il n'affirme à aucun moment que le déploiement réel fonctionne — seule une validation effectuée par l'utilisateur sur sa propre machine peut l'affirmer. Voir la distinction `SANDBOX_VALIDATED` / `REAL_MAC_VALIDATED` dans le rapport final de ce jalon.

## Principes communs aux deux options

- **Checkout de production dédié**, distinct de tout checkout de développement — jamais le même répertoire que celui utilisé pour coder/tester.
- **Configuration d'environnement dédiée** (`.env.local` de production), jamais partagée avec un environnement de développement ou de test.
- **Identité de projet et ports Supabase dédiés** — si plusieurs instances Supabase locales doivent coexister sur la même machine (développement + production), chacune a son propre `project_id` et ses propres ports dans `supabase/config.toml` du checkout correspondant. C'est exactement le mécanisme que `npm run release:check` applique lui-même (voir le tableau d'isolation dans `docs/RELEASE_CHECKLIST.md`) pour pouvoir s'exécuter sans risque sur une machine où une pile réelle tourne déjà — le même principe, pas seulement une analogie.
- **La donnée de production ne doit jamais dépendre d'une session shell développeur** : le service de production doit démarrer au boot de la machine et survivre à la fermeture de tout terminal, indépendamment de toute session de travail.

## Option A — Mac mini

Objectif : BreedOps tourne en continu ; l'utilisateur peut continuer à développer sur la même machine ; le service de production est isolé du développement ; les données de production ne sont jamais liées à une session shell de développeur.

### 1. Checkout de production dédié

```sh
mkdir -p ~/BreedOps-production
git clone <url-du-depot> ~/BreedOps-production/app
cd ~/BreedOps-production/app
git checkout main   # ou le tag de release choisi
```

Le checkout de développement habituel (utilisé pour coder) reste entièrement séparé, par exemple `~/Developer/BreedOps`.

### 2. Configuration d'environnement dédiée

Dans `~/BreedOps-production/app/supabase/config.toml`, donner à cette instance un `project_id` et des ports distincts du Supabase de développement (par exemple `BreedOps-prod` et ports 56000+ au lieu des 55420–55429 par défaut), pour que `docker ps` les distingue sans ambiguïté et qu'aucune commande de développement ne puisse jamais atteindre cette instance par erreur.

```sh
npm ci
npm run db:start
npm run local:configure
npm run local:provision-admin
```

Éditer ensuite `~/BreedOps-production/app/.env.local` pour fixer `APP_ORIGIN` à l'origine réelle qui sera utilisée (par exemple `https://breedops.exemple.local` si un reverse proxy avec TLS est en place — voir `docs/REMOTE_ACCESS.md`) et `ALLOW_SELF_SIGNUP=false` (sauf besoin explicite contraire).

### 3. Démarrage de Docker et de l'application au démarrage de la machine

Sur macOS, Docker Desktop doit démarrer automatiquement (option « Start Docker Desktop when you log in » dans ses préférences). Pour que l'application Next.js elle-même survive à la fermeture du terminal et redémarre après un redémarrage de la machine, utiliser un agent de lancement macOS (`launchd`) plutôt qu'un processus en arrière-plan lancé depuis un terminal interactif :

Créer `~/Library/LaunchAgents/com.breedops.production.plist` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.breedops.production</string>
  <key>WorkingDirectory</key><string>/Users/<utilisateur>/BreedOps-production/app</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>run</string>
    <string>start</string>
    <string>--</string>
    <string>--hostname</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>3107</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<utilisateur>/BreedOps-production/logs/stdout.log</string>
  <key>StandardErrorPath</key><string>/Users/<utilisateur>/BreedOps-production/logs/stderr.log</string>
</dict>
</plist>
```

```sh
mkdir -p ~/BreedOps-production/logs
npm run build   # depuis ~/BreedOps-production/app, avant le premier chargement de l'agent
launchctl load ~/Library/LaunchAgents/com.breedops.production.plist
```

`KeepAlive` relance automatiquement le processus s'il s'arrête de façon inattendue. `launchctl unload <plist>` l'arrête proprement (par exemple avant une mise à niveau manuelle — voir `docs/ADMIN_GUIDE.md` §9).

### 4. Logs, sauvegardes, mises à niveau

Voir `docs/ADMIN_GUIDE.md`. Les logs applicatifs vont dans `~/BreedOps-production/logs/` (chemin fixé par le fichier `.plist` ci-dessus) ; les logs des services Supabase/Docker restent accessibles via `docker logs <conteneur>`.

## Option B — Serveur Linux (Ubuntu/Debian)

Architecture équivalente, en privilégiant une installation pilotée par le dépôt plutôt que des hypothèses propres à macOS.

### 1. Prérequis

- Docker Engine + Docker Compose (voir la documentation officielle Docker pour Ubuntu/Debian — pas Docker Desktop, inutile sur un serveur).
- Node.js 22.x (la version validée pour ce projet).

### 2. Checkout et configuration

```sh
sudo useradd -m -s /bin/bash breedops   # utilisateur de service dédié, jamais root
sudo -iu breedops
git clone <url-du-depot> ~/app
cd ~/app
git checkout main
npm ci
npm run db:start
npm run local:configure
npm run local:provision-admin
npm run build
```

Même principe qu'en Option A pour `project_id`/ports Supabase dédiés si plusieurs instances coexistent sur le même serveur, et pour `.env.local` (`APP_ORIGIN`, `ALLOW_SELF_SIGNUP=false`).

### 3. Supervision de processus : systemd

Créer `/etc/systemd/system/breedops.service` :

```ini
[Unit]
Description=BreedOps production server
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=breedops
WorkingDirectory=/home/breedops/app
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3107
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now breedops.service
sudo systemctl status breedops.service
journalctl -u breedops.service -f   # logs en continu
```

`Restart=on-failure` relance le service s'il s'arrête de façon inattendue ; `enable` le fait démarrer automatiquement au boot du serveur.

### 4. Mise à niveau

```sh
sudo systemctl stop breedops.service
sudo -iu breedops bash -c 'cd ~/app && git pull && npm ci && npm run db:migrate && npm run build'
sudo systemctl start breedops.service
```

(Toujours précédé d'une sauvegarde — `docs/ADMIN_GUIDE.md` §8/§9.)

## Sécurité réseau (les deux options)

Ce guide ne configure **aucun accès réseau externe** — ni reverse proxy, ni TLS, ni VPN. Voir `docs/REMOTE_ACCESS.md` pour la comparaison des approches et la recommandation, à mettre en place séparément et volontairement par l'utilisateur. Par défaut, dans les deux options ci-dessus, le serveur Next.js écoute sur `127.0.0.1` uniquement (jamais `0.0.0.0`) — il n'est donc **pas** atteignable depuis le réseau tant qu'aucun reverse proxy n'est explicitement configuré devant lui.
