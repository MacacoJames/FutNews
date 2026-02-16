import { Client, GatewayIntentBits } from "discord.js";
import http from "http";
import Parser from "rss-parser";
import fetch from "node-fetch";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Futebol (football-data)
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

// Notícias (RSS)
const RSS_FEED_URL = process.env.RSS_FEED_URL;

// Configs
const CHECK_INTERVAL_MS = 60_000; // 1 min
const parser = new Parser();

// Memória simples pra não repostar
let lastRssGuid = null;
const lastScores = new Map();

client.once("ready", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  // 👇 BUSCA O CANAL
  const channel = await client.channels.fetch(process.env.CHANNEL_ID);

  // 👇 ENVIA MENSAGEM DE TESTE
  await channel.send("✅ FutNews ligado e pronto pra mandar notícias e placares!");
});

  // Loop
  setInterval(async () => {
    await Promise.allSettled([checkRssNews(), checkLiveMatches()]);
  }, CHECK_INTERVAL_MS);
});

// ------------------- RSS NEWS -------------------
async function checkRssNews() {
  if (!RSS_FEED_URL || !CHANNEL_ID) return;

  const channel = await client.channels.fetch(CHANNEL_ID);

  const feed = await parser.parseURL(RSS_FEED_URL);
  if (!feed?.items?.length) return;

  const latest = feed.items[0];
  const guid = latest.guid || latest.id || latest.link;

  if (!guid) return;
  if (lastRssGuid === null) lastRssGuid = guid; // evita spam no 1º start
  if (guid === lastRssGuid) return;

  lastRssGuid = guid;

  const title = latest.title ?? "Notícia";
  const link = latest.link ?? "";

  await channel.send(`📰 **${title}**\n${link}`);
}

// ------------------- LIVE MATCHES -------------------
async function checkLiveMatches() {
  if (!FOOTBALL_API_KEY || !CHANNEL_ID) return;

  // BSA = Campeonato Brasileiro Série A na football-data
  const url = "https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE";

  const res = await fetch(url, {
    headers: { "X-Auth-Token": FOOTBALL_API_KEY }
  });

  if (!res.ok) {
    console.log("API futebol erro:", res.status);
    return;
  }

  const data = await res.json();
  const matches = data?.matches ?? [];
  if (!matches.length) return;

  const channel = await client.channels.fetch(CHANNEL_ID);

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

// ------------------- HTTP (Railway) -------------------
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews Bot Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));

client.login(TOKEN);
