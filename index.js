import { Client, GatewayIntentBits } from "discord.js";
import http from "http";
import fetch from "node-fetch";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

const INSTANCE_ID =
  process.env.INSTANCE_ID ||
  `inst-${Math.random().toString(36).slice(2, 8)}`;

async function footballGet(url) {
  const res = await fetch(url, {
    headers: { "X-Auth-Token": FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`Erro API (${res.status})`);
  return res.json();
}

client.once("ready", () => {
  console.log(`🔥 FutNews PRO Online | ${INSTANCE_ID}`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const lower = msg.content.toLowerCase().trim();

  // ================= TABELA PRO =================
  if (lower.startsWith("!tabela")) {
    const data = await footballGet(
      "https://api.football-data.org/v4/competitions/BSA/standings"
    );

    const table = data.standings.find(s => s.type === "TOTAL").table;

    const lines = table.map((t) => {
      let emoji = "⚪";

      if (t.position <= 4) emoji = "🟢";
      else if (t.position >= 17) emoji = "🔴";

      const name = (t.team.shortName || t.team.name).padEnd(16, ".");
      return `${emoji} ${String(t.position).padStart(2, "0")}. ${name} ${t.points} pts`;
    });

    await msg.channel.send(
      "🏆 **BRASILEIRÃO SÉRIE A**\n```" +
      lines.join("\n") +
      "```"
    );
  }

  // ================= RODADA =================
  if (lower === "!rodada") {
    const data = await footballGet(
      "https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED"
    );

    const jogos = data.matches.slice(0, 10).map((m) => {
      return `⚽ ${m.homeTeam.name} vs ${m.awayTeam.name}`;
    });

    await msg.channel.send(
      "📅 **PRÓXIMA RODADA**\n" + jogos.join("\n")
    );
  }

  // ================= AO VIVO =================
  if (lower === "!ao vivo") {
    const data = await footballGet(
      "https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE"
    );

    if (!data.matches.length) {
      await msg.channel.send("🔴 Nenhum jogo ao vivo agora.");
      return;
    }

    const jogos = data.matches.map((m) => {
      const hs = m.score.fullTime.home ?? 0;
      const as = m.score.fullTime.away ?? 0;

      return `🔥 ${m.homeTeam.name} ${hs} x ${as} ${m.awayTeam.name}`;
    });

    await msg.channel.send("🔴 **JOGOS AO VIVO**\n" + jogos.join("\n"));
  }

  // ================= TESTE =================
  if (lower === "!teste") {
    await msg.channel.send(`✅ FutNews PRO ativo (${INSTANCE_ID})`);
  }
});

// HTTP Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("FutNews Online")).listen(PORT);

client.login(TOKEN);
