import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const packageDirectory = resolve(moduleDirectory, "../..");
export const workspaceDirectory = resolve(packageDirectory, "..");
export const calendarImagePath = resolve(packageDirectory, "calendario.png");
const dataPath = resolve(packageDirectory, "data/cidade.json");

export type MemberProfile = {
  id: string;
  balance: number;
  joinedAt: string | null;
  firstMessageAt: string | null;
  welcomeBonusPaid: boolean;
  confirmedAdded: boolean;
  confirmedAddedAt: string | null;
  onboardingStep: "rules" | "calendar" | "city" | "done";
  lastActiveAt: string | null;
  lastActivityRewardAt: string | null;
  workCooldownUntil: string | null;
  inventory: string[];
  warnings: Array<{ at: string; reason: string }>;
  reminder5hSent: boolean;
  day2NoonSent: boolean;
  day2EveningSent: boolean;
  day3AdminNotified: boolean;
  leftAt: string | null;
};

export type JoinRecord = {
  id: string;
  memberId: string;
  at: string;
  inviterId: string | null;
};

export type PendingInvitation = {
  fromId: string;
  kind: string;
  createdAt: string;
};

export type CityState = {
  schemaVersion: 1;
  createdAt: string;
  mainGroupId: string | null;
  mainGroupTimezone: string | null;
  lastInactivityReportAt: string | null;
  users: Record<string, MemberProfile>;
  joins: JoinRecord[];
  pendingInvitations: Record<string, PendingInvitation>;
};

function emptyState(): CityState {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    mainGroupId: null,
    mainGroupTimezone: null,
    lastInactivityReportAt: null,
    users: {},
    joins: [],
    pendingInvitations: {},
  };
}

function newProfile(id: string, joinedAt: string | null): MemberProfile {
  return {
    id,
    balance: 0,
    joinedAt,
    firstMessageAt: null,
    welcomeBonusPaid: false,
    confirmedAdded: false,
    confirmedAddedAt: null,
    onboardingStep: "rules",
    lastActiveAt: null,
    lastActivityRewardAt: null,
    workCooldownUntil: null,
    inventory: [],
    warnings: [],
    reminder5hSent: false,
    day2NoonSent: false,
    day2EveningSent: false,
    day3AdminNotified: false,
    leftAt: null,
  };
}

export class JsonStore {
  readonly state: CityState;
  private saveQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  private constructor(state: CityState) {
    this.state = state;
  }

  static async open(): Promise<JsonStore> {
    await mkdir(dirname(dataPath), { recursive: true });
    try {
      const content = await readFile(dataPath, "utf8");
      const state = JSON.parse(content) as CityState;
      if (state.schemaVersion !== 1 || !state.users || !state.joins) {
        throw new Error(`Formato de dados não reconhecido em ${dataPath}`);
      }
      if (typeof state.mainGroupTimezone !== "string") {
        state.mainGroupTimezone = null;
      }
      return new JsonStore(state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const store = new JsonStore(emptyState());
      await store.save();
      return store;
    }
  }

  getOrCreateProfile(id: string, joinedAt: string | null = null): MemberProfile {
    const current = this.state.users[id];
    if (current) {
      if (joinedAt && !current.joinedAt) current.joinedAt = joinedAt;
      current.leftAt = null;
      return current;
    }
    const profile = newProfile(id, joinedAt);
    this.state.users[id] = profile;
    return profile;
  }

  async save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    const sequence = ++this.writeSequence;
    this.saveQueue = this.saveQueue.then(async () => {
      const temporaryPath = `${dataPath}.${process.pid}.${sequence}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, dataPath);
    });
    return this.saveQueue;
  }
}
