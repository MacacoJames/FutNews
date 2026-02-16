import { Client, GatewayIntentBits } from "discord.js";
import http from "http";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ✅ só uma vez
const TOKEN = process.env.DISCORD_TOKEN;

// (opcional) debug sem vazar token
console.log("TOKEN len:", TOKEN ? TOKEN.length : 0);

client.once("ready", () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.login(TOKEN);

// ✅ servidor fake pro Railway
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("FutNews Bot Online");
  })
  .listen(PORT, () => console.log("Servidor HTTP ativo"));
