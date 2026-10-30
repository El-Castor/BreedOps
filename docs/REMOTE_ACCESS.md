# Accès à distance — recommandation d'architecture

L'utilisateur souhaite, à terme, accéder à BreedOps depuis l'extérieur de son réseau local, sans compromettre la sécurité du Mac mini (ou serveur) qui l'héberge. **Ce document est une recommandation à mettre en œuvre volontairement** — rien ici n'est configuré automatiquement, et aucune hypothèse n'est faite sur ce qui est déjà en place (SSH, Tailscale, Cloudflare ou autre) sur la machine de l'utilisateur.

## Architecture cible

```
Internet / réseau privé de confiance
        │
        ▼
  Point d'entrée HTTPS protégé
        │
        ▼
   Application BreedOps
        │
        ▼
  Services Supabase locaux
```

PostgreSQL et les services internes Supabase (API REST, Auth, Storage) **ne doivent jamais** être exposés directement sur Internet — seule l'application Next.js (elle-même déjà protégée : CSP, cookies HttpOnly/Secure/SameSite, CSRF par vérification d'origine, limitation des tentatives de connexion) doit être atteignable depuis l'extérieur, et uniquement via un point d'entrée HTTPS.

## Options comparées

### 1. VPN/maillage privé (ex. Tailscale) — **recommandation par défaut**

- Principe : chaque appareil autorisé (le Mac mini et les appareils de l'utilisateur) rejoint un réseau privé virtuel ; BreedOps reste accessible uniquement via l'adresse privée du maillage, jamais via une adresse publique.
- Avantages : surface d'exposition publique nulle (aucun port ouvert sur l'internet public) ; authentification au niveau réseau gérée par le fournisseur du maillage, indépendante de BreedOps ; configuration très simple côté serveur et côté client ; révocation d'un appareil immédiate et centralisée.
- Inconvénients : dépendance à un service tiers pour l'établissement de la connexion (le trafic applicatif, une fois connecté, circule en pair-à-pair ou par leur relais chiffré selon le produit) ; nécessite d'installer un client sur chaque appareil qui doit accéder à BreedOps.
- **C'est l'option recommandée pour un premier accès à distance** : elle minimise l'exposition publique à zéro tout en restant simple à mettre en place sur un Mac mini.

### 2. Reverse proxy + TLS, exposé publiquement

- Principe : un reverse proxy (Caddy, Nginx, Traefik) écoute sur le port 443 public, termine TLS (certificat Let's Encrypt par exemple) et transmet uniquement les requêtes HTTP vers BreedOps en interne (`127.0.0.1:3107`).
- Avantages : accès direct par URL classique, sans client VPN à installer ; standard, bien documenté.
- Inconvénients : le port 443 est exposé publiquement — surface d'attaque réelle (scans automatisés permanents sur Internet, nécessité de maintenir le reverse proxy et ses certificats à jour, pare-feu applicatif recommandé en complément). BreedOps lui-même protège déjà ses propres endpoints (voir l'audit sécurité de ce jalon), mais un reverse proxy exposé ajoute une responsabilité de maintenance continue (mises à jour de sécurité du proxy lui-même, renouvellement TLS, surveillance des tentatives d'intrusion).
- Recommandée seulement si un accès par URL publique classique est un besoin explicite et que l'utilisateur accepte la responsabilité de maintenance qui l'accompagne — en combinaison avec un pare-feu restrictif et, idéalement, une limitation d'accès par IP source si les emplacements d'accès sont prévisibles.

### 3. Exposition publique directe des ports Supabase/PostgreSQL

**Non recommandée, à éviter.** Exposer directement PostgreSQL (port 5432/54322) ou l'API Supabase brute sur Internet contourne toutes les couches de protection applicative de BreedOps (limitation des tentatives de connexion, CSRF, CSP) et expose une base de données complète à un service dont le protocole n'est pas conçu pour l'exposition publique directe. Aucune des deux options recommandées ci-dessus n'a besoin de cela : PostgreSQL et les services internes Supabase restent toujours uniquement accessibles en local (`127.0.0.1`) ou via le réseau privé du maillage — jamais directement depuis l'extérieur.

## Ce qui doit rester privé, dans tous les cas

- Le port PostgreSQL (`54322`/`55422` ou équivalent en production) — jamais exposé, même derrière le reverse proxy de l'option 2 (le proxy ne doit relayer que le port de l'application Next.js, 3107).
- Les ports internes Supabase (API REST brute, Auth, Storage) — l'application Next.js seule doit leur parler, en local.
- La clé `SUPABASE_SERVICE_ROLE_KEY` — jamais transmise au client, jamais journalisée (déjà vérifié par `npm run security:client-secrets`).

## TLS

- Option 1 (VPN) : TLS est généralement géré par le fournisseur du maillage pour son propre trafic de contrôle ; pour le trafic applicatif lui-même, HTTPS reste recommandé en interne si plusieurs utilisateurs non totalement sûrs accèdent via le maillage.
- Option 2 (reverse proxy public) : TLS est obligatoire, jamais optionnel — un certificat Let's Encrypt automatiquement renouvelé (Caddy le fait nativement) est la solution la plus simple à maintenir.

## Pare-feu

- Dans les deux options, le pare-feu de la machine hôte ne doit laisser passer que : le port du maillage VPN (option 1) ou le port 443 du reverse proxy (option 2) — jamais 3107, 54322/55422 ou tout autre port interne directement depuis l'extérieur.
- macOS : pare-feu applicatif natif (Préférences Système → Sécurité) suffit pour un usage simple ; `pf` pour un contrôle plus fin.
- Linux : `ufw` ou `nftables`.

## Authentification

BreedOps authentifie déjà ses propres utilisateurs (Supabase Auth + RLS + les trois rôles V1) — l'accès à distance ne doit **jamais** remplacer cette authentification applicative, seulement ajouter une couche réseau supplémentaire avant d'atteindre l'application. Avec l'option 1 (VPN), l'appartenance au maillage n'est pas une authentification applicative : un utilisateur sur le maillage doit toujours se connecter normalement à BreedOps ensuite.

## Mises à jour

- Le reverse proxy (option 2) et le client VPN (option 1) sont des logiciels à part entière, avec leurs propres vulnérabilités potentielles — à maintenir à jour indépendamment de BreedOps lui-même. Documenter leur propre procédure de mise à jour dans l'inventaire de maintenance de l'administrateur.

## SSH

Si un accès SSH à la machine hôte elle-même (pour l'administration, hors BreedOps) est nécessaire à distance : ne jamais l'exposer directement sur Internet non plus — le faire passer par le même maillage VPN (option 1) que l'application, ou au minimum désactiver l'authentification par mot de passe (clé publique uniquement) et changer le port par défaut si une exposition directe est malgré tout choisie.

## Séparation développement / production

Indépendamment de l'accès réseau choisi : le Mac mini de développement de l'utilisateur et la machine qui héberge BreedOps en production doivent être, à terme, des machines distinctes (ou au moins des checkouts/configurations strictement séparés sur la même machine, voir `docs/DEPLOYMENT_GUIDE.md` Option A) — un accès à distance à la production ne doit jamais transiter par un compte ou une session utilisée aussi pour développer.

## Ce que ce jalon n'a pas fait

Conformément à la consigne : rien dans ce jalon n'a configuré d'accès réseau réel, de VPN, de reverse proxy ou de pare-feu sur une machine réelle. Ce document est une recommandation ; sa mise en œuvre reste un choix et une action délibérés de l'utilisateur, sur sa propre machine.
