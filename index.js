import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import http from "http";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const TOKEN = process.env.DISCORD_TOKEN;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;

// ====== FEEDS DO GE (sem Google News) ======
const FEEDS = [
  // Futebol (geral)
  "https://ge.globo.com/rss/futebol/",
  // Brasileirão Série A (se esse cair, o de cima ainda funciona)
  "https://ge.globo.com/rss/futebol/brasileirao-serie-a/",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const INSTANCE_ID =
  process.env.INSTANCE_ID || `inst-${Math.random().toString(36).slice(2, 8)}`;

// ===== XML parser tolerante =====
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

// ===== util =====
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
  return team?.crest || null;
}
async function footballGet(url) {
  const res = await fetch(url, { headers: { "X-Auth-Token": FOOTBALL_API_KEY } });
  if (!res.ok) throw new Error(`API futebol erro (status ${res.status})`);
  return res.json();
}
async function getChannel() {
  return await client.channels.fetch(CHANNEL_ID);
}

// ===== anti spam de comando =====
const seenMsgIds = new Set();
const cmdCooldown = new Map();

// ===== estado (alertas) =====
const matchState = new Map();
const pregameSent = new Set();
const finishedSent = new Set();

// ===== estado (notícias) =====
const seenNewsKeys = new Set();
let rssWarmedUp = false;

function rememberKey(key) {
  seenNewsKeys.add(key);
  if (seenNewsKeys.size > 80) {
    const first = seenNewsKeys.values().next().value;
    seenNewsKeys.delete(first);
  }
}
function newsKey(it) {
  // para o GE, o link costuma ser estável
  const title = (it?.title || "").toString().trim();
  const link = (it?.link || "").toString().trim();
  return `${title}||${link}`;
}

// ===== RSS helpers =====
function decodeEntities(str = "") {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
function stripHtml(html = "") {
  return decodeEntities(String(html))
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickImageFromRssItem(item) {
  // enclosure
  if (item?.enclosure?.url) return item.enclosure.url;
  if (item?.enclosure?.["@_url"]) return item.enclosure["@_url"];

  // media:content / media:thumbnail
  const mc = item?.["media:content"];
  if (Array.isArray(mc)) {
    const first = mc.find((x) => x?.url || x?.["@_url"]);
    if (first) return first.url || first["@_url"];
  } else if (mc?.url || mc?.["@_url"]) {
    return mc.url || mc["@_url"];
  }

  const mt = item?.["media:thumbnail"];
  if (Array.isArray(mt)) {
    const first = mt.find((x) => x?.url || x?.["@_url"]);
    if (first) return first.url || first["@_url"];
  } else if (mt?.url || mt?.["@_url"]) {
    return mt.url || mt["@_url"];
  }

  // tenta <img> no description (às vezes vem escapado)
  const htmlRaw =
    item?.description || item?.summary || item?.["content:encoded"] || item?.content || "";
  const html = decodeEntities(String(htmlRaw));

  const m1 = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m1?.[1]) return m1[1];

  return null;
}

async function fetchWithRetry(url, tries = 2) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FutNewsBot/1.0)",
          Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  throw lastErr;
}

async function getRssItemsFromFeed(feedUrl) {
  const xml = await fetchWithRetry(feedUrl, 2);
  const parsed = xmlParser.parse(xml);

  const channel = parsed?.rss?.channel || parsed?.channel;
  let items = channel?.item || [];
  if (!Array.isArray(items)) items = items ? [items] : [];

  items = items.map((it) => ({
    ...it,
    title: it.title?.["#text"] ?? it.title,
    link: it.link?.href ?? it.link?.["#text"] ?? it.link,
    pubDate: it.pubDate?.["#text"] ?? it.pubDate,
    description: it.description?.["#text"] ?? it.description,
  }));

  return items;
}

async function getRssItemsSmart() {
  let lastError = null;

  for (const url of FEEDS) {
    try {
      const items = await getRssItemsFromFeed(url);
      if (items.length) return { items, usedUrl: url };
      lastError = new Error("RSS sem itens");
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Não consegui acessar o RSS do GE agora.");
}

// ===== comandos futebol =====
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
        "• `!noticias` / `!noticia` (últimas 5 do GE)",
        "• `!teste`",
        "• `!ajuda`",
        "",
        "📰 Notícias automáticas: GE.",
      ].join("\n")
    )
    .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

  return { embeds: [emb] };
}

// ===== comando: !noticias =====
async function cmdNoticias(limit = 5) {
  const { items, usedUrl } = await getRssItemsSmart();
  const slice = items.slice(0, Math.max(1, Math.min(10, limit)));
  if (!slice.length) return { content: "📰 Não achei notícias do GE agora." };

  const first = slice[0];
  const title = stripHtml(first.title || "Notícia");
  const link = (first.link || "").toString().trim();
  const img = pickImageFromRssItem(first);

  const emb = new EmbedBuilder()
    .setTitle(`📰 ${title}`)
    .setURL(link || null)
    .setFooter({ text: `GE • ${INSTANCE_ID}` });

  const descRaw = first.description || first.summary || first["content:encoded"] || "";
  const desc = stripHtml(descRaw).slice(0, 220);
  if (desc) emb.setDescription(desc + (desc.length >= 220 ? "..." : ""));

  if (img) emb.setImage(img);

  const rest = slice.slice(1).map((it, i) => {
    const t = stripHtml(it.title || `Notícia ${i + 2}`);
    const l = (it.link || "").toString().trim();
    return `${i + 2}. ${t}${l ? ` — ${l}` : ""}`;
  });

  return {
    embeds: [emb],
    content: `Fonte: ${usedUrl}\n` + (rest.length ? `Outras:\n${rest.join("\n")}` : ""),
  };
}

// ===== notícias automáticas (sem repetir) =====
async function pollNews() {
  try {
    if (!CHANNEL_ID) return;

    const { items } = await getRssItemsSmart();
    if (!items.length) return;

    // aquece sem postar
    if (!rssWarmedUp) {
      for (const it of items.slice(0, 12)) rememberKey(newsKey(it));
      rssWarmedUp = true;
      console.log("RSS do GE aquecido (sem postar na primeira rodada).");
      return;
    }

    let picked = null;
    for (const it of items.slice(0, 12)) {
      const key = newsKey(it);
      if (!seenNewsKeys.has(key)) {
        picked = it;
        rememberKey(key);
        break;
      }
    }
    if (!picked) return;

    const channel = await getChannel();

    const title = stripHtml(picked.title || "Nova notícia");
    const link = (picked.link || "").toString().trim();
    const img = pickImageFromRssItem(picked);

    const emb = new EmbedBuilder()
      .setTitle(`📰 ${title}`)
      .setURL(link || null)
      .setFooter({ text: `GE • ${INSTANCE_ID}` });

    const descRaw = picked.description || picked.summary || picked["content:encoded"] || "";
    const desc = stripHtml(descRaw).slice(0, 220);
    if (desc) emb.setDescription(desc + (desc.length >= 220 ? "..." : ""));

    if (img) emb.setImage(img);

    await channel.send({ embeds: [emb] });
  } catch (e) {
    console.log("pollNews erro:", e?.message || e);
  }
}

// ===== alertas automáticos (pré-jogo / gol / fim) =====
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
            .setDescription(`⚽ **${homeName}** vs **${awayName}**\n🗓️ ${brDateTime(m.utcDate)} _(Brasília)_`)
            .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

          const crest = crestUrl(homeTeam) || crestUrl(awayTeam);
          if (crest) emb.setThumbnail(crest);

          await channel.send({ embeds: [emb] });
        }
      }

      // COMEÇOU
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

      // GOL
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
        }

        const emb = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`🔥 **${homeName} ${hs} x ${as} ${awayName}**`)
          .setFooter({ text: `FutNews • ${INSTANCE_ID}` });

        if (thumb) emb.setThumbnail(thumb);

        await channel.send({ embeds: [emb] });
      }

      // FIM
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

// ===== handler =====
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

  if (lower === "!noticias" || lower === "!noticia" || lower === "!notícia") {
    try {
      const payload = await cmdNoticias(5);
      return msg.channel.send(payload);
    } catch (e) {
      return msg.channel.send(`⚠️ O RSS do GE caiu agora. Tenta de novo daqui a pouco.\n(${e?.message || "erro"})`);
    }
  }

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

  setInterval(pollAlerts, 30_000);
  setInterval(pollNews, 180_000); // 3 min
});

// HTTP (Railway)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("FutNews Online")).listen(PORT, () => {
  console.log("Servidor HTTP ativo");
});

client.login(TOKEN);
