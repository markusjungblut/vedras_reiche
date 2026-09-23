import { resolve } from "node:path";

const DEVELOPMENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export interface RuntimeConfig {
  readonly port: number;
  readonly dataDirectory: string;
  readonly webOrigins: readonly string[];
  readonly webDistDirectory?: string;
  readonly production: boolean;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3001;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be an integer between 1 and 65535.");
  return port;
}

function parseOrigins(value: string | undefined, production: boolean): readonly string[] {
  const candidates = value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (production && candidates.length === 0) throw new Error("WEB_ORIGIN must name the public HTTPS origin in production.");
  if (candidates.length === 0) return DEVELOPMENT_ORIGINS;
  return [...new Set(candidates.map((candidate) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("WEB_ORIGIN must contain complete http or https origins.");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== candidate || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("WEB_ORIGIN entries must be exact origins without paths, queries, or fragments.");
    }
    return parsed.origin;
  }))];
}

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = environment.NODE_ENV === "production" || process.argv.includes("--production");
  const configuredWebDist = environment.VEDRAS_WEB_DIST?.trim();
  return {
    port: parsePort(environment.PORT),
    dataDirectory: resolve(environment.VEDRAS_DATA_DIR?.trim() || "data"),
    webOrigins: parseOrigins(environment.WEB_ORIGIN, production),
    ...(configuredWebDist !== undefined && configuredWebDist !== "" ? { webDistDirectory: resolve(configuredWebDist) } :
      production ? { webDistDirectory: resolve("apps", "web", "dist") } : {}),
    production,
  };
}
