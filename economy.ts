import type { MemberProfile } from "./state.js";

export const welcomeBonus = 500;
export const interactionReward = 10;
export const interactionCooldownMs = 60 * 60 * 1000;
export const workCooldownMs = 60 * 60 * 1000;
export const workSalary = 250;
export const inviteReward = 100;
export const robberyFine = 100;
export const maxRobbery = 500;

export function formatKz(amount: number): string {
  return `${new Intl.NumberFormat("pt-AO", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.floor(amount)))} Kz`;
}

export function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function ensureFunds(profile: MemberProfile, amount: number): boolean {
  return getBalance(profile) >= amount;
}

export function getBalance(profile: MemberProfile): number {
  return profile.balance ?? 0;
}

export function setBalance(profile: MemberProfile, amount: number): void {
  profile.balance = Math.max(0, Math.floor(amount));
}

export function addBalance(profile: MemberProfile, amount: number): void {
  setBalance(profile, getBalance(profile) + amount);
}

export function subtractBalance(profile: MemberProfile, amount: number): void {
  setBalance(profile, getBalance(profile) - amount);
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

const slotSymbols = ["🍇", "🍒", "🍋", "🔔", "💎", "7️⃣"];

export function spinSlots(): [string, string, string] {
  return [
    slotSymbols[Math.floor(Math.random() * slotSymbols.length)]!,
    slotSymbols[Math.floor(Math.random() * slotSymbols.length)]!,
    slotSymbols[Math.floor(Math.random() * slotSymbols.length)]!,
  ];
}

export function spinRoulette(): {
  number: number;
  color: "verde" | "preto" | "vermelho";
} {
  const number = Math.floor(Math.random() * 37);
  if (number === 0) return { number, color: "verde" };
  return {
    number,
    color: number % 2 === 0 ? "preto" : "vermelho",
  };
}
