import express from 'express';
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import cron from "node-cron";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import type { GroupChat, Message } from "whatsapp-web.js";
import {
  activityMessages,
  calendarCaption,
  cityGuide,
  groupRules,
  localCalendarDayDifference,
  localDateKey,
  weekdayInTimezone,
} from "./content.js";
import {
  addBalance,
  ensureFunds,
  formatKz,
  getBalance,
  interactionCooldownMs,
  interactionReward,
  inviteReward,
  maxRobbery,
  parsePositiveInteger,
  robberyFine,
  rollDice,
  setBalance,
  spinRoulette,
  spinSlots,
  subtractBalance,
  welcomeBonus,
  workCooldownMs,
  workSalary,
} from "./economy.js";
import {
  calendarImagePath,
  JsonStore,
  packageDirectory,
  type MemberProfile,
  type PendingInvitation,
} from "./state.js";

const timezone = process.env.BOT_TIMEZONE?.trim() || "Africa/Luanda";
const configuredGroupId = process.env.BOT_GROUP_ID?.trim();
const pairingPhone = process.env.PAIRING_PHONE?.replace(/\D/g, "") || "";
const authPath = resolve(packageDirectory, ".wwebjs_auth");

if (pairingPhone && (pairingPhone.length < 8 || pairingPhone.length > 15)) {
  throw new Error("PAIRING_PHONE deve conter o indicativo internacional e apenas dígitos.");
}

await mkdir(authPath, { recursive: true });
const store = await JsonStore.open();
if (configuredGroupId) {
  store.state.mainGroupId = configuredGroupId;
  store.state.mainGroupTimezone = timezone;
  await store.save();
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "cidade",
    dataPath: authPath,
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ]
  },
  authTimeoutMs: 60_000,
  qrMaxRetries: 0,
  deviceName: "cidade",
  ...(pairingPhone
    ? {
        pairWithPhoneNumber: {
          phoneNumber: pairingPhone,
          showNotification: true,
        },
      }
    : {}),
});

const products = [
  { id: "1", key: "agua", name: "Água", price: 50 },
  { id: "2", key: "cafe", name: "Café", price: 100 },
  { id: "3", key: "cerveja", name: "Cerveja virtual", price: 150 },
  { id: "4", key: "escudo", name: "Escudo antirroubo", price: 500 },
  { id: "5", key: "vip", name: "Distintivo VIP", price: 2_000 },
];

const slotsHelp = "🎰 !casino 15 — três símbolos iguais pagam 5x, dois iguais pagam 1,5x e sem combinação a aposta é perdida.";

function nowIso(): string { return new Date().toISOString(); }
function digitsFromId(id: string): string { return id.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") || "membro"; }
function mention(id: string): string { return `@${digitsFromId(id)}`; }
function getActorId(message: Message): string | null { return message.author || (message.from.endsWith("@g.us") ? null : message.from); }
function isGroupId(id: string): boolean { return id.endsWith("@g.us"); }

async function sendGroup(content: string, mentions: string[] = []): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (!groupId) return;
  await client.sendMessage(groupId, content, mentions.length ? { mentions } : {});
}

async function replyWithMentions(message: Message, content: string, mentions: string[]): Promise<void> {
  await client.sendMessage(message.from, content, { mentions, quotedMessageId: message.id._serialized });
}

async function isAdmin(group: GroupChat, actorId: string): Promise<boolean> {
  const participant = group.participants.find((item) => item.id._serialized === actorId);
  return Boolean(participant?.isAdmin || participant?.isSuperAdmin);
}

async function getGroup(groupId: string): Promise<GroupChat> {
  const maxAttempts = 5;
  const failures: unknown[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let chat: any;
    try { chat = await client.getChatById(groupId); } catch (error) { failures.push(error); }
    if (chat) {
      if (!chat.isGroup) throw new Error("O grupo configurado não é um grupo do WhatsApp.");
      return chat as GroupChat;
    }
    if (attempt < maxAttempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  }
  throw new AggregateError(failures, `Não foi possível obter o grupo ${groupId}.`);
}

async function sendCalendar(client: any, message: any): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const pngPath = path.resolve(process.cwd(), "calendario.png");
    const jpegPath = path.resolve(process.cwd(), "calendario.jpeg");
    const jpgPath = path.resolve(process.cwd(), "calendario.jpg");
    let finalPath = "";
    let mimeType = "";
    if (fs.existsSync(pngPath)) { finalPath = pngPath; mimeType = "image/png"; }
    else if (fs.existsSync(jpegPath)) { finalPath = jpegPath; mimeType = "image/jpeg"; }
    else if (fs.existsSync(jpgPath)) { finalPath = jpgPath; mimeType = "image/jpeg"; }
    else {
      await message.reply("Não encontrei o arquivo calendario (png, jpeg ou jpg) no repositório.");
      return;
    }
    const imageBase64 = fs.readFileSync(finalPath, { encoding: 'base64' });
    const media = new MessageMedia(mimeType, imageBase64);
    await client.sendMessage(message.from, media, { caption: "Calendário semanal das actividades do grupo Viver sem receio!" });
  } catch (error: any) {
    await message.reply(`Erro crítico ao enviar: ${error?.message || error}`);
  }
}

async function sendNewMemberWelcome(memberId: string): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (groupId) {
    await sendGroup(`🎉 Bem-vindo(a) à cidade, ${mention(memberId)}! Pede !regras no grupo para começar.`, [memberId]);
  }
  const privateWelcome = `Seja bem-vindo(a) ao grupo “Viver sem receio”! Apresenta-te com nome, idade, estado civil e localização. Envia uma foto de visualização única.`;
  try { await client.sendMessage(memberId, privateWelcome); } catch {
    if (groupId) await sendGroup(`${mention(memberId)}, a cidade não conseguiu enviar-te uma mensagem privada.`, [memberId]);
  }
}

async function seedExistingParticipants(): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (!groupId) return;
  try {
    const group = await getGroup(groupId);
    for (const participant of group.participants) { store.getOrCreateProfile(participant.id._serialized); }
    await store.save();
  } catch (error) { console.error(error); }
}

async function recordJoin(groupId: string, memberId: string, inviterId: string | null, timestampSeconds: number): Promise<void> {
  if (groupId !== store.state.mainGroupId) return;
  const joinedAt = new Date(timestampSeconds * 1000).toISOString();
  const profile = store.getOrCreateProfile(memberId, joinedAt);
  const rejoined = Boolean(profile.leftAt);
  profile.joinedAt = joinedAt;
  profile.leftAt = null;
  if (rejoined) {
    profile.confirmedAdded = false;
    profile.confirmedAddedAt = null;
    profile.reminder5hSent = false;
    profile.day2NoonSent = false;
    profile.day2EveningSent = false;
    profile.day3AdminNotified = false;
  }
  const joinKey = `${groupId}:${memberId}:${timestampSeconds}`;
  const alreadyRewardedForReferral = store.state.joins.some((entry) => entry.memberId === memberId && entry.inviterId);
  if (!store.state.joins.some((entry) => entry.id === joinKey)) {
    store.state.joins.push({ id: joinKey, memberId, at: joinedAt, inviterId });
  }
  let referralText = "";
  const inviter = inviterId && inviterId !== memberId && !alreadyRewardedForReferral ? store.getOrCreateProfile(inviterId) : null;
  if (inviter) { addBalance(inviter, inviteReward); referralText = ` ${mention(inviterId!)} ganhou ${formatKz(inviteReward)}.`; }
  await store.save();
  await sendNewMemberWelcome(memberId);
  if (referralText) await sendGroup(`🙌 Novo convite confirmado!${referralText}`, inviterId ? [inviterId] : []);
}

function parseMentionTarget(message: Message): string | null { return message.mentionedIds[0] || null; }
function commandParts(body: string): { command: string; args: string[] } {
  const parts = body.trim().split(/\s+/);
  return { command: (parts.shift() || "").toLocaleLowerCase("pt-AO"), args: parts };
}

async function introduceActivityReward(profile: MemberProfile): Promise<void> {
  const now = Date.now();
  if (!profile.lastActivityRewardAt || now - new Date(profile.lastActivityRewardAt).getTime() >= interactionCooldownMs) {
    addBalance(profile, interactionReward);
    profile.lastActivityRewardAt = new Date(now).toISOString();
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.fromMe || !isGroupId(message.from)) return;
  const actorId = getActorId(message);
  if (!actorId) return;
  const { command, args } = commandParts(message.body);

  if (command === "!definirgrupo") {
    store.state.mainGroupId = message.from;
    store.state.mainGroupTimezone = timezone;
    await store.save();
    await message.reply("✅ Este é agora o grupo principal da cidade.");
    return;
  }

  if (!store.state.mainGroupId) {
    if (command.startsWith("!")) await message.reply("O grupo principal ainda não está definido.");
    return;
  }

  const profile = store.getOrCreateProfile(actorId);
  const now = nowIso();
  if (!profile.firstMessageAt) {
    profile.firstMessageAt = now;
    if (profile.joinedAt && !profile.welcomeBonusPaid) {
      addBalance(profile, welcomeBonus);
      profile.welcomeBonusPaid = true;
      await message.reply(`🎁 Bónus de boas-vindas: recebeste ${formatKz(welcomeBonus)}!`);
    }
}
profile.lastActiveAt = now;
if (!command.startsWith("!")) await introduceActivityReward(profile);
if (!command.startsWith("!")) { await store.save(); return; }
switch (command) {
case "!ping": await message.reply("pong!"); break;
case "!regras": case "!regra": await message.reply(groupRules); break;
case "!calendario": case "!calendário": await sendCalendar(client, message); break;
case "!cidade": await message.reply(cityGuide); break;
case "!jogos": await message.reply(🎲 Jogos:\n!dados 10\n!casino 15\n!roleta 20 vermelho); break;
case "!saldo": await message.reply(💰 Saldo: ${formatKz(getBalance(profile))}.); break;
case "!trabalhar": {
const availableAt = profile.workCooldownUntil ? new Date(profile.workCooldownUntil).getTime() : 0;
if (availableAt > Date.now()) { await message.reply("Ainda estás no turno."); break; }
profile.workCooldownUntil = new Date(Date.now() + workCooldownMs).toISOString();
addBalance(profile, workSalary);
await message.reply(💼 Recebeste ${formatKz(workSalary)}.);
break;
}
case "!dados": {
const stake = parsePositiveInteger(args[0]);
if (!stake || !ensureFunds(profile, stake)) { await message.reply("Saldo insuficiente ou valor inválido."); break; }
subtractBalance(profile, stake);
const roll = rollDice();
if (roll >= 4) { addBalance(profile, stake * 2); await message.reply(🎲 Ganhaste! Saiu ${roll}.); }
else { await message.reply(🎲 Perdeste. Saiu ${roll}.); }
break;
}
case "!casino": case "!slots": {
const stake = parsePositiveInteger(args[0]);
if (!stake || !ensureFunds(profile, stake)) { await message.reply("Saldo insuficiente."); break; }
subtractBalance(profile, stake);
const symbols = spinSlots();
const highestMatch = Math.max(...symbols.map(s => symbols.filter(x => x === s).length));
if (highestMatch === 3) { addBalance(profile, stake * 5); await message.reply(${symbols.join(" | ")} 🎉 Combo 5x!); }
else if (highestMatch === 2) { addBalance(profile, Math.floor(stake * 1.5)); await message.reply(${symbols.join(" | ")} ✨ Par 1.5x!); }
else { await message.reply(${symbols.join(" | ")} ❌ Sem sorte.); }
break;
}
case "!roubar": {
const targetId = parseMentionTarget(message);
if (!targetId || targetId === actorId) { await message.reply("Marca alguém válido."); break; }
const target = store.getOrCreateProfile(targetId);
if (target.inventory.includes("escudo")) {
target.inventory.splice(target.inventory.indexOf("escudo"), 1);
await replyWithMentions(message, 🛡️ Evitado por escudo!, [targetId]);
break;
}
if (Math.random() < 0.45 && getBalance(target) > 0) {
const stolen = Math.min(100, getBalance(target));
subtractBalance(target, stolen); addBalance(profile, stolen);
await replyWithMentions(message, 🦹 Roubaste ${formatKz(stolen)}!, [targetId]);
} else {
subtractBalance(profile, Math.min(robberyFine, getBalance(profile)));
await message.reply(🚨 Multado!);
}
break;
}
case "!loja": await message.reply(products.map(p => ${p.id}. ${p.name} — ${formatKz(p.price)}).join("\n")); break;
case "!comprar": {
const selection = args.join(" ").toLocaleLowerCase("pt-AO");
const product = products.find(item => item.id === selection || item.key === selection);
if (!product || !ensureFunds(profile, product.price)) { await message.reply("Item indisponível ou saldo insuficiente."); break; }
subtractBalance(profile, product.price); profile.inventory.push(product.key);
await message.reply(✅ Comprado: ${product.name}.);
break;
}
default: if (command.startsWith("!")) await message.reply("Comando não reconhecido.");
}
await store.save();
}
async function sendActivityReminder(): Promise {
const weekday = weekdayInTimezone(new Date(), timezone);
const message = activityMessages[weekday];
if (message) await sendGroup(📅 ${message});
}
async function processMemberFollowups(): Promise {
const groupId = store.state.mainGroupId;
if (!groupId) return;
// Rotina simplificada de monitoramento interna
}
function scheduleSafely(expression: string, label: string, callback: () => Promise): void {
cron.schedule(expression, () => { void callback().catch(err => console.error(err)); }, { timezone });
}
client.on("qr", (qr) => { qrcode.generate(qr, { small: true }); });
client.on("ready", async () => { await seedExistingParticipants(); });
client.on("message", async (msg) => { try { await handleMessage(msg); } catch (e) { console.error(e); } });
scheduleSafely("0 9 * * *", "9am", sendActivityReminder);
scheduleSafely("0 14 * * *", "2pm", sendActivityReminder);
await client.initialize();
// SERVIDOR EXPRESS PARA A RENDER MANTER ALIVE 24H
const app = express();
const port = process.env.PORT || 8080;
app.get('/', (req, res) => { res.send('Bot da Cidade Online 24h!'); });
app.listen(port, () => { console.log(Servidor rodando na porta ${port}); });
