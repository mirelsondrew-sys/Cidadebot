export const groupRules = `📜 REGRAS DO GRUPO:
1. Respeito mútuo acima de tudo.
2. Proibido conteúdo adulto ou ofensivo.
3. Participe ativamente e divirta-se!`;

export const cityGuide = `🏙️ GUIA DA CIDADE - COMANDOS DISPONÍVEIS:
• !saldo - Veja seu saldo em Kz
• !trabalhar - Ganhe um salário diário
• !jogos - Menu de minijogos de cassino
• !loja - Itens disponíveis para compra
• !roubar @membro - Tente assaltar um jogador
• !convidar - Gere um link de convite`;

export const calendarCaption = "Calendário semanal de atividades!";

export const activityMessages: Record<string, string> = {
  "Segunda-feira": "Início de semana! Que tal trabalhar um pouco para acumular saldo? Use !trabalhar",
  "Terça-feira": "Dia de sorte! Os jogos estão abertos. Teste sua sorte com !jogos",
  "Quarta-feira": "Meio da semana na cidade! Converse com os membros e movimente o grupo.",
  "Quinta-feira": "Noite de cassino se aproximando! Já checou seu !saldo hoje?",
  "Sexta-feira": "Sextou! Dia de interagir e agitar as atividades da noite.",
  "Sábado": "Final de semana liberado! Diversão total no grupo.",
  "Domingo": "Dia de descanso e de planejar a próxima semana na cidade."
};

export function weekdayInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: timezone }).format(date);
}

export function localCalendarDayDifference(start: Date, end: Date, timezone: string): number {
  const sStr = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).format(start);
  const eStr = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).format(end);
  const sDate = new Date(sStr);
  const eDate = new Date(eStr);
  return Math.floor((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
