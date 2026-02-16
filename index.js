import { Client, GatewayIntentBits } from "discord.js";
import http from "http";
import Parser from "rss-parser";
import fetch from "node-fetch";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const RSS_FEED_URL = process.env.RSS_FEED_URL;

const parser = new Parser();

let lastRssGuid = null;
const lastScores = new Map();

client.once("ready", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  // loops
  setInterval(() => checkRssNews().catch(console.log), 60_000);
  setInterval(() => checkLiveMatches().catch(console.log), 60_000);
});

async function getChannel() {
  if (!CHANNEL_ID) throw new Error("CHANNEL_ID faltando");
  return await client.channels.fetch(CHANNEL_ID);
}

// 📰 RSS
async function checkRssNews() {
  if (!RSS_FEED_URL) return;

  const feed = await parser.parseURL(RSS_FEED_URL);
  if (!feed?.items?.length) return;

  const latest = feed.items[0];
  const guid = latest.guid || latest.id || latest.link;
  if (!guid) return;

  // evita spam no 1º start
  if (lastRssGuid === null) {
    lastRssGuid = guid;
    console.log("RSS pronto (sem postar a primeira notícia).");
    return;
  }

  if (guid === lastRssGuid) return;
  lastRssGuid = guid;

  const channel = await getChannel();
  await channel.send(`📰 **${latest.title ?? "Notícia"}**\n${latest.link ?? ""}`);
}

// ⚽ LIVE placar
async function checkLiveMatches() {
  if (!FOOTBALL_API_KEY) return;

  const res = await fetch(
    "https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE",
    { headers: { "X-Auth-Token": FOOTBALL_API_KEY } }
  );

  if (!res.ok) {
    console.log("API futebol erro:", res.status);
    return;
  }

  const data = await res.json();
  const matches = data?.matches ?? [];
  if (!matches.length) return;

  const channel = await getChannel();

  for (const m of matches) {
    const id = m.id;
    const home = m.homeTeam?.name ?? "Casa";
    const away = m.awayTeam?.name ?? "Fora";

    const hs = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
    const as = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
    const score = `${hs} x ${as}`;

    const prev = lastScores.get(id);

    if (prev === undefined) {
      lastScores.set(id, score);
      await channel.send(`⚽ **Jogo ao vivo!**\n${home} ${score} ${away}`);
      continue;
    }

    if (prev !== score) {
      lastScores.set(id, score);
      await channel.send(`🔥 **Atualização de placar!**\n${home} ${score} ${away}`);
    }
  }
}

// 🌐 HTTP pro Railway
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews Bot Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));

client.login(TOKEN);
