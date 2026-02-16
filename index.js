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

function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
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
  console.log(`Bot online como ${client.user.tag} | PID ${process.pid}`);
});


client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const text = msg.content.trim();
  const lower = text.toLowerCase();

  // ============ !tabela [1..20] ============
  if (lower.startsWith("!tabela")) {
    try {
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
          "```" +
          lines.join("\n") +
          "```" +
          `Comandos: **!tabela 10**, **!jogos hoje**, **!time flamengo**`
      );
    } catch (err) {
      console.log(err);
      await msg.channel.send(`⚠️ ${err.message || "Erro ao buscar a tabela."}`);
    }
    return;
  }

  // ============ !jogos hoje ============
  if (lower === "!jogos hoje" || lower === "!jogos hj") {
    try {
      const today = isoDateUTC(new Date());
      const url = `https://api.football-data.org/v4/competitions/BSA/matches?dateFrom=${today}&dateTo=${today}`;
      const data = await footballGet(url);

      const matches = data?.matches ?? [];
      if (!matches.length) {
        await msg.channel.send("📅 **Brasileirão — Hoje:** sem jogos encontrados.");
        return;
      }

      const lines = matches.slice(0, 20).map((m) => {
        const home = m.homeTeam?.name ?? "Casa";
        const away = m.awayTeam?.name ?? "Fora";
        const utc = m.utcDate ? new Date(m.utcDate) : null;
        const hora = utc
          ? utc.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
          : "--:--";

        const status = m.status || "";
        const hs = m.score?.fullTime?.home;
        const as = m.score?.fullTime?.away;
        const score = (hs != null && as != null) ? ` — ${hs} x ${as}` : "";
        return `• ${hora} — ${home} vs ${away}${score} (${status})`;
      });

      await msg.channel.send(`📅 **Brasileirão — Jogos de hoje**\n` + lines.join("\n"));
    } catch (err) {
      console.log(err);
      await msg.channel.send(`⚠️ ${err.message || "Erro ao buscar jogos de hoje."}`);
    }
    return;
  }

  // ============ !time <nome> ============
  if (lower.startsWith("!time ")) {
    const query = text.slice("!time ".length).trim();
    if (!query) {
      await msg.channel.send("⚠️ Use assim: **!time flamengo**");
      return;
    }

    try {
      const table = await getStandingsTable();

      const q = query.toLowerCase();
      const found = table.find((t) => {
        const name = (t.team?.name || "").toLowerCase();
        const shortName = (t.team?.shortName || "").toLowerCase();
        const tla = (t.team?.tla || "").toLowerCase();
        return name.includes(q) || shortName.includes(q) || tla === q;
      });

      if (!found) {
        await msg.channel.send(`⚠️ Não achei esse time na tabela. Tenta outro nome (ex: **!time botafogo**).`);
        return;
      }

      const teamId = found.team?.id;
      const teamName = found.team?.name || found.team?.shortName || "Time";

      // próximos jogos (30 dias) pela competição
      const from = isoDateUTC(new Date());
      const to = isoDateUTC(addDays(new Date(), 30));
      const schedUrl = `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`;
      const sched = await footballGet(schedUrl);
      const upcoming = (sched?.matches ?? [])
        .filter((m) => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
        .slice(0, 3)
        .map((m) => {
          const home = m.homeTeam?.name ?? "Casa";
          const away = m.awayTeam?.name ?? "Fora";
          const utc = m.utcDate ? new Date(m.utcDate) : null;
          const dataHora = utc
            ? utc.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "data a definir";
          return `• ${dataHora} — ${home} vs ${away}`;
        });

      const resumo =
        `📌 **${teamName}**\n` +
        `Posição: **${found.position}º** | Pontos: **${found.points}** | PJ: **${found.playedGames}**\n` +
        `V: **${found.won}**  E: **${found.draw}**  D: **${found.lost}** | SG: **${found.goalDifference}**`;

      const prox =
        upcoming.length
          ? `\n\n📅 **Próximos jogos (até 30 dias):**\n${upcoming.join("\n")}`
          : `\n\n📅 **Próximos jogos:** não encontrei nos próximos 30 dias.`;

      await msg.channel.send(resumo + prox);
    } catch (err) {
      console.log(err);
      await msg.channel.send(`⚠️ ${err.message || "Erro ao buscar info do time."}`);
    }
    return;
  }

  // ============ !teste ============
  if (lower === "!teste") {
    await msg.channel.send("✅ FutNews respondeu! Tá funcionando certinho.");
  }
});

// HTTP pro Railway
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews Bot Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));

client.login(TOKEN);
