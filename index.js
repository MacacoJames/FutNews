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
let lastNews = null;

client.once("ready", async () => {
  console.log(`Bot online como ${client.user.tag}`);
  setInterval(checkNews, 60000);
  setInterval(checkGames, 60000);
});

// 📰 NOTÍCIAS
async function checkNews() {
  try {
    if (!RSS_FEED_URL) return;

    const channel = await client.channels.fetch(CHANNEL_ID);
    const feed = await parser.parseURL(RSS_FEED_URL);

    if (!feed.items.length) return;

    const latest = feed.items[0];

    if (latest.link === lastNews) return;

    lastNews = latest.link;

    await channel.send(`📰 **${latest.title}**\n${latest.link}`);
  } catch (err) {
    console.log("Erro notícias:", err.message);
  }
}

// ⚽ JOGOS AO VIVO
async function checkGames() {
  try {
    if (!FOOTBALL_API_KEY) return;

    const res = await fetch(
      "https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE",
      { headers: { "X-Auth-Token": FOOTBALL_API_KEY } }
    );

    const data = await res.json();
    if (!data.matches) return;

    const channel = await client.channels.fetch(CHANNEL_ID);

    data.matches.forEach(async (m) => {
      const home = m.homeTeam.name;
      const away = m.awayTeam.name;
      const score = `${m.score.fullTime.home ?? 0} x ${m.score.fullTime.away ?? 0}`;

      await channel.send(`⚽ **Jogo ao vivo!**\n${home} ${score} ${away}`);
    });
  } catch (err) {
    console.log("Erro jogos:", err.message);
  }
}

// Railway HTTP
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.end("FutNews Bot Online");
}).listen(PORT);

client.login(TOKEN);
