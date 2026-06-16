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

## 🌐 Mettre le site en ligne (pour que les clients y accèdent)

Le site a besoin d'un serveur Node qui tourne en permanence. Options gratuites/simples :

- **Render.com** ou **Railway.app** : crée un service Node, connecte le dossier, commande de démarrage `npm start`, et ajoute les variables `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` dans leurs réglages (pas besoin du fichier `.env` là-bas).
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
