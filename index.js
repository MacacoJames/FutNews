import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import http from "http";
import fetch from "node-fetch";
import Parser from "rss-parser";

const TOKEN = process.env.DISCORD_TOKEN;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;

// RSS (notícias)
const RSS_FEED_URL =
  process.env.RSS_FEED_URL || "https://ge.globo.com/rss/futebol/brasileirao-serie-a/";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const INSTANCE_ID =
  process.env.INSTANCE_ID || `inst-${Math.random().toString(36).slice(2, 8)}`;

// ===== util =====
const parser = new Parser();

function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
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
function safeTeamName(team) {
  return team?.shortName || team?.name || "Time";
}
function crestUrl(team) {
  return team?.crest || null; // escudo real vindo da API
}
async function footballGet(url) {
  const res = await fetch(url, { headers: { "X-Auth-Token": FOOTBALL_API_KEY } });
  if (!res.ok) throw new Error(`API futebol erro (status ${res.status})`);
  return res.json();
}
async function getChannel() {
  return await client.channels.fetch(CHANNEL_ID);
}

// ===== anti-duplicação (prefix) =====
const seenMsgIds = new Set();
const cmdCooldown = new Map();

// ===== estado (alertas de jogo) =====
const matchState = new Map(); // matchId -> { home, away, status }
const pregameSent = new Set();   // matchId
const finishedSent = new Set();  // matchId

// ===== estado (notícias RSS) =====
let lastNewsId = null; // evita repetir (memória do processo)

// ===== comandos =====
async function fetchStandings() {
  const data = await footballGet("https://api.football-data.org/v4/competitions/BSA/standings");
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
    const name = safeTeamName(t.team).slice(0, 18).padEnd(18, " ");
    const pts = String(t.points).padStart(2, " ");
    return `${emojiPos(t.position)} ${pos}. ${name}  ${pts} pts (PJ ${t.playedGames})`;
  });

  const emb = new EmbedBuilder()
    .setTitle("🏆 Brasileirão Série A — Tabela")
    .setDescription("```" + lines.join("\n") + "```")
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

async function cmdRodada() {
  const from = isoDateUTC(new Date());
  const to = isoDateUTC(new Date(Date.now() + 14 * 86400_000));
  const url = `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`;
  const data = await footballGet(url);
  const matches = (data?.matches ?? []).slice(0, 10);

  if (!matches.length) return { content: "📅 Não achei próximos jogos nos próximos dias." };

  const lines = matches.map((m) => {
    const when = m.utcDate ? brDateTime(m.utcDate) : "data a definir";
    return `• **${when}** — ${safeTeamName(m.homeTeam)} vs ${safeTeamName(m.awayTeam)}`;
  });

  const emb = new EmbedBuilder()
    .setTitle("📅 Próximos jogos (Brasileirão)")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  const crest = crestUrl(matches[0]?.homeTeam) || crestUrl(matches[0]?.awayTeam);
  if (crest) emb.setThumbnail(crest);

  return { embeds: [emb] };
}

async function cmdAoVivo() {
  const data = await footballGet("https://api.football-data.org/v4/competitions/BSA/matches?status=LIVE");
  const matches = data?.matches ?? [];

  if (!matches.length) return { content: "🔴 Nenhum jogo ao vivo agora." };

  const lines = matches.map((m) => {
    const hs = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
    const as = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
    return `🔥 **${safeTeamName(m.homeTeam)}** ${hs} x ${as} **${safeTeamName(m.awayTeam)}**`;
  });

  const emb = new EmbedBuilder()
    .setTitle("🔴 Jogos ao vivo (Brasileirão)")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  const crest = crestUrl(matches[0]?.homeTeam) || crestUrl(matches[0]?.awayTeam);
  if (crest) emb.setThumbnail(crest);

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

  if (!found) return { content: `⚠️ Não achei esse time na tabela: **${query}**` };

  const teamId = found.team?.id;
  const teamName = safeTeamName(found.team);

  const from = isoDateUTC(new Date());
  const to = isoDateUTC(new Date(Date.now() + 30 * 86400_000));
  const schedUrl = `https://api.football-data.org/v4/competitions/BSA/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`;
  const sched = await footballGet(schedUrl);

  const upcoming = (sched?.matches ?? [])
    .filter((m) => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
    .slice(0, 3)
    .map((m) => {
      const when = m.utcDate ? brDateTime(m.utcDate) : "data a definir";
      return `• **${when}** — ${safeTeamName(m.homeTeam)} vs ${safeTeamName(m.awayTeam)}`;
    });

  const desc =
    `**${teamName}**\n` +
    `${emojiPos(found.position)} Posição: **${found.position}º** | Pontos: **${found.points}** | PJ: **${found.playedGames}**\n` +
    `V: **${found.won}**  E: **${found.draw}**  D: **${found.lost}** | SG: **${found.goalDifference}**\n\n` +
    (upcoming.length ? `📅 **Próximos jogos:**\n${upcoming.join("\n")}` : `📅 **Próximos jogos:** não encontrei.`);

  const emb = new EmbedBuilder()
    .setTitle("📌 Time — info")
    .setDescription(desc)
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  const crest = crestUrl(found.team);
  if (crest) emb.setThumbnail(crest);

  return { embeds: [emb] };
}

function helpEmbed() {
  const emb = new EmbedBuilder()
    .setTitle("🤖 FutNews — Comandos")
    .setDescription(
      [
        "• `!tabela` (ou `!tabela 10`)",
        "• `!rodada`",
        "• `!aovivo`",
        "• `!time flamengo`",
        "• `!teste`",
        "• `!ajuda`",
        "",
        "📰 Notícias automáticas com imagem (RSS).",
        "✅ Automático: **pré-jogo (10 min)**, **GOOOL**, **fim de jogo**.",
      ].join("\n")
    )
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

// ====== NOTÍCIAS (RSS) com imagem ======
function pickImageFromRssItem(item) {
  // tenta as formas mais comuns de imagem no RSS
  const enclosureUrl = item?.enclosure?.url;
  if (enclosureUrl) return enclosureUrl;

  const mediaContent = item?.["media:content"]?.url || item?.["media:content"]?.[0]?.url;
  if (mediaContent) return mediaContent;

  const mediaThumb = item?.["media:thumbnail"]?.url || item?.["media:thumbnail"]?.[0]?.url;
  if (mediaThumb) return mediaThumb;

  // tenta pegar <img src="..."> do conteúdo/descrição (fallback)
  const html = item?.content || item?.["content:encoded"] || item?.summary || item?.contentSnippet || "";
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1]) return match[1];

  return null;
}

async function pollNews() {
  try {
    if (!RSS_FEED_URL || !CHANNEL_ID) return;

    const feed = await parser.parseURL(RSS_FEED_URL);
    const items = feed?.items ?? [];
    if (!items.length) return;

    const latest = items[0];
    const newsId = latest.guid || latest.id || latest.link;
    if (!newsId) return;

    // primeira execução: só registra sem spammar
    if (lastNewsId === null) {
      lastNewsId = newsId;
      console.log("RSS pronto (sem postar a primeira notícia).");
      return;
    }

    if (newsId === lastNewsId) return;
    lastNewsId = newsId;

    const channel = await getChannel();

    const title = latest.title || "Nova notícia";
    const link = latest.link || "";
    const img = pickImageFromRssItem(latest);

    const emb = new EmbedBuilder()
      .setTitle(`📰 ${title}`)
      .setURL(link)
      .setFooter({ text: `Notícias • ${INSTANCE_ID}` });

    // descrição curtinha (evita texto enorme)
    const descBase =
      (latest.contentSnippet || latest.summary || "").toString().trim().slice(0, 180);
    if (descBase) emb.setDescription(descBase + (descBase.length >= 180 ? "..." : ""));

    if (img) emb.setImage(img);

    await channel.send({ embeds: [emb] });
  } catch (e) {
    console.log("pollNews erro:", e?.message || e);
  }
}

// ====== ALERTAS AUTOMÁTICOS (pré-jogo / gol / fim) ======
async function pollAlerts() {
  try {
    if (!FOOTBALL_API_KEY || !CHANNEL_ID) return;

    const channel = await getChannel();

    const from = isoDateUTC(new Date());
    const to = isoDateUTC(new Date(Date.now() + 2 * 86400_000));
    const url = `https://api.football-data.org/v4/competitions/BSA/matches?dateFrom=${from}&dateTo=${to}`;
    const data = await footballGet(url);
    const matches = data?.matches ?? [];
    if (!matches.length) return;

    const now = Date.now();

    for (const m of matches) {
      const id = m.id;
      const status = m.status;
      const homeTeam = m.homeTeam;
      const awayTeam = m.awayTeam;

      const homeName = safeTeamName(homeTeam);
      const awayName = safeTeamName(awayTeam);

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

      const prev = matchState.get(id) || { home: hs, away: as, status };

      // PRÉ-JOGO 10 MIN
      if (!pregameSent.has(id) && (status === "SCHEDULED" || status === "TIMED") && m.utcDate) {
        const kick = Date.parse(m.utcDate);
        const diff = kick - now;
        if (diff > 0 && diff <= 10 * 60_000) {
          pregameSent.add(id);

          const emb = new EmbedBuilder()
            .setTitle("⏰ PRÉ-JOGO! (começa em ~10 min)")
            .setDescription(
              `⚽ **${homeName}** vs **${awayName}**\n🗓️ ${brDateTime(m.utcDate)} _(Brasília)_`
            )
            .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

          const crest = crestUrl(homeTeam) || crestUrl(awayTeam);
          if (crest) emb.setThumbnail(crest);

          await channel.send({ embeds: [emb] });
        }
      }

      // COMEÇOU (LIVE)
      if (prev.status !== "LIVE" && status === "LIVE") {
        const emb = new EmbedBuilder()
          .setTitle("🟢 BOLA ROLANDO!")
          .setDescription(`⚽ **${homeName}** vs **${awayName}**`)
          .addFields({ name: "Placar", value: `**${hs} x ${as}**`, inline: true })
          .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

        const crest = crestUrl(homeTeam) || crestUrl(awayTeam);
        if (crest) emb.setThumbnail(crest);

        await channel.send({ embeds: [emb] });
      }

      // GOL (mudou placar)
      if (status === "LIVE" && (hs !== prev.home || as !== prev.away)) {
        const homeScored = hs > prev.home;
        const awayScored = as > prev.away;

        let title = "⚽ GOOOOL!";
        let thumb = crestUrl(homeTeam) || crestUrl(awayTeam);

        if (homeScored && !awayScored) {
          title = `⚽ GOOOOL DO **${homeName}**!`;
          thumb = crestUrl(homeTeam) || thumb;
        } else if (awayScored && !homeScored) {
          title = `⚽ GOOOOL DO **${awayName}**!`;
          thumb = crestUrl(awayTeam) || thumb;
        } else {
          title = "⚽ GOOOOL! (atualização rápida)";
        }

        const emb = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`🔥 **${homeName} ${hs} x ${as} ${awayName}**`)
          .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

        if (thumb) emb.setThumbnail(thumb);

        await channel.send({ embeds: [emb] });
      }

      // FIM DE JOGO
      if (status === "FINISHED" && !finishedSent.has(id)) {
        finishedSent.add(id);

        const emb = new EmbedBuilder()
          .setTitle("🏁 FIM DE JOGO!")
          .setDescription(`✅ **${homeName} ${hs} x ${as} ${awayName}**`)
          .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

        const crest = crestUrl(homeTeam) || crestUrl(awayTeam);
        if (crest) emb.setThumbnail(crest);

        await channel.send({ embeds: [emb] });
      }

      matchState.set(id, { home: hs, away: as, status });
    }
  } catch (e) {
    console.log("pollAlerts erro:", e?.message || e);
  }
}

// ===== Prefix handler =====
async function handlePrefix(msg) {
  const text = msg.content.trim();
  const lower = text.toLowerCase();

  if (seenMsgIds.has(msg.id)) return;
  seenMsgIds.add(msg.id);
  setTimeout(() => seenMsgIds.delete(msg.id), 60_000);

  const key = `${msg.channelId}:${msg.author.id}:${lower}`;
  const now = Date.now();
  const last = cmdCooldown.get(key) || 0;
  if (now - last < 2500) return;
  cmdCooldown.set(key, now);
  setTimeout(() => cmdCooldown.delete(key), 60_000);

  if (lower === "!ajuda") return msg.channel.send(helpEmbed());
  if (lower === "!teste") return msg.channel.send(`✅ FutNews ativo (${INSTANCE_ID})`);

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
    const q = text.slice("!time ".length).trim();
    const payload = await cmdTime(q);
    return msg.channel.send(payload);
  }
}

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!")) return;
  await handlePrefix(msg);
});

client.once("ready", () => {
  console.log(`ONLINE: ${client.user.tag} | PID ${process.pid} | ${INSTANCE_ID}`);

  // Alertas de jogos (pré/goal/fim)
  setInterval(pollAlerts, 30_000);

  // Notícias RSS (com imagem)
  setInterval(pollNews, 120_000);
});

// HTTP (Railway)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("FutNews Online")).listen(PORT, () => {
  console.log("Servidor HTTP ativo");
});

client.login(TOKEN);
