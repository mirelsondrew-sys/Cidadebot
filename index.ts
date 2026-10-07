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
// --- CONFIGURAÇÕES DO BOT (RECOLOCADAS) ---
const pairingPhone = process.env.PAIRING_PHONE || "";
const authPath = "./session"; 
 const JsonStore = { open: async () => ({ state: { mainGroupId: process.env.GROUP_ID || "", mainGroupTimezone: process.env.TIMEZONE || 'Africa/Luanda', users: [] as any[] } as any }), save: async () => {}, getOrCreateProfile: () => ({} as any) } as any;
const configuredGroupId = process.env.GROUP_ID || "";
const timezone = process.env.TIMEZONE || "America/Sao_Paulo";
type MemberProfile = any;
type PendingInvitation = any;
// ------------------------------------------

if (pairingPhone && (pairingPhone.length < 8 || pairingPhone.length > 15)) {
  throw new Error("PAIRING_PHONE deve conter o indicativo internacional e apenas dígitos.");
}

const possibleChromiumPaths = [
  process.env.CHROMIUM_PATH,
  "/repl/tools/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((candidate): candidate is string => Boolean(candidate));
const chromiumPath = possibleChromiumPaths.find((candidate) =>
  existsSync(candidate),
);

if (!chromiumPath) {
  throw new Error(
    "Não encontrei Chromium. Define CHROMIUM_PATH no ambiente para indicar o executável.",
  );
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
    executablePath: chromiumPath,
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

const slotsHelp =
  "🎰 !casino 15 — três símbolos iguais pagam 5x, dois iguais pagam 1,5x e sem combinação a aposta é perdida.";

function nowIso(): string {
  return new Date().toISOString();
}

function digitsFromId(id: string): string {
  return id.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") || "membro";
}

function mention(id: string): string {
  return `@${digitsFromId(id)}`;
}

function getActorId(message: Message): string | null {
  return message.author || (message.from.endsWith("@g.us") ? null : message.from);
}

function isGroupId(id: string): boolean {
  return id.endsWith("@g.us");
}

async function sendGroup(
  content: string,
  mentions: string[] = [],
): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (!groupId) return;
  await client.sendMessage(groupId, content, mentions.length ? { mentions } : {});
}

async function replyWithMentions(
  message: Message,
  content: string,
  mentions: string[],
): Promise<void> {
  await client.sendMessage(message.from, content, {
    mentions,
    quotedMessageId: message.id._serialized,
  });
}

async function isAdmin(group: GroupChat, actorId: string): Promise<boolean> {
  const participant = group.participants.find(
    (item) => item.id._serialized === actorId,
  );
  return Boolean(participant?.isAdmin || participant?.isSuperAdmin);
}

async function getGroup(groupId: string): Promise<GroupChat> {
  const maxAttempts = 5;
  const failures: unknown[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let chat: Awaited<ReturnType<typeof client.getChatById>> | undefined;
    try {
      chat = await client.getChatById(groupId);
    } catch (error) {
      failures.push(error);
    }

    if (chat) {
      if (!chat.isGroup) {
        throw new Error("O grupo configurado não é um grupo do WhatsApp.");
      }
      return chat as GroupChat;
    }

    const missingChatError = new Error(
      `O WhatsApp ainda não devolveu os dados do grupo (tentativa ${attempt}).`,
    );
    failures.push(missingChatError);
    const lastError = failures[failures.length - 1];
    if (attempt < maxAttempts) {
      console.warn(
        `A consulta do grupo falhou (${attempt}/${maxAttempts}); nova tentativa em 2 segundos.`,
        lastError,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
  }

  throw new AggregateError(
    failures,
    `Não foi possível obter o grupo ${groupId} após ${maxAttempts} tentativas.`,
  );
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

    if (fs.existsSync(pngPath)) {
      finalPath = pngPath;
      mimeType = "image/png";
    } else if (fs.existsSync(jpegPath)) {
      finalPath = jpegPath;
      mimeType = "image/jpeg";
    } else if (fs.existsSync(jpgPath)) {
      finalPath = jpgPath;
      mimeType = "image/jpeg";
    } else {
      await message.reply("Não encontrei o arquivo calendario (png, jpeg ou jpg) dentro da pasta scripts.");
      return;
    }

    const imageBase64 = fs.readFileSync(finalPath, { encoding: 'base64' });
    const media = new MessageMedia(mimeType, imageBase64);

    // Envia direto para o chat sem citar, corrigindo a regressão do __x_id
    await client.sendMessage(message.from, media, {
      caption: "Calendário semanal das actividades do grupo Viver sem receio! Aqui a diversão não tem fim de Segunda a Domingo."
    });

  } catch (error: any) {
    console.error("Erro ao processar imagem:", error);
    await message.reply(`Erro crítico ao enviar: ${error?.message || error}`);
  }
}
  
async function sendNewMemberWelcome(memberId: string): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (groupId) {
    await sendGroup(
      `🎉 Bem-vindo(a) à cidade, ${mention(memberId)}! Para começares, pede !regras no grupo. Depois segue os passos para veres o calendário e conheceres a cidade.`,
      [memberId],
    );
  }
  const privateWelcome = `Seja bem-vindo(a) ao grupo “Viver sem receio”! É uma honra ter-te como membro.

por favor, apresenta-te com o nome, idade, estado civil e localização.

Envia uma foto, usa a opção de visualização única do WhatsApp. !regras para conhecer as regras e continuar a integração.`;

  try {
    await client.sendMessage(memberId, privateWelcome);
  } catch {
    if (groupId) {
      await sendGroup(
        `${mention(memberId)}, a cidade não conseguiu enviar-te uma mensagem privada. Pede !regras aqui no grupo para continuares a integração.`,
        [memberId],
      );
    }
  }
}

async function seedExistingParticipants(): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (!groupId) return;
  try {
    const group = await getGroup(groupId);
    for (const participant of group.participants) {
      store.getOrCreateProfile(participant.id._serialized);
    }
    await store.save();
  } catch (error) {
    process.stderr.write(
      `Não consegui consultar os participantes do grupo: ${String(error)}\n`,
    );
  }
}

async function recordJoin(
  groupId: string,
  memberId: string,
  inviterId: string | null,
  timestampSeconds: number,
): Promise<void> {
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
  const alreadyRewardedForReferral = store.state.joins.some(
    (entry) => entry.memberId === memberId && entry.inviterId,
  );
  if (!store.state.joins.some((entry) => entry.id === joinKey)) {
    store.state.joins.push({
      id: joinKey,
      memberId,
      at: joinedAt,
      inviterId,
    });
  }

  let referralText = "";
  const inviter =
    inviterId &&
    inviterId !== memberId &&
    !alreadyRewardedForReferral
      ? store.getOrCreateProfile(inviterId)
      : null;
  if (inviter) {
    addBalance(inviter, inviteReward);
    referralText = ` ${mention(inviterId!)} ganhou ${formatKz(inviteReward)} pelo convite.`;
  }
  await store.save();
  await sendNewMemberWelcome(memberId);
  if (referralText) {
    await sendGroup(
      `🙌 Novo convite confirmado!${referralText}`,
      inviterId ? [inviterId] : [],
    );
  }
}

function parseMentionTarget(message: Message): string | null {
  return message.mentionedIds[0] || null;
}

function commandParts(body: string): { command: string; args: string[] } {
  const parts = body.trim().split(/\s+/);
  return {
    command: (parts.shift() || "").toLocaleLowerCase("pt-AO"),
    args: parts,
  };
}

async function introduceActivityReward(profile: MemberProfile): Promise<void> {
  const now = Date.now();
  if (
    !profile.lastActivityRewardAt ||
    now - new Date(profile.lastActivityRewardAt).getTime() >=
      interactionCooldownMs
  ) {
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
    await message.reply(
      "✅ Este é agora o grupo principal da cidade. Os lembretes serão enviados às 09h00 e às 14h00 (hora de Luanda)."
    );
    return;
  }

  if (!store.state.mainGroupId) {
    if (command.startsWith("!")) {
      await message.reply(
        "O grupo principal ainda não está definido. Um administrador deve enviar !definirgrupo neste grupo.",
      );
    }
    return;
  }

  if (message.from !== store.state.mainGroupId) {
    if (command === "!cidade") {
      await message.reply(
        "Este ainda não é o grupo principal. Um administrador pode usar !definirgrupo aqui.",
      );
    }
    return;
  }

  const profile = store.getOrCreateProfile(actorId);
  const now = nowIso();
  if (!profile.firstMessageAt) {
    profile.firstMessageAt = now;
    if (profile.joinedAt && !profile.welcomeBonusPaid) {
      addBalance(profile, welcomeBonus);
      profile.welcomeBonusPaid = true;
      await message.reply(
        `🎁 Bónus de boas-vindas: recebeste ${formatKz(welcomeBonus)}! O teu saldo agora é ${formatKz(getBalance(profile))}.`,
      );
    }
  }
  profile.lastActiveAt = now;
  if (!command.startsWith("!")) {
    await introduceActivityReward(profile);
  }

  if (!command.startsWith("!")) {
    await store.save();
    return;
  }

  switch (command) {
    case "!ping":
      await message.reply("pong!");
      break;

    case "!regras":
    case "!regra":
      await message.reply(groupRules);
      if (profile.onboardingStep === "rules") {
        profile.onboardingStep = "calendar";
        await message.reply(
          "Quando estiveres pronto(a), pede !calendario para veres a agenda semanal.",
        );
      }
      break;
      
      case "!calendario":
      case "!calendário":
        await sendCalendar(client, message);
        if (profile.onboardingStep === "calendar" || profile.onboardingStep === "rules") {
          profile.onboardingStep = "city";
          await message.reply(
            "Agora pede !cidade para conheceres os comandos, jogos os conandos da cidade.",
          );
        }
        break;

    case "!cidade":
      await message.reply(cityGuide);
      profile.onboardingStep = "done";
      break;

    case "!jogos":
      await message.reply(
        `🎲 Jogos da cidade:\n!dados 10\n!casino 15\n!roleta 20 vermelho\n\n${slotsHelp}`,
      );
      break;

    case "!saldo":
      await message.reply(`💰 O teu saldo é ${formatKz(getBalance(profile))}.`);
      break;

    case "!trabalhar": {
      const availableAt = profile.workCooldownUntil
        ? new Date(profile.workCooldownUntil).getTime()
        : 0;
      const currentTime = Date.now();
      if (availableAt > currentTime) {
        const minutesLeft = Math.ceil((availableAt - currentTime) / 60_000);
        await message.reply(
          `Ainda estás no turno. Podes voltar a trabalhar em ${minutesLeft} min.`,
        );
        break;
      }
      profile.workCooldownUntil = new Date(
        currentTime + workCooldownMs,
      ).toISOString();
      addBalance(profile, workSalary);
      await message.reply(
        `💼 Trabalhaste no teu turno e recebeste ${formatKz(workSalary)}. Saldo: ${formatKz(getBalance(profile))}.`,
      );
      break;
    }

    case "!dados": {
      const stake = parsePositiveInteger(args[0]);
      if (!stake) {
        await message.reply("Usa !dados [valor]. Exemplo: !dados 10.");
        break;
      }
      if (!ensureFunds(profile, stake)) {
        await message.reply(`Não tens ${formatKz(stake)} para apostar.`);
        break;
      }
      subtractBalance(profile, stake);
      const roll = rollDice();
      if (roll >= 4) {
        addBalance(profile, stake * 2);
        await message.reply(
          `🎲 Saiu ${roll}! Ganhaste ${formatKz(stake)} líquidos. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      } else {
        await message.reply(
          `🎲 Saiu ${roll}. Perdeste ${formatKz(stake)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      }
      break;
    }

    case "!casino":
    case "!cassino":
    case "!slot": {
      const stake = parsePositiveInteger(args[0]);
      if (!stake) {
        await message.reply("Usa !casino [valor]. Exemplo: !casino 15.");
        break;
      }
      if (!ensureFunds(profile, stake)) {
        await message.reply(`Não tens ${formatKz(stake)} para apostar.`);
        break;
      }
      subtractBalance(profile, stake);
      const symbols = spinSlots();
      const counts = new Map<string, number>();
      for (const symbol of symbols) {
        counts.set(symbol, (counts.get(symbol) || 0) + 1);
      }
      const highestMatch = Math.max(...counts.values());
      if (highestMatch === 3) {
        const payout = stake * 5;
        addBalance(profile, payout);
        await message.reply(
          `${symbols.join(" | ")}\n🎉 Três iguais! Prémio: ${formatKz(payout)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      } else if (highestMatch === 2) {
        const payout = Math.floor(stake * 1.5);
        addBalance(profile, payout);
        await message.reply(
          `${symbols.join(" | ")}\n✨ Dois iguais! Recebeste ${formatKz(payout)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      } else {
        await message.reply(
          `${symbols.join(" | ")}\nNão houve combinação. Perdeste ${formatKz(stake)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      }
      break;
    }

    case "!roleta": {
      const first = args[0]?.toLocaleLowerCase("pt-AO");
      const second = args[1]?.toLocaleLowerCase("pt-AO");
      const color = first === "preto" || first === "vermelho" ? first : second;
      const stake = parsePositiveInteger(
        first === "preto" || first === "vermelho" ? second : first,
      );
      if (
        !stake ||
        (color !== "preto" && color !== "vermelho")
      ) {
        await message.reply(
          "Usa !roleta [valor] [preto/vermelho] ou !roleta [preto/vermelho] [valor].",
        );
        break;
      }
      if (!ensureFunds(profile, stake)) {
        await message.reply(`Não tens ${formatKz(stake)} para apostar.`);
        break;
      }
      subtractBalance(profile, stake);
      const result = spinRoulette();
      if (result.color === color) {
        addBalance(profile, stake * 2);
        await message.reply(
          `🎡 Saiu ${result.number} ${result.color}! Ganhaste ${formatKz(stake)} líquidos. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      } else {
        await message.reply(
          `🎡 Saiu ${result.number} ${result.color}. Perdeste ${formatKz(stake)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      }
      break;
    }

    case "!roubar": {
      const targetId = parseMentionTarget(message);
      const amount = Math.min(
        parsePositiveInteger(args.find((arg) => /^\d+$/.test(arg))) || 100,
        maxRobbery,
      );
      if (!targetId || targetId === actorId) {
        await message.reply("Usa !roubar @membro [valor] para tentar um roubo.");
        break;
      }
      const target = store.getOrCreateProfile(targetId);
      if (target.inventory.includes("escudo")) {
        target.inventory.splice(target.inventory.indexOf("escudo"), 1);
        await replyWithMentions(
          message,
          `🛡️ ${mention(targetId)} usou um escudo e evitou o roubo. O escudo foi consumido.`,
          [targetId],
        );
        break;
      }
      if (Math.random() < 0.45 && getBalance(target) > 0) {
        const stolen = Math.min(amount, getBalance(target));
        subtractBalance(target, stolen);
        addBalance(profile, stolen);
        await replyWithMentions(
          message,
          `🦹 Conseguiste roubar ${formatKz(stolen)} a ${mention(targetId)}. O teu saldo é ${formatKz(getBalance(profile))}.`,
          [targetId],
        );
      } else {
        const fine = Math.min(robberyFine, getBalance(profile));
        subtractBalance(profile, fine);
        await message.reply(
          `🚨 Foste apanhado(a)! Multa: ${formatKz(fine)}. Saldo: ${formatKz(getBalance(profile))}.`,
        );
      }
      break;
    }

    case "!convidar": {
      const group = await getGroup(message.from);
      const inviteCode = await group.getInviteCode();
      await message.reply(
        `🔗 Convida pessoas para a cidade com este link: https://chat.whatsapp.com/${inviteCode}\nCada novo membro atribuído a ti pelo WhatsApp rende ${formatKz(inviteReward)}.`,
      );
      break;
    }

    case "!loja": {
      const listing = products
        .map(
          (product) =>
            `${product.id}. ${product.name} — ${formatKz(product.price)}`,
        )
        .join("\n");
      await message.reply(
        `🛒 LOJA DA CIDADE\n${listing}\n\nCompra com !comprar [número ou nome].`,
      );
      break;
    }

    case "!comprar": {
      const selection = args.join(" ").toLocaleLowerCase("pt-AO");
      const product = products.find(
        (item) =>
          item.id === selection ||
          item.key === selection ||
          item.name.toLocaleLowerCase("pt-AO") === selection,
      );
      if (!product) {
        await message.reply("Escolhe um artigo da lista de !loja.");
        break;
      }
      if (!ensureFunds(profile, product.price)) {
        await message.reply(
          `Não tens ${formatKz(product.price)} para comprar ${product.name}.`,
        );
        break;
      }
      subtractBalance(profile, product.price);
      profile.inventory.push(product.key);
      await message.reply(
        `✅ Compraste ${product.name} por ${formatKz(product.price)}. Saldo: ${formatKz(getBalance(profile))}.`,
      );
      break;
    }

    case "!beijo":
    case "!abraço":
    case "!abraco": {
      const targetId = parseMentionTarget(message);
      if (!targetId || targetId === actorId) {
        await message.reply(`Marca alguém: ${command} @membro.`);
        break;
      }
      const action = command === "!beijo" ? "mandou um beijo 😘" : "deu um abraço 🤗";
      await replyWithMentions(
        message,
        `${mention(actorId)} ${action} a ${mention(targetId)}!`,
        [actorId, targetId],
      );
      break;
    }

    case "!café":
    case "!cafe":
    case "!beber":
    case "!cerveja":
    case "!sair":
    case "!encontro": {
      const targetId = parseMentionTarget(message);
      if (!targetId || targetId === actorId) {
        await message.reply(`Marca alguém: ${command} @membro.`);
        break;
      }
      const inviteKind =
        command === "!café" || command === "!cafe"
          ? "tomar um café"
          : command === "!cerveja" || command === "!beber"
            ? "tomar algo"
            : "sair";
      const invitation: PendingInvitation = {
        fromId: actorId,
        kind: inviteKind,
        createdAt: now,
      };
      store.state.pendingInvitations[targetId] = invitation;
      await replyWithMentions(
        message,
        `☕ ${mention(actorId)} convidou ${mention(targetId)} para ${inviteKind}. ${mention(targetId)}, responde !aceitar ou !recusar.`,
        [actorId, targetId],
      );
      break;
    }

    case "!aceitar":
    case "!recusar": {
      const invitation = store.state.pendingInvitations[actorId];
      if (!invitation) {
        await message.reply("Não tens nenhum convite pendente.");
        break;
      }
      delete store.state.pendingInvitations[actorId];
      if (command === "!aceitar") {
        await replyWithMentions(
          message,
          `🥳 ${mention(actorId)} aceitou o convite de ${mention(invitation.fromId)} para ${invitation.kind}!`,
          [actorId, invitation.fromId],
        );
      } else {
        await message.reply(
          "Eita... [@UtilizadorA], ti deram barra em público! 💀 Força aí, soldado.",
        );
      }
      break;
    }

    case "!adicionado":
      profile.confirmedAdded = true;
      profile.confirmedAddedAt = now;
      await message.reply(
        "✅ Registado! Obrigado por convidares pessoas para a cidade.",
      );
      break;

    case "!novo": {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const recent = store.state.joins.filter(
        (entry) => new Date(entry.at).getTime() >= cutoff,
      );
      if (!recent.length) {
        await message.reply("Não entrou nenhum membro nas últimas 24 horas.");
        break;
      }
      const list = recent
        .map((entry) => `• ${mention(entry.memberId)}`)
        .join("\n");
      await replyWithMentions(message, `🆕 Membros das últimas 24 horas:\n${list}`, [
        ...new Set(recent.map((entry) => entry.memberId)),
      ]);
      break;
    }

    case "!avisar": {
      const group = await getGroup(message.from);
      if (!(await isAdmin(group, actorId))) {
        await message.reply("Este comando só pode ser usado por um administrador.");
        break;
      }
      const targetId = parseMentionTarget(message);
      if (!targetId || targetId === actorId) {
        await message.reply("Usa !avisar @membro [motivo].");
        break;
      }
      const reason = args
        .filter((arg) => !arg.startsWith("@"))
        .join(" ")
        .trim() || "incumprimento das regras";
      const target = store.getOrCreateProfile(targetId);
      target.warnings.push({ at: now, reason });
      await replyWithMentions(
        message,
        `⚠️ ${mention(targetId)}, recebeste um aviso da moderação: ${reason}.`,
        [targetId],
      );
      break;
    }

    case "!remover": {
      const group = await getGroup(message.from);
      if (!(await isAdmin(group, actorId))) {
        await message.reply("Este comando só pode ser usado por um administrador.");
        break;
      }
      const targetId = parseMentionTarget(message);
      if (!targetId || targetId === actorId) {
        await message.reply("Usa !remover @membro.");
        break;
      }
      const target = store.getOrCreateProfile(targetId);
      if (!target.warnings.length) {
        await replyWithMentions(
          message,
          `Antes da remoção, avisa ${mention(targetId)} com !avisar @membro [motivo].`,
          [targetId],
        );
        break;
      }
      const result = await group.removeParticipants([targetId]);
      if (result.status === 200) {
        await replyWithMentions(
          message,
          `A moderação removeu ${mention(targetId)} do grupo.`,
          [targetId],
        );
      } else {
        await message.reply(
          "Não consegui remover essa pessoa. Confirma que a cidade é administradora do grupo.",
        );
      }
      break;
    }

    default:
      if (command.startsWith("!")) {
        await message.reply(
          "Não reconheço esse comando. Pede !cidade para veres a lista completa.",
        );
      }
  }

  await store.save();
}

async function sendActivityReminder(): Promise<void> {
  const weekday = weekdayInTimezone(new Date(), timezone);
  const message = activityMessages[weekday];
  if (message) await sendGroup(`📅 ${message}`);
}

async function processMemberFollowups(): Promise<void> {
  const groupId = store.state.mainGroupId;
  if (!groupId) return;
  const now = new Date();
  const localClock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  let changed = false;

  for (const profile of Object.values(store.state.users)) {
    if (!profile.joinedAt || profile.leftAt || profile.confirmedAdded) continue;
    const joinedAt = new Date(profile.joinedAt);
    const hoursSinceJoin = (now.getTime() - joinedAt.getTime()) / 3_600_000;
    const dayNumber = localCalendarDayDifference(joinedAt, now, timezone);

    if (hoursSinceJoin >= 5 && !profile.reminder5hSent) {
      profile.reminder5hSent = true;
      changed = true;
      await sendGroup(
        `⏰ ${mention(profile.id)}, nas próximas horas lembra-te de te apresentares e convidares 6 a 10 pessoas para a cidade. Depois confirma com !adicionado.`,
        [profile.id],
      );
    }

    if (dayNumber === 1 && localClock === "12:00" && !profile.day2NoonSent) {
      profile.day2NoonSent = true;
      changed = true;
      await sendGroup(
        `📣 ${mention(profile.id)}, este é o teu segundo dia na cidade. Lembra-te de convidar 6 a 10 pessoas e confirmar com !adicionado.`,
        [profile.id],
      );
    }

    if (
      dayNumber === 1 &&
      localClock === "17:30" &&
      !profile.day2EveningSent
    ) {
      profile.day2EveningSent = true;
      changed = true;
      profile.warnings.push({
        at: now.toISOString(),
        reason: "Ainda não confirmou que convidou 6 a 10 pessoas.",
      });
      await sendGroup(
        `⚠️ Último lembrete do segundo dia: ${mention(profile.id)}, confirma os convites com !adicionado. Se não convidares 6 a 10 pessoas, a moderação poderá remover-te no terceiro dia.`,
        [profile.id],
      );
    }

    if (dayNumber >= 2 && !profile.day3AdminNotified) {
      profile.day3AdminNotified = true;
      changed = true;
      await sendGroup(
        `🔔 Administração: ${mention(profile.id)} ainda não confirmou os convites após o terceiro dia. Avaliem a situação e, se decidirem remover, usem !remover após o aviso. A cidade não remove membros automaticamente.`,
        [profile.id],
      );
    }
  }

  const lastReportAt = store.state.lastInactivityReportAt;
  const baseline = lastReportAt
    ? new Date(lastReportAt).getTime()
    : new Date(store.state.createdAt).getTime();
  if (now.getTime() - baseline >= 14 * 24 * 60 * 60 * 1000) {
    const inactive = Object.values(store.state.users).filter(
      (profile) => !profile.leftAt && !profile.lastActiveAt,
    );
    if (inactive.length) {
      const mentions = inactive.map((profile) => profile.id);
      const lines = inactive.map(
        (profile) => `• ${mention(profile.id)}`,
      );
      await sendGroup(
        `📋 Lista quinzenal para revisão da administração — membros sem participação registada:\n${lines.join("\n")}\n\nA lista é apenas informativa; a decisão de moderação é dos administradores.`,
        mentions,
      );
    } else {
      await sendGroup(
        "📋 Revisão quinzenal concluída: não há membros sem participação registada.",
      );
    }
    store.state.lastInactivityReportAt = now.toISOString();
    changed = true;
  }

  if (changed) await store.save();
}

function scheduleSafely(
  expression: string,
  label: string,
  callback: () => Promise<void>,
): void {
  cron.schedule(
    expression,
    () => {
      void callback().catch((error: unknown) => {
        console.error("Erro na rotina cron:", error);
        process.stderr.write(`Erro na rotina "${label}": ${String(error)}\n`);
      });
    },
    { timezone }
  );
}
client.on("qr", (qr) => {
  process.stdout.write("\nLê este QR Code com o WhatsApp para ligar a Cidade:\n");
  qrcode.generate(qr, { small: true });
});

client.on("code", (code) => {
  process.stdout.write(
    `\nCódigo de ligação do WhatsApp: ${code}\nIntroduz este código no telefone que vais ligar.\n`,
  );
});

client.on("authenticated", () => {
  process.stdout.write("WhatsApp autenticado.\n");
});

client.on("auth_failure", (error) => {
  process.stderr.write(`Falha na autenticação do WhatsApp: ${error}\n`);
});

client.on("ready", async () => {
  process.stdout.write("Cidade está ligada ao WhatsApp.\n");
  await seedExistingParticipants();
});

client.on("message", async (message) => {
  try {
    await handleMessage(message);
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
    try {
      await message.reply("Ocorreu um erro. Tenta novamente daqui a pouco.");
    } catch {
      // A conversa pode já não estar disponível.
    }
  }
});

client.on("group_join", async (notification) => {
  const memberIds = notification.recipientIds || [];
  for (const memberId of memberIds) {
    try {
      await recordJoin(
        notification.chatId,
        memberId,
        notification.author || null,
        notification.timestamp || Math.floor(Date.now() / 1000),
      );
    } catch (error) {
      process.stderr.write(`Erro ao registar novo membro: ${String(error)}\n`);
    }
  }
});

client.on("group_leave", async (notification) => {
  if (notification.chatId !== store.state.mainGroupId) return;
  for (const memberId of notification.recipientIds || []) {
    const profile = store.state.users[memberId];
    if (profile) profile.leftAt = nowIso();
  }
  await store.save();
});

client.on("disconnected", (reason) => {
  process.stderr.write(`WhatsApp desligado: ${reason}\n`);
});

scheduleSafely("0 9 * * *", "lembrete das 09h00", sendActivityReminder);
scheduleSafely("0 14 * * *", "lembrete das 14h00", sendActivityReminder);
scheduleSafely(
  "* * * * *",
  "acompanhamento de membros",
  processMemberFollowups,
);

process.stdout.write(`A iniciar a Cidade (fuso horário: ${timezone}).\n`);
if (pairingPhone) {
  process.stdout.write(
    "O WhatsApp vai gerar um código de ligação para o telefone configurado.\n",
  );
} else {
  process.stdout.write(
    "Lê o QR que aparecer no terminal para ligar a conta do WhatsApp.\n",
  );
}

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`\n${signal}: a encerrar a Cidade...\n`);
  for (const task of cron.getTasks().values()) task.stop();
  await store.save();
  await client.destroy();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.initialize();
const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('Bot está online!');
});

app.listen(port, () => {
  console.log(`Servidor de monitoramento rodando na porta ${port}`);
})
