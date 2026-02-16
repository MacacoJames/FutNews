import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.DISCORD_TOKEN;

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.login(TOKEN);
