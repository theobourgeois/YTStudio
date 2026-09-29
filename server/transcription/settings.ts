import fs from "node:fs/promises";
import { readJson, writeJson } from "../storage.ts";

interface SettingsFile {
  apiKeys?: Record<string, string>;
}

/** API keys entered in the app, kept in the data dir's `settings.json` (readable by this user only). */
export class ApiKeyStore {
  private data: SettingsFile = {};

  constructor(private file: string) {}

  async load(): Promise<void> {
    this.data = (await readJson<SettingsFile>(this.file)) ?? {};
  }

  get(id: string): string | null {
    const key = this.data.apiKeys?.[id];
    return typeof key === "string" && key ? key : null;
  }

  async set(id: string, key: string | null): Promise<void> {
    const apiKeys = { ...this.data.apiKeys };
    if (key) apiKeys[id] = key;
    else delete apiKeys[id];
    this.data = { ...this.data, apiKeys };
    await writeJson(this.file, this.data);
    await fs.chmod(this.file, 0o600);
  }
}
