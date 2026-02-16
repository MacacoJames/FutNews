import { Client, GatewayIntentBits } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;

console.log("TOKEN EXISTE?", TOKEN ? "SIM" : "NÃO");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.login(TOKEN);
