import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { authPath } from "../util/paths.ts";

/**
 * Credential store. Lives at ~/.mosaic/auth.json with 0600 permissions.
 * Holds OAuth tokens (Codex) and pasted API keys (OpenCode Go/Zen, or any provider).
 */

export interface OAuthCredential {
  kind: "oauth";
  accessToken: string;
  refreshToken?: string;
  /** Epoch millis when the access token expires. */
  expiresAt?: number;
  accountId?: string;
}

export interface ApiKeyCredential {
  kind: "apikey";
  key: string;
}

export type Credential = OAuthCredential | ApiKeyCredential;

export interface AuthStoreData {
  version: 1;
  credentials: Record<string, Credential>;
}

export class AuthStore {
  private data: AuthStoreData = { version: 1, credentials: {} };
  private loaded = false;

  constructor(private readonly path: string = authPath()) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as AuthStoreData;
      if (parsed && typeof parsed === "object" && parsed.credentials) this.data = parsed;
    } catch {
      // No auth file yet — fine, start empty.
    }
  }

  async get(provider: string): Promise<Credential | undefined> {
    await this.load();
    return this.data.credentials[provider];
  }

  async set(provider: string, credential: Credential): Promise<void> {
    await this.load();
    this.data.credentials[provider] = credential;
    await this.save();
  }

  async remove(provider: string): Promise<boolean> {
    await this.load();
    if (!(provider in this.data.credentials)) return false;
    delete this.data.credentials[provider];
    await this.save();
    return true;
  }

  async list(): Promise<string[]> {
    await this.load();
    return Object.keys(this.data.credentials).sort();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    // Ensure mode even if the file pre-existed with looser perms.
    await chmod(this.path, 0o600).catch(() => {});
  }
}
