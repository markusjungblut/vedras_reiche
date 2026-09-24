import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ACCOUNT_PERSISTENCE_VERSION = 1 as const;
export const ACCOUNT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_HASH_N = 16_384;
const PASSWORD_HASH_R = 8;
const PASSWORD_HASH_P = 1;

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly normalizedUsername: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicAccount {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface AccountSession {
  readonly tokenHash: string;
  readonly accountId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string;
}

export interface PersistedAccounts {
  readonly persistenceVersion: typeof ACCOUNT_PERSISTENCE_VERSION;
  readonly accounts: readonly Account[];
  readonly sessions: readonly AccountSession[];
}

export interface AccountStore {
  load(): Promise<PersistedAccounts>;
  save(snapshot: PersistedAccounts): Promise<void>;
}

export class AccountError extends Error {
  constructor(readonly code: "USERNAME_TAKEN" | "INVALID_USERNAME" | "INVALID_DISPLAY_NAME" | "PASSWORD_TOO_SHORT" | "INVALID_CREDENTIALS" | "UNAUTHENTICATED", message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export interface AccountManagerOptions {
  readonly store?: AccountStore;
  readonly now?: () => string;
  readonly accountIdFactory?: () => string;
  readonly sessionTokenFactory?: () => string;
}

class MemoryAccountStore implements AccountStore {
  private snapshot: PersistedAccounts = { persistenceVersion: ACCOUNT_PERSISTENCE_VERSION, accounts: [], sessions: [] };

  async load(): Promise<PersistedAccounts> { return cloneSnapshot(this.snapshot); }
  async save(snapshot: PersistedAccounts): Promise<void> { this.snapshot = cloneSnapshot(snapshot); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximum = 1_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function cloneSnapshot(snapshot: PersistedAccounts): PersistedAccounts {
  return JSON.parse(JSON.stringify(snapshot)) as PersistedAccounts;
}

function defaultSnapshot(): PersistedAccounts {
  return { persistenceVersion: ACCOUNT_PERSISTENCE_VERSION, accounts: [], sessions: [] };
}

function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE");
}

function assertUsername(value: string): { readonly username: string; readonly normalizedUsername: string } {
  const username = value.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u.test(username)) {
    throw new AccountError("INVALID_USERNAME", "Der Benutzername ist ungültig.");
  }
  return { username, normalizedUsername: normalizeUsername(username) };
}

function assertDisplayName(value: string, username: string): string {
  const displayName = value.trim() || username;
  if (displayName.length > 80) throw new AccountError("INVALID_DISPLAY_NAME", "Der Anzeigename ist ungültig.");
  return displayName;
}

function assertPassword(value: string): void {
  if (value.length < PASSWORD_MIN_LENGTH) throw new AccountError("PASSWORD_TOO_SHORT", "Das Passwort ist zu kurz.");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return ["scrypt", PASSWORD_HASH_N, PASSWORD_HASH_R, PASSWORD_HASH_P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, expectedValue] = encoded.split("$");
  if (algorithm !== "scrypt" || n !== String(PASSWORD_HASH_N) || r !== String(PASSWORD_HASH_R) || p !== String(PASSWORD_HASH_P) ||
      saltValue === undefined || expectedValue === undefined) return false;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(expectedValue, "base64url");
    if (salt.length < 16 || expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = await derivePassword(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_HASH_N, r: PASSWORD_HASH_R, p: PASSWORD_HASH_P, maxmem: 64 * 1024 * 1024,
  }, (error, derived) => error === null ? resolve(derived) : reject(error)));
}

function deserializeSnapshot(value: unknown): PersistedAccounts {
  if (!isRecord(value) || value.persistenceVersion !== ACCOUNT_PERSISTENCE_VERSION || !Array.isArray(value.accounts) || !Array.isArray(value.sessions)) {
    throw new Error("Invalid account persistence data.");
  }
  const accountIds = new Set<string>();
  const usernames = new Set<string>();
  const accounts: Account[] = [];
  for (const candidate of value.accounts) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.id, 160) || !isNonEmptyString(candidate.username, 32) ||
        !isNonEmptyString(candidate.normalizedUsername, 32) || !isNonEmptyString(candidate.displayName, 80) ||
        !isNonEmptyString(candidate.passwordHash, 1_000) || !isIsoTimestamp(candidate.createdAt) || !isIsoTimestamp(candidate.updatedAt) ||
        accountIds.has(candidate.id) || usernames.has(candidate.normalizedUsername)) throw new Error("Invalid account persistence data.");
    if (normalizeUsername(candidate.username) !== candidate.normalizedUsername) throw new Error("Invalid account persistence data.");
    accountIds.add(candidate.id);
    usernames.add(candidate.normalizedUsername);
    accounts.push({ id: candidate.id, username: candidate.username, normalizedUsername: candidate.normalizedUsername,
      displayName: candidate.displayName, passwordHash: candidate.passwordHash, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt });
  }
  const tokenHashes = new Set<string>();
  const sessions: AccountSession[] = [];
  for (const candidate of value.sessions) {
    if (!isRecord(candidate) || typeof candidate.tokenHash !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.tokenHash) ||
        !isNonEmptyString(candidate.accountId, 160) || !accountIds.has(candidate.accountId) || !isIsoTimestamp(candidate.createdAt) ||
        !isIsoTimestamp(candidate.expiresAt) || !isIsoTimestamp(candidate.lastUsedAt) || tokenHashes.has(candidate.tokenHash)) {
      throw new Error("Invalid account persistence data.");
    }
    tokenHashes.add(candidate.tokenHash);
    sessions.push({ tokenHash: candidate.tokenHash, accountId: candidate.accountId, createdAt: candidate.createdAt,
      expiresAt: candidate.expiresAt, lastUsedAt: candidate.lastUsedAt });
  }
  return { persistenceVersion: ACCOUNT_PERSISTENCE_VERSION, accounts, sessions };
}

export class FileAccountStore implements AccountStore {
  constructor(private readonly directory: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const probe = join(this.directory, `.vedras-accounts-probe-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(probe, "", { encoding: "utf8", flag: "wx" });
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  async load(): Promise<PersistedAccounts> {
    try {
      return deserializeSnapshot(JSON.parse(await readFile(this.fileName(), "utf8")) as unknown);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return defaultSnapshot();
      throw error;
    }
  }

  async save(snapshot: PersistedAccounts): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const verified = deserializeSnapshot(snapshot);
    const target = this.fileName();
    const temporary = join(this.directory, `.accounts.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(verified), "utf8");
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private fileName(): string { return join(this.directory, "accounts.json"); }
}

/** Persists long-lived accounts and opaque account-session hashes without exposing either credential to clients. */
export class AccountManager {
  private readonly accountsById = new Map<string, Account>();
  private readonly accountsByUsername = new Map<string, Account>();
  private readonly sessionsByHash = new Map<string, AccountSession>();
  private readonly store: AccountStore;
  private readonly now: () => string;
  private readonly accountIdFactory: () => string;
  private readonly sessionTokenFactory: () => string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AccountManagerOptions = {}) {
    this.store = options.store ?? new MemoryAccountStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.accountIdFactory = options.accountIdFactory ?? randomUUID;
    this.sessionTokenFactory = options.sessionTokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  async restore(): Promise<void> {
    const snapshot = await this.store.load();
    this.accountsById.clear();
    this.accountsByUsername.clear();
    this.sessionsByHash.clear();
    for (const account of snapshot.accounts) {
      this.accountsById.set(account.id, account);
      this.accountsByUsername.set(account.normalizedUsername, account);
    }
    for (const session of snapshot.sessions) this.sessionsByHash.set(session.tokenHash, session);
  }

  async register(usernameValue: string, displayNameValue: string, password: string): Promise<{ readonly account: PublicAccount; readonly sessionToken: string }> {
    return this.mutate(async () => {
      const { username, normalizedUsername } = assertUsername(usernameValue);
      const displayName = assertDisplayName(displayNameValue, username);
      assertPassword(password);
      if (this.accountsByUsername.has(normalizedUsername)) throw new AccountError("USERNAME_TAKEN", "Dieser Benutzername ist bereits vergeben.");
      const now = this.now();
      const account: Account = { id: this.accountIdFactory(), username, normalizedUsername, displayName,
        passwordHash: await hashPassword(password), createdAt: now, updatedAt: now };
      if (this.accountsById.has(account.id)) throw new Error("Account ID collision.");
      const sessionToken = this.sessionTokenFactory();
      const session = this.createSession(account.id, sessionToken, now);
      await this.saveWith([...this.accountsById.values(), account], [...this.sessionsByHash.values(), session]);
      this.accountsById.set(account.id, account);
      this.accountsByUsername.set(account.normalizedUsername, account);
      this.sessionsByHash.set(session.tokenHash, session);
      return { account: toPublicAccount(account), sessionToken };
    });
  }

  async login(usernameValue: string, password: string): Promise<{ readonly account: PublicAccount; readonly sessionToken: string }> {
    return this.mutate(async () => {
      const account = this.accountsByUsername.get(normalizeUsername(usernameValue));
      if (account === undefined || !await passwordMatches(password, account.passwordHash)) {
        throw new AccountError("INVALID_CREDENTIALS", "Benutzername oder Passwort ist falsch.");
      }
      const now = this.now();
      const sessionToken = this.sessionTokenFactory();
      const session = this.createSession(account.id, sessionToken, now);
      await this.saveWith([...this.accountsById.values()], [...this.sessionsByHash.values(), session]);
      this.sessionsByHash.set(session.tokenHash, session);
      return { account: toPublicAccount(account), sessionToken };
    });
  }

  async resolveSession(sessionToken: string | undefined): Promise<PublicAccount | undefined> {
    if (sessionToken === undefined || sessionToken.length === 0) return undefined;
    return this.mutate(async () => {
      const tokenHash = hashToken(sessionToken);
      const session = this.sessionsByHash.get(tokenHash);
      const account = session === undefined ? undefined : this.accountsById.get(session.accountId);
      if (session === undefined || account === undefined || Date.parse(session.expiresAt) <= Date.parse(this.now())) {
        if (session !== undefined) {
          const sessions = [...this.sessionsByHash.values()].filter((candidate) => candidate.tokenHash !== tokenHash);
          await this.saveWith([...this.accountsById.values()], sessions);
          this.sessionsByHash.delete(tokenHash);
        }
        return undefined;
      }
      const updated = { ...session, lastUsedAt: this.now() };
      await this.saveWith([...this.accountsById.values()], [...this.sessionsByHash.values()].map((candidate) => candidate.tokenHash === tokenHash ? updated : candidate));
      this.sessionsByHash.set(tokenHash, updated);
      return toPublicAccount(account);
    });
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken === undefined || sessionToken.length === 0) return;
    await this.mutate(async () => {
      const tokenHash = hashToken(sessionToken);
      if (!this.sessionsByHash.has(tokenHash)) return;
      const sessions = [...this.sessionsByHash.values()].filter((candidate) => candidate.tokenHash !== tokenHash);
      await this.saveWith([...this.accountsById.values()], sessions);
      this.sessionsByHash.delete(tokenHash);
    });
  }

  private createSession(accountId: string, sessionToken: string, now: string): AccountSession {
    const expiresAt = new Date(Date.parse(now) + ACCOUNT_SESSION_MAX_AGE_SECONDS * 1_000).toISOString();
    return { tokenHash: hashToken(sessionToken), accountId, createdAt: now, expiresAt, lastUsedAt: now };
  }

  private async saveWith(accounts: readonly Account[], sessions: readonly AccountSession[]): Promise<void> {
    await this.store.save({ persistenceVersion: ACCOUNT_PERSISTENCE_VERSION, accounts, sessions });
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation, operation);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export function toPublicAccount(account: Account): PublicAccount {
  return { id: account.id, username: account.username, displayName: account.displayName };
}
