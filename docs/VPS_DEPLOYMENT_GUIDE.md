# Guide de déploiement VPS — SB Auto

Guide **pas-à-pas** pour déployer les trois applications sur un VPS **Ubuntu 24.04
LTS**, sans connaissance préalable du code. À la fin : la vitrine, le manager et
l'API tournent en HTTPS derrière Nginx, l'API supervisée par PM2, avec pare-feu,
Fail2Ban, sauvegardes et procédure de rollback.

## Architecture cible

```
                          ┌────────────────────────── VPS Ubuntu 24.04 ──────────────────────────┐
 Internet ── HTTPS ──►    │  Nginx (80/443, Certbot)                                              │
                          │   ├─ domaine.com          → fichiers statiques  vitrine/dist          │
                          │   ├─ manager.domaine.com  → fichiers statiques  manager/dist          │
                          │   └─ api.domaine.com      → reverse proxy → 127.0.0.1:6060 (PM2)       │
                          │                                    └─ /uploads (fichiers) + /api       │
                          └───────────────────────────────────────────────────────────────────────┘
                                                     │
                                          MongoDB (Atlas recommandé, ou local)
```

- **Seule l'API tourne en process** (Node + PM2). Le manager et la vitrine sont des
  **sites statiques** (build Vite) servis directement par Nginx.
- Les 3 ports internes du repo (6060/6061/6062) ne servent qu'au dev local ; en
  prod seul **6060** (API) est utilisé en interne, jamais exposé directement.

> Remplacez partout `domaine.com` par votre domaine et `deploy` par votre
> utilisateur non-root.

---

## 1. Préparer le VPS

Connectez-vous en root puis créez un utilisateur non-root :

```bash
adduser deploy
usermod -aG sudo deploy
# (optionnel) copier votre clé SSH
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
su - deploy
```

Mettez à jour le système et installez les outils de base :

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw fail2ban
```

## 2. Installer Node.js LTS

Node **20+** est requis (`backend/package.json` : `"engines": { "node": ">=20" }`).
Installez la LTS via NodeSource :

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
npm -v
```

## 3. Installer PM2

```bash
sudo npm install -g pm2
pm2 -v
```

## 4. Installer Nginx et Certbot

```bash
sudo apt install -y nginx
sudo apt install -y certbot python3-certbot-nginx
```

## 5. Configurer le DNS

Chez votre registrar, créez **trois enregistrements `A`** pointant vers l'IP
publique du VPS :

| Type | Nom       | Valeur (cible) |
| ---- | --------- | -------------- |
| A    | `@`       | `IP_DU_VPS`    |
| A    | `manager` | `IP_DU_VPS`    |
| A    | `api`     | `IP_DU_VPS`    |

Attendez la propagation (`dig +short domaine.com` doit renvoyer l'IP du VPS)
avant l'étape HTTPS.

## 6. MongoDB

**Option recommandée — MongoDB Atlas** (aucune installation serveur) : créez un
cluster, un utilisateur, autorisez l'IP du VPS (Network Access), récupérez l'URI
`mongodb+srv://…`. C'est la valeur `MONGODB_URI`.

**Option locale** (si vous préférez héberger la base sur le VPS) :

```bash
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```
Dans ce cas `MONGODB_URI=mongodb://127.0.0.1:27017`. **Ne jamais exposer 27017**
sur Internet (UFW le bloque déjà, cf. §14).

## 7. Récupérer le code

```bash
sudo mkdir -p /var/www && sudo chown deploy:deploy /var/www
cd /var/www
git clone https://github.com/Luca-dhx/sbauto06.git sbauto
cd sbauto
```

## 8. Configurer le backend (`.env`)

```bash
cd /var/www/sbauto/backend
cp .env.example .env
nano .env
```

Renseignez (voir aussi la check-list de pré-vol de l'audit) :

```env
# Le backend REFUSE de démarrer si ENV n'est pas explicitement TEST ou PROD.
ENV=PROD

MONGODB_URI=mongodb+srv://user:motdepasse@cluster.mongodb.net
DB_TEST=sbauto_test
DB_PROD=sbauto_prod

# Secret long et aléatoire — générez-le : openssl rand -base64 48
JWT_SECRET=collez-ici-une-chaine-aleatoire-de-plus-de-32-caracteres
JWT_EXPIRES_IN=7d

PORT=6060

# Origines autorisées (le manager et la vitrine) — vrais domaines HTTPS
CORS_ORIGINS=https://domaine.com,https://manager.domaine.com

# URL publique de l'API — sert à construire les URLs d'images (/uploads)
PUBLIC_URL=https://api.domaine.com

# PREMIER ACCÈS D'ADMINISTRATION (LOT 2C) — une identité, jamais un secret.
# Sur une base vierge, le projet crée UN compte DEV portant cette adresse, SANS
# mot de passe, et lui envoie un lien d'activation à usage unique. Aucun mot de
# passe n'est lu depuis l'environnement, ni écrit sur ce disque.
# Sans FIRST_DEV_EMAIL, aucun compte n'est créé (FIRST_DEV_REQUIRED).
FIRST_DEV_EMAIL=vous@votre-domaine.com
FIRST_DEV_NAME=Votre Nom
```

Générer un bon secret : `openssl rand -base64 48`.

> **Données PROD déjà migrées** : si `DB_PROD` a déjà été alimentée via
> `npm run db:promote` (voir [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md)),
> les comptes existent déjà et le bootstrap ne les recrée pas. Vérifiez tout de
> même que leurs mots de passe ont été changés depuis les valeurs de démo.

Installez les dépendances et lancez la config réseau/CORS (facultatif ici, se fait
aussi depuis le manager en DEV) :

```bash
npm ci --omit=dev   # ou: npm install --production
```

## 9. Builder le manager et la vitrine

Chaque front a besoin de l'URL **publique** de l'API au moment du build
(`VITE_API_URL`).

```bash
# Manager
cd /var/www/sbauto/manager
cp .env.example .env
echo "VITE_API_URL=https://api.domaine.com" > .env
npm ci
npm run build          # génère manager/dist

# Vitrine
cd /var/www/sbauto/vitrine
cp .env.example .env
echo "VITE_API_URL=https://api.domaine.com" > .env
npm ci
npm run build          # génère vitrine/dist
```

## 10. Démarrer l'API avec PM2

Créez un fichier PM2 à la racine du repo :

```bash
nano /var/www/sbauto/ecosystem.config.cjs
```

```js
module.exports = {
  apps: [
    {
      name: 'sbauto-api',
      cwd: '/var/www/sbauto/backend',
      script: 'src/server.js',
      instances: 1,           // fork (le rate-limiter est en mémoire → 1 instance)
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 11000,    // laisse l'arrêt gracieux drainer (10 s) avant SIGKILL
      env: { NODE_ENV: 'production' },
      // ENV applicatif (TEST/PROD) et secrets viennent de backend/.env
      out_file: '/home/deploy/.pm2/logs/sbauto-api.out.log',
      error_file: '/home/deploy/.pm2/logs/sbauto-api.err.log',
    },
  ],
};
```

Lancez et vérifiez :

```bash
cd /var/www/sbauto
pm2 start ecosystem.config.cjs
pm2 logs sbauto-api --lines 30      # doit afficher « API prête … (ENV=PROD) »
curl -s http://127.0.0.1:6060/health   # {"success":true,"data":{"status":"ok","env":"PROD"}}
```

## 11. Redémarrage automatique au boot

```bash
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
# Exécutez la commande `sudo env PATH=… pm2 startup …` affichée, puis :
pm2 save
```

## 12. Configurer les hôtes virtuels Nginx

Créez un fichier par site. **D'abord en HTTP** (Certbot ajoutera le HTTPS).

### API — `/etc/nginx/sites-available/api.domaine.com`

```nginx
server {
    listen 80;
    server_name api.domaine.com;

    client_max_body_size 15m;   # cohérent avec la limite d'upload (12 Mo) + marge

    location / {
        proxy_pass http://127.0.0.1:6060;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache long pour les médias (noms de fichiers immuables générés par le backend)
    location /uploads/ {
        proxy_pass http://127.0.0.1:6060;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Vitrine — `/etc/nginx/sites-available/domaine.com`

```nginx
server {
    listen 80;
    server_name domaine.com www.domaine.com;
    root /var/www/sbauto/vitrine/dist;
    index index.html;

    # SPA : toute route inconnue renvoie index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache long pour les assets fingerprintés (hash dans le nom)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

### Manager — `/etc/nginx/sites-available/manager.domaine.com`

```nginx
server {
    listen 80;
    server_name manager.domaine.com;
    root /var/www/sbauto/manager/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

Activez les sites et rechargez :

```bash
sudo ln -s /etc/nginx/sites-available/api.domaine.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/domaine.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/manager.domaine.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 13. Activer HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d domaine.com -d www.domaine.com -d manager.domaine.com -d api.domaine.com
```

Certbot édite les vhosts (redirection 80→443, certificats) et installe un timer de
renouvellement automatique. Vérifiez : `sudo certbot renew --dry-run`.

> Après HTTPS, confirmez que `CORS_ORIGINS`/`PUBLIC_URL` (backend `.env`) et
> `VITE_API_URL` (fronts, au build) utilisent bien `https://`. Si vous les changez,
> reconstruisez les fronts (§9) et `pm2 restart sbauto-api`.

## 14. Pare-feu (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH          # 22
sudo ufw allow 'Nginx Full'     # 80 + 443
sudo ufw enable
sudo ufw status
```

Les ports 6060 (API) et 27017 (Mongo local éventuel) restent **internes** — jamais
ouverts.

## 15. Fail2Ban

Fail2Ban bannit les IP qui abusent de SSH (et, en option, de Nginx).

```bash
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

Assurez-vous d'avoir au minimum :

```ini
[sshd]
enabled = true
maxretry = 5
bantime = 1h

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
```

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
```

> L'API a déjà un limiteur anti-brute-force applicatif sur `/auth/login`
> (30 req/15 min/IP). Fail2Ban ajoute une défense réseau.

## 16. Permissions des fichiers & uploads

Le dossier des médias uploadés est `backend/uploads/` (le backend y écrit via
Sharp/Multer). Il doit appartenir à l'utilisateur qui exécute PM2 :

```bash
cd /var/www/sbauto/backend
mkdir -p uploads
sudo chown -R deploy:deploy /var/www/sbauto
chmod 755 uploads
```

Ce dossier est **exclu de Git** (`.gitignore`) : il persiste entre les déploiements
et doit être **sauvegardé** (§19).

**Nettoyage automatique des orphelins.** Le backend supprime lui-même les fichiers
devenus inutiles : après chaque mutation réussie, un balayage anti-orphelins
référence-compté (`storage.service.js`) efface les fichiers `/uploads/*` non
référencés par `DB_TEST` ∪ `DB_PROD` (avec période de grâce). Aucune action
d'exploitation requise. Pour un nettoyage complet ponctuel des fichiers déjà
accumulés :

```bash
cd /var/www/sbauto/backend
npm run uploads:cleanup          # dry-run : liste les orphelins
npm run uploads:cleanup:apply    # supprime réellement
```

> ⚠️ `uploads/` est **partagé entre TEST et PROD**. Le balayage en tient compte
> (il ne supprime un fichier que s'il n'est référencé par **aucune** des deux
> bases) — ne jamais remplacer ce mécanisme par une suppression naïve par base.

## 17. Logs

- **API (PM2)** : `pm2 logs sbauto-api` (temps réel), fichiers dans
  `~/.pm2/logs/`. Rotation recommandée :
  ```bash
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 14
  ```
- **Nginx** : `/var/log/nginx/access.log` et `error.log`.
- **Healthcheck** : `GET https://api.domaine.com/health`.

## 18. Mettre à jour (déploiement d'une nouvelle version)

```bash
cd /var/www/sbauto
git pull

# Backend
cd backend && npm ci --omit=dev
# (les migrations idempotentes s'exécutent au boot du backend)

# Fronts (rebuild)
cd ../manager && npm ci && npm run build
cd ../vitrine && npm ci && npm run build

# Redémarrer l'API (arrêt gracieux → aucune requête perdue)
pm2 restart sbauto-api
sudo systemctl reload nginx
```

Astuce : regroupez ces commandes dans un script `deploy.sh` versionné.

## 19. Sauvegardes

### MongoDB (base PROD)

```bash
# Atlas ou local — adaptez l'URI. Sauvegarde datée :
mongodump --uri="$MONGODB_URI" --db="$DB_PROD" --gzip \
  --archive=/home/deploy/backups/mongo-$(date +%F).gz
```

Planifiez via cron (`crontab -e`), tous les jours à 3h, avec rétention 14 jours :

```cron
0 3 * * * mongodump --uri="mongodb+srv://…" --db=sbauto_prod --gzip --archive=/home/deploy/backups/mongo-$(date +\%F).gz && find /home/deploy/backups -name 'mongo-*.gz' -mtime +14 -delete
```

Restauration : `mongorestore --uri="$MONGODB_URI" --gzip --archive=fichier.gz`.

> Le repo fournit aussi un outillage de **promotion/parité TEST→PROD** sûr
> (`npm run db:promote`, `npm run db:verify-prod`) — voir
> [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md).

### Uploads (médias)

```bash
tar czf /home/deploy/backups/uploads-$(date +%F).tgz -C /var/www/sbauto/backend uploads
# cron quotidien + rétention analogue
```

## 19bis. Webhooks Stripe & réconciliation (production)

En production, Stripe envoie les webhooks directement à
`https://api.domaine.com/api/webhooks/stripe` (endpoint signé, corps brut). Créez
l'endpoint dans le dashboard Stripe du **mode actif** et collez le `whsec_…` dans le
Manager (IntegratedAPI). Événements requis : `checkout.session.*`,
`payment_intent.*`, `charge.refunded`, `customer.subscription.created/updated/deleted`,
`invoice.finalized`, `invoice.paid`, `invoice.payment_failed` (cf.
[STRIPE_SUBSCRIPTION_FLOW.md](STRIPE_SUBSCRIPTION_FLOW.md) et
[STRIPE_LAUNCH_FEE_FLOW.md](STRIPE_LAUNCH_FEE_FLOW.md)).

Le webhook fait foi ; la **réconciliation** est un filet de sécurité (webhook
retardé/perdu). Planifiez-la via cron (utilisateur `deploy`, dans `backend/`) :

```cron
# Réconciliation des abonnements + du site, toutes les heures
0 * * * * cd /var/www/sbauto/backend && /usr/bin/node src/scripts/subscriptions-sync.js >> ~/logs/subs-sync.log 2>&1
# Vérification (lecture seule) des entitlements, tous les jours à 4h
0 4 * * * cd /var/www/sbauto/backend && /usr/bin/node src/scripts/verify-entitlements.js >> ~/logs/verify-entitlements.log 2>&1
# Backfill des factures Stripe (miroir + liens PDF), tous les jours à 4h30
30 4 * * * cd /var/www/sbauto/backend && /usr/bin/node src/scripts/invoices-sync.js >> ~/logs/invoices-sync.log 2>&1
```

`subscriptions:sync` et `verify-entitlements` sont **idempotents** et n'affichent
aucun secret. Le mode Stripe utilisé est le **mode actif** (jamais `ENV`).

> **Recette Yousign** : renseignez les clés Sandbox Yousign réelles et exécutez la
> recette signature complète **avant commercialisation** (non validée par le code
> seul — les tests utilisent des mocks).

## 20. Rollback

Le code est versionné : revenir à la version précédente est immédiat.

```bash
cd /var/www/sbauto
git log --oneline -n 5          # repérer le commit stable précédent
git checkout <hash_stable>      # ou: git reset --hard <hash_stable>

# Rebuild fronts + redémarrage API
cd manager && npm ci && npm run build
cd ../vitrine && npm ci && npm run build
cd .. && pm2 restart sbauto-api && sudo systemctl reload nginx
```

En cas de problème de données : restaurez le dernier dump MongoDB (§19). Les
migrations du bootstrap sont **idempotentes** et ne détruisent jamais de données.

## 21. Check-list finale avant mise en ligne

**Configuration**
- [ ] `backend/.env` : `ENV=PROD`, `JWT_SECRET` long/aléatoire, `MONGODB_URI`,
      `DB_PROD`, `CORS_ORIGINS` + `PUBLIC_URL` en HTTPS.
- [ ] `VITE_API_URL=https://api.domaine.com` dans `manager/.env` **et**
      `vitrine/.env`, puis fronts **rebuild**.
- [ ] `FIRST_DEV_EMAIL` renseignée, lien d'activation reçu et **consommé**
      (le compte n'est plus `PENDING_ACTIVATION`).

**Réseau & sécurité**
- [ ] DNS `@`, `manager`, `api` → IP du VPS, propagé.
- [ ] HTTPS actif sur les 3 domaines (`certbot renew --dry-run` OK).
- [ ] UFW actif (22/80/443 uniquement) ; 6060 et 27017 non exposés.
- [ ] Fail2Ban actif.

**Applicatif**
- [ ] `curl https://api.domaine.com/health` → `status: ok`, `env: PROD`.
- [ ] Vitrine (`https://domaine.com`) : accueil, service, avant/après, contact OK.
- [ ] Manager (`https://manager.domaine.com`) : connexion, upload d'image,
      « Voir la vitrine » OK.
- [ ] En DEV dans le manager : *Configuration système › Réseau* renseignée avec les
      3 URLs HTTPS (CORS rafraîchi à chaud).

**Exploitation**
- [ ] `pm2 save` + `pm2 startup` (redémarrage au boot).
- [ ] Sauvegardes MongoDB + uploads planifiées (cron).
- [ ] Rotation des logs PM2 activée.

---

*Une fois cette check-list validée, le projet est en ligne, sécurisé et
maintenable. Voir [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md) pour l'état détaillé
et les recommandations post-lancement.*
