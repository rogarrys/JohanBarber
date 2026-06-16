/* ============================================================
   Aide : trouve ton TELEGRAM_CHAT_ID
   ------------------------------------------------------------
   1) Crée un bot avec @BotFather sur Telegram, récupère le token.
   2) Mets le token dans .env (TELEGRAM_BOT_TOKEN=...).
   3) Envoie un message ("salut") à TON bot depuis Telegram.
   4) Lance :  npm run chat-id
   5) Copie le chat id affiché dans .env (TELEGRAM_CHAT_ID=...).
   ============================================================ */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// charge .env
const envPath = path.join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("\n❌ TELEGRAM_BOT_TOKEN manquant. Mets-le dans le fichier .env d'abord.\n");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error("\n❌ Token invalide ou erreur Telegram:", data.description || data, "\n");
  process.exit(1);
}

const chats = new Map();
for (const u of data.result) {
  const msg = u.message || u.edited_message || u.channel_post;
  if (msg && msg.chat) {
    const c = msg.chat;
    chats.set(c.id, [c.first_name, c.last_name, c.username && "@" + c.username, c.title].filter(Boolean).join(" "));
  }
}

if (chats.size === 0) {
  console.log("\n⚠️  Aucun message reçu. Envoie d'abord un message à ton bot sur Telegram, puis relance.\n");
  process.exit(0);
}

console.log("\n✅ Conversations trouvées (mets le bon id dans .env → TELEGRAM_CHAT_ID) :\n");
for (const [id, who] of chats) console.log(`   ${id}   ${who}`);
console.log("");
