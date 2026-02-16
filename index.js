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

// ID único da instância (pra descobrir quantas estão rodando)
const INSTANCE_ID =
  process.env.INSTANCE_ID ||
  `inst-${Math.random().toString(36).slice(2, 8)}`;

const seenMsgIds = new Set();
const cmdCooldown = new Map(); // key -> timestamp

function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function footballGet(url) {
  if (!FOOTBALL_API_KEY) throw new Error("FOOTBALL_API_KEY faltando no Railway.");
  const res = await fetch(url, { headers: { "X-Auth-Token": FOOTBALL_API_KEY } });
  if (!res.ok) throw new Error(`API futebol erro (status ${res.status})`);
  return res.json();
}

async function getStandingsTable() {
  const data = await footballGet("https://api.football-data.org/v4/competitions/BSA/standings");
  const total = data.standings?.find((s) => s.type === "TOTAL");
  const table = total?.table;
  if (!table?.length) throw new Error("Não consegui pegar a tabela agora.");
  return table;
}

client.once("ready", () => {
  console.log(`ONLINE: ${client.user.tag} | PID ${process.pid} | ${INSTANCE_ID}`);
});

client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;

    // Anti duplicação por ID da mensagem (dentro da mesma instância)
    if (seenMsgIds.has(msg.id)) return;
    seenMsgIds.add(msg.id);
    setTimeout(() => seenMsgIds.delete(msg.id), 60_000);

    const text = msg.content.trim();
    const lower = text.toLowerCase();

    // Anti spam por comando (mesma pessoa/canal/comando)
    const key = `${msg.channelId}:${msg.author.id}:${lower}`;
    const now = Date.now();
    const last = cmdCooldown.get(key) || 0;
    if (now - last < 8000) return; // 8s
    cmdCooldown.set(key, now);
    setTimeout(() => cmdCooldown.delete(key), 60_000);

    // !tabela
    if (lower.startsWith("!tabela")) {
      const parts = lower.split(/\s+/);
      let limit = 20;
      if (parts[1]) {
        const n = Number(parts[1]);
        if (Number.isFinite(n) && n >= 1 && n <= 20) limit = n;
      }

      const table = await getStandingsTable();
      const slice = table.slice(0, limit);

      const lines = slice.map((t) => {
        const pos = String(t.position).padStart(2, "0");
        const name = (t.team?.shortName || t.team?.name || "Time").slice(0, 18);
        const pts = String(t.points).padStart(2, " ");
        const pj = String(t.playedGames).padStart(2, " ");
        const v = String(t.won).padStart(2, " ");
        const e = String(t.draw).padStart(2, " ");
        const d = String(t.lost).padStart(2, " ");
        const sg = String(t.goalDifference).padStart(3, " ");
        return `${pos}. ${name.padEnd(18, " ")}  ${pts} pts  PJ ${pj}  V ${v} E ${e} D ${d}  SG ${sg}`;
      });

      await msg.channel.send(
        `🏆 **Brasileirão — Top ${limit}**\n` +
          "```" + lines.join("\n") + "```" +
          `\n_(${INSTANCE_ID})_`
      );
      return;
    }

    // !jogos hoje
    if (lower === "!jogos hoje" || lower === "!jogos hj") {
      const today = isoDateUTC(new Date());
      const url = `https://api.football-data.org/v4/competitions/BSA/matches?dateFrom=${today}&dateTo=${today}`;
      const data = await footballGet(url);

      const matches = data?.matches ?? [];
      if (!matches.length) {
        await msg.channel.send(`📅 **Brasileirão — Hoje:** sem jogos. _(${INSTANCE_ID})_`);
        return;
      }

      const lines = matches.slice(0, 20).map((m) => {
        const home = m.homeTeam?.name ?? "Casa";
        const away = m.awayTeam?.name ?? "Fora";
        const utc = m.utcDate ? new Date(m.utcDate) : null;
        const hora = utc
          ? utc.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
          : "--:--";
        return `• ${hora} — ${home} vs ${away} (${m.status || ""})`;
      });

      await msg.channel.send(`📅 **Brasileirão — Jogos de hoje**\n${lines.join("\n")}\n_(${INSTANCE_ID})_`);
      return;
    }

    // !teste
    if (lower === "!teste") {
      await msg.channel.send(`✅ Teste OK! _(${INSTANCE_ID})_`);
      return;
    }
  } catch (err) {
    console.log(err);
  }
});

// HTTP pro Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("FutNews Bot Online")).listen(PORT, () => {
  console.log("Servidor HTTP ativo");
});

client.login(TOKEN);
