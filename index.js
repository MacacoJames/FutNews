import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
} from "discord.js";
import http from "http";
import fetch from "node-fetch";

const TOKEN = process.env.DISCORD_TOKEN;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID; // opcional, mas recomendado

const INSTANCE_ID =
  process.env.INSTANCE_ID || `inst-${Math.random().toString(36).slice(2, 8)}`;

if (!TOKEN) console.log("⚠️ DISCORD_TOKEN faltando");
if (!FOOTBALL_API_KEY) console.log("⚠️ FOOTBALL_API_KEY faltando");
if (!CHANNEL_ID) console.log("⚠️ CHANNEL_ID faltando");

// -------- Discord client --------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// -------- util --------
function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function brTime(isoUtc) {
  const d = new Date(isoUtc);
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function brDateTime(isoUtc) {
  const d = new Date(isoUtc);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function footballGet(url) {
  const res = await fetch(url, {
    headers: { "X-Auth-Token": FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`API futebol erro (status ${res.status})`);
  return res.json();
}

async function getChannel() {
  return await client.channels.fetch(CHANNEL_ID);
}

// -------- anti-duplicação / anti-spam (prefix) --------
const seenMsgIds = new Set();
const cmdCooldown = new Map();

// -------- Slash commands --------
const commands = [
  {
    name: "ajuda",
    description: "Mostra os comandos do FutNews",
  },
  {
    name: "tabela",
    description: "Mostra a tabela do Brasileirão",
    options: [
      {
        name: "top",
        description: "Quantos times mostrar (padrão 20)",
        type: 4, // INTEGER
        required: false,
      },
    ],
  },
  {
    name: "rodada",
    description: "Mostra os próximos jogos do Brasileirão (próximos 10)",
  },
  {
    name: "aovivo",
    description: "Mostra jogos ao vivo do Brasileirão",
  },
  {
    name: "time",
    description: "Mostra posição e próximos jogos de um time",
    options: [
      {
        name: "nome",
        description: "Ex: flamengo, corinthians, palmeiras...",
        type: 3, // STRING
        required: true,
      },
    ],
  },
];

async function registerSlashCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const appId = client.user.id;

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), {
        body: commands,
      });
      console.log("✅ Slash commands registrados (GUILD).");
    } else {
      // Global demora pra aparecer às vezes (pode levar um tempo)
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      console.log("✅ Slash commands registrados (GLOBAL).");
    }
  } catch (e) {
    console.log("⚠️ Falha ao registrar slash commands:", e?.message || e);
  }
}

// -------- features: tabela / rodada / aovivo / time --------
async function fetchStandings() {
  const data = await footballGet(
    "https://api.football-data.org/v4/competitions/BSA/standings"
  );
  const total = data.standings?.find((s) => s.type === "TOTAL");
  const table = total?.table;
  if (!table?.length) throw new Error("Não consegui pegar a tabela agora.");
  return table;
}

function emojiPos(pos) {
  if (pos <= 4) return "🟢";
  if (pos >= 17) return "🔴";
  return "⚪";
}

async function cmdTabela(limit = 20) {
  const table = await fetchStandings();
  const slice = table.slice(0, Math.max(1, Math.min(20, limit)));

  const lines = slice.map((t) => {
    const pos = String(t.position).padStart(2, "0");
    const name = (t.team?.shortName || t.team?.name || "Time").slice(0, 18);
    return `${emojiPos(t.position)} ${pos}. ${name.padEnd(18, " ")}  ${String(
      t.points
    ).padStart(2, " ")} pts  (PJ ${t.playedGames})`;
  });

  const emb = new EmbedBuilder()
    .setTitle("🏆 Brasileirão Série A — Tabela")
    .setDescription("```" + lines.join("\n") + "```")
    .setFooter({ text: `FutNews ULTRA PRO • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

async function cmdRodada() {
  const from = isoDateUTC(new Date());
  const to = isoDateUTC(new Date(Date.now() + 14 * 86400_000)); // 14 dias
  const url = `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`;
  const data = await footballGet(url);
  const matches = (data?.matches ?? []).slice(0, 10);

  if (!matches.length) {
    return { content: "📅 Não achei próximos jogos nos próximos dias." };
  }

  const lines = matches.map((m) => {
    const when = m.utcDate ? brDateTime(m.utcDate) : "data a definir";
    return `• **${when}** — ${m.homeTeam?.name} vs ${m.awayTeam?.name}`;
  });

  const emb = new EmbedBuilder()
    .setTitle("📅 Próximos jogos (Brasileirão)")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `FutNews ULTRA PRO • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

async function cmdAoVivo() {
  const data = await footballGet(
    "https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE"
  );
  const matches = data?.matches ?? [];

  if (!matches.length) {
    return { content: "🔴 Nenhum jogo ao vivo agora." };
  }

  const lines = matches.map((m) => {
    const hs = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
    const as = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
    return `🔥 **${m.homeTeam?.name}** ${hs} x ${as} **${m.awayTeam?.name}**`;
  });

  const emb = new EmbedBuilder()
    .setTitle("🔴 Jogos ao vivo (Brasileirão)")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `FutNews ULTRA PRO • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

async function cmdTime(query) {
  const table = await fetchStandings();
  const q = query.toLowerCase();

  const found = table.find((t) => {
    const name = (t.team?.name || "").toLowerCase();
    const shortName = (t.team?.shortName || "").toLowerCase();
    const tla = (t.team?.tla || "").toLowerCase();
    return name.includes(q) || shortName.includes(q) || tla === q;
  });

  if (!found) {
    return { content: `⚠️ Não achei esse time na tabela: **${query}**` };
  }

  const teamId = found.team?.id;
  const teamName = found.team?.name || found.team?.shortName || "Time";

  const from = isoDateUTC(new Date());
  const to = isoDateUTC(new Date(Date.now() + 30 * 86400_000));
  const schedUrl = `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`;
  const sched = await footballGet(schedUrl);

  const upcoming = (sched?.matches ?? [])
    .filter((m) => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
    .slice(0, 3)
    .map((m) => {
      const when = m.utcDate ? brDateTime(m.utcDate) : "data a definir";
      return `• **${when}** — ${m.homeTeam?.name} vs ${m.awayTeam?.name}`;
    });

  const desc =
    `**${teamName}**\n` +
    `${emojiPos(found.position)} Posição: **${found.position}º** | Pontos: **${found.points}** | PJ: **${found.playedGames}**\n` +
    `V: **${found.won}**  E: **${found.draw}**  D: **${found.lost}** | SG: **${found.goalDifference}**\n\n` +
    (upcoming.length
      ? `📅 **Próximos jogos:**\n${upcoming.join("\n")}`
      : `📅 **Próximos jogos:** não encontrei nos próximos 30 dias.`);

  const emb = new EmbedBuilder()
    .setTitle("📌 Info do time")
    .setDescription(desc)
    .setFooter({ text: `FutNews ULTRA PRO • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

function cmdAjuda() {
  const emb = new EmbedBuilder()
    .setTitle("🤖 FutNews ULTRA PRO — Comandos")
    .setDescription(
      [
        "**Slash:**",
        "• `/tabela` (opção: top)",
        "• `/rodada`",
        "• `/aovivo`",
        "• `/time nome:<time>`",
        "• `/ajuda`",
        "",
        "**Prefix:**",
        "• `!tabela` (ou `!tabela 10`)",
        "• `!rodada`",
        "• `!aovivo`",
        "• `!time flamengo`",
        "• `!teste`",
        "",
        "✅ Alertas automáticos: início, placar, fim (no canal configurado).",
      ].join("\n")
    )
    .setFooter({ text: `FutNews ULTRA PRO • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

// -------- AUTO ALERTS (kickoff / goal / final) --------
const matchState = new Map(); // id -> { status, score }

async function pollAlerts() {
  try {
    if (!FOOTBALL_API_KEY || !CHANNEL_ID) return;

    const from = isoDateUTC(new Date());
    const to = isoDateUTC(new Date(Date.now() + 2 * 86400_000)); // hoje + 2 dias
    const url = `https://api.football-data.org/v4/competitions/BSA/matches?dateFrom=${from}&dateTo=${to}`;
    const data = await footballGet(url);
    const matches = data?.matches ?? [];
    if (!matches.length) return;

    const channel = await getChannel();

    for (const m of matches) {
      const id = m.id;
      const status = m.status;

      const home = m.homeTeam?.name ?? "Casa";
      const away = m.awayTeam?.name ?? "Fora";

      const hs =
        m.score?.fullTime?.home ??
        m.score?.halfTime?.home ??
        m.score?.regularTime?.home ??
        0;
      const as =
        m.score?.fullTime?.away ??
        m.score?.halfTime?.away ??
        m.score?.regularTime?.away ??
        0;
      const score = `${hs} x ${as}`;

      const prev = matchState.get(id);

      // primeira vez vendo o jogo: só registra, não spamma
      if (!prev) {
        matchState.set(id, { status, score });
        continue;
      }

      // começou
      if (prev.status !== "LIVE" && status === "LIVE") {
        matchState.set(id, { status, score });
        await channel.send(
          `🟢 **BOLA ROLANDO!**\n⚽ ${home} vs ${away}\n⏰ ${m.utcDate ? brTime(m.utcDate) : ""} _(Brasília)_`
        );
        continue;
      }

      // gol/atualização
      if (status === "LIVE" && prev.score !== score) {
        matchState.set(id, { status, score });
        await channel.send(`⚽ **PLACAR MUDOU!**\n${home} **${score}** ${away}`);
        continue;
      }

      // terminou
      if (prev.status !== "FINISHED" && status === "FINISHED") {
        matchState.set(id, { status, score });
        await channel.send(`🏁 **FIM DE JOGO!**\n${home} **${score}** ${away}`);
        continue;
      }

      // atualiza estado
      if (prev.status !== status || prev.score !== score) {
        matchState.set(id, { status, score });
      }
    }
  } catch (e) {
    console.log("pollAlerts erro:", e?.message || e);
  }
}

// -------- Prefix commands handler --------
async function handlePrefix(msg) {
  const text = msg.content.trim();
  const lower = text.toLowerCase();

  // anti duplicação por msg.id
  if (seenMsgIds.has(msg.id)) return;
  seenMsgIds.add(msg.id);
  setTimeout(() => seenMsgIds.delete(msg.id), 60_000);

  // cooldown por comando
  const key = `${msg.channelId}:${msg.author.id}:${lower}`;
  const now = Date.now();
  const last = cmdCooldown.get(key) || 0;
  if (now - last < 4000) return;
  cmdCooldown.set(key, now);
  setTimeout(() => cmdCooldown.delete(key), 60_000);

  if (lower === "!ajuda") return msg.channel.send(cmdAjuda());

  if (lower.startsWith("!tabela")) {
    const parts = lower.split(/\s+/);
    const limit = parts[1] ? Number(parts[1]) : 20;
    const payload = await cmdTabela(Number.isFinite(limit) ? limit : 20);
    return msg.channel.send(payload);
  }

  if (lower === "!rodada") {
    const payload = await cmdRodada();
    return msg.channel.send(payload);
  }

  if (lower === "!aovivo" || lower === "!ao vivo") {
    const payload = await cmdAoVivo();
    return msg.channel.send(payload);
  }

  if (lower.startsWith("!time ")) {
    const query = text.slice("!time ".length).trim();
    const payload = await cmdTime(query);
    return msg.channel.send(payload);
  }

  if (lower === "!teste") {
    return msg.channel.send(`✅ FutNews ULTRA PRO ativo (${INSTANCE_ID})`);
  }
}

// -------- Slash handler --------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const name = interaction.commandName;

    if (name === "ajuda") return interaction.reply(cmdAjuda());

    if (name === "tabela") {
      const top = interaction.options.getInteger("top") ?? 20;
      const payload = await cmdTabela(top);
      return interaction.reply(payload);
    }

    if (name === "rodada") {
      const payload = await cmdRodada();
      return interaction.reply(payload);
    }

    if (name === "aovivo") {
      const payload = await cmdAoVivo();
      return interaction.reply(payload);
    }

    if (name === "time") {
      const nome = interaction.options.getString("nome", true);
      const payload = await cmdTime(nome);
      return interaction.reply(payload);
    }
  } catch (e) {
    console.log("interaction erro:", e?.message || e);
    try {
      await interaction.reply({ content: "⚠️ Deu erro ao executar o comando.", ephemeral: true });
    } catch {}
  }
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!")) return;
  try {
    await handlePrefix(msg);
  } catch (e) {
    console.log("prefix erro:", e?.message || e);
  }
});

// -------- Ready: register slash + start alerts --------
client.once("ready", async () => {
  console.log(`ONLINE: ${client.user.tag} | PID ${process.pid} | ${INSTANCE_ID}`);

  // registra slash commands
  await registerSlashCommands();

  // loop alertas
  setInterval(pollAlerts, 60_000);
});

// -------- HTTP (Railway) --------
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews ULTRA PRO Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));

client.login(TOKEN);
