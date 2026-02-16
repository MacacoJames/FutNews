import { Client, GatewayIntentBits } from "discord.js";
import http from "http";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

client.once("ready", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  try {
    if (!CHANNEL_ID) {
      console.log("CHANNEL_ID faltando nas Variables");
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send("✅ FutNews ligado e pronto pra mandar notícias e placares!");
    console.log("Mensagem de teste enviada no canal!");
  } catch (err) {
    console.log("Erro ao enviar mensagem no canal:", err?.message || err);
  }
});

// Servidor HTTP (pra Railway)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews Bot Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));

client.login(TOKEN);
