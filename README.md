# Site JOHAN · Barbier

Site vitrine + réservation en ligne pour le salon de Johan.
Coupe **15 €**, Coupe + Barbe **20 €**, horaires **11h – 20h**, sur rendez-vous.

Quand un client réserve :
1. la réservation est **enregistrée sur le serveur** (fichier `data/bookings.json`) ;
2. le créneau devient **indisponible pour tout le monde** (planning partagé) ;
3. **Johan reçoit la demande sur Telegram** (prestation, date, heure, prénom, téléphone).

---

## 🚀 Lancer le site

Il faut **Node.js** (déjà installé). Dans le dossier du projet :

```bash
npm start
```

Puis ouvre **http://localhost:3000** dans le navigateur.

> Sans rien configurer, tout marche déjà (réservations enregistrées + créneaux partagés).
> La notification Telegram, elle, demande la petite config ci-dessous.

---

## 🤖 Recevoir les réservations sur Telegram (recommandé)

Une seule fois, ~5 minutes :

1. **Crée ton bot.** Sur Telegram, écris à **@BotFather**, envoie `/newbot`, choisis un nom. Il te donne un **token** (du style `123456:ABC-...`).
2. **Crée le fichier de config.** Duplique `.env.example` en `.env` et colle ton token :
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-ton-token
   TELEGRAM_CHAT_ID=
   ```
3. **Récupère ton identifiant.** Envoie n'importe quel message à TON bot sur Telegram (« salut »), puis lance :
   ```bash
   npm run chat-id
   ```
   Copie le numéro affiché dans `.env` à la ligne `TELEGRAM_CHAT_ID=`.
4. **Relance** `npm start`. C'est prêt : chaque réservation t'arrive sur Telegram.

> ⚠️ Ne partage jamais le fichier `.env` (il contient ta clé secrète). Il est déjà exclu du partage.

---

## 🛠️ Espace barbier (panel admin)

Une page privée **`/admin`** (ex. http://localhost:3000/admin) protégée par mot de passe, où tu gères tout toi-même :

- **Tes horaires** : heure d'ouverture / fermeture et durée d'un créneau ;
- **Tes jours d'ouverture** (ferme le dimanche, etc.) ;
- **Tes jours de congé** (vacances, jours fériés) ;
- **Bloquer un créneau** ponctuel (rendez-vous perso, pause) ;
- **Voir et annuler** les réservations.

Tout changement se répercute **immédiatement** sur le formulaire de réservation du site.

Le mot de passe se règle dans `.env` → `ADMIN_PASSWORD=` (mets le tien, pas celui par défaut !).

---

## 📧 Notifications par e-mail (optionnel)

En plus de Telegram, tu peux recevoir chaque réservation par **e-mail** :

1. Crée un compte gratuit sur **resend.com**, génère une **clé API**.
2. Dans `.env` :
   ```
   EMAIL_API_KEY=re_ta_cle
   EMAIL_TO=ton.email@exemple.com
   ```
3. Relance `npm start`.

> Avec la clé de test Resend (`onboarding@resend.dev`), tu peux recevoir les mails sur l'adresse de ton compte Resend. Pour envoyer depuis ta propre adresse, vérifie un domaine dans Resend et change `EMAIL_FROM`.

---

## 🌐 Mettre le site en ligne (pour que les clients y accèdent)

Le site a besoin d'un serveur Node qui tourne en permanence. Options gratuites/simples :

- **Render.com** ou **Railway.app** : crée un service Node, connecte le dépôt GitHub, commande de démarrage `npm start`, et ajoute les variables d'environnement dans leurs réglages (pas le fichier `.env` là-bas) : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ADMIN_PASSWORD`, et (optionnel) `EMAIL_API_KEY` + `EMAIL_TO`.
  > Sur l'offre gratuite, le disque est éphémère : les horaires/réglages et l'historique peuvent se réinitialiser à chaque mise à jour. Ajoute un **disque persistant** (option payante) pour tout conserver. Les notifs Telegram/e-mail, elles, marchent toujours.
- **Un petit VPS** : `npm start` derrière un reverse-proxy (nginx) ou avec `pm2`.

Mets ensuite l'adresse obtenue dans ta bio Instagram.

> Le port s'adapte tout seul à l'hébergeur (variable `PORT`).

---

## 🟣 Personnaliser

- **Ton @ Instagram** (bouton « M'écrire » + repli si le serveur est coupé) : ouvre `script.js`, tout en haut, remplace `"johan"` par ton vrai pseudo (sans le `@`).
- Nom, adresse, horaires : modifiables au même endroit (`CONFIG`) et dans `index.html`.

---

## 📁 Contenu du dossier

```
index.html      → la page
styles.css      → le design
script.js       → la réservation côté client  (← pseudo Insta à modifier ici)
server.js       → le serveur (site + API + Telegram)
telegram-setup.js → aide pour trouver ton chat id Telegram
package.json    → commandes (npm start, npm run chat-id)
.env.example    → modèle de config Telegram (à copier en .env)
data/bookings.json → réservations enregistrées (créé automatiquement)
assets/         → vidéo + photos optimisées
```

## 💡 Bon à savoir

- Si le serveur est coupé, le site reste consultable et la réservation **bascule automatiquement** sur l'ancien mode (récap copié + ouverture d'Instagram).
- Les clients peuvent toujours **ajouter le rendez-vous à leur calendrier** (fichier `.ics`).
- Créneaux : toutes les 30 min, de 11h00 à 19h30 (dernier RDV).
"# JohanBarber" 
