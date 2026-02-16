import { Client, GatewayIntentBits } from 'discord.js';
import http from 'http';

const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.login(TOKEN);

// 👇 SERVIDOR FAKE PRO RAILWAY NÃO MATAR O BOT
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.write("FutNews Bot Online");
  res.end();
}).listen(PORT, () => {
  console.log("Servidor HTTP ativo");
});
