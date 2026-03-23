import "server-only";

import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const DEFAULT_LOCAL_API_JWT_AUDIENCE = "kera-platform";
const DEFAULT_LOCAL_API_JWT_ISSUER = "kera-control-plane";

type LocalApiJwtKeyMaterial = {
  privateKey: KeyObject | null;
  publicKey: KeyObject | null;
  audience: string;
  issuer: string;
  keyId: string;
  sharedSecret: string;
};

let cachedKeyMaterial: LocalApiJwtKeyMaterial | null | undefined;

function trimText(value: unknown): string {
  return String(value ?? "").trim();
}

function readCandidateValue(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = trimText(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function readPemValue(options: {
  base64EnvNames: string[];
  pathEnvNames?: string[];
  pemEnvNames?: string[];
}): string {
  for (const envName of options.base64EnvNames) {
    const encoded = trimText(process.env[envName]);
    if (!encoded) {
      continue;
    }
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
      if (decoded) {
        return decoded;
      }
    } catch {
      continue;
    }
  }
  for (const envName of options.pemEnvNames ?? []) {
    const rawValue = trimText(process.env[envName]);
    if (rawValue) {
      return rawValue.replace(/\\n/g, "\n");
    }
  }
  for (const envName of options.pathEnvNames ?? []) {
    const rawPath = trimText(process.env[envName]);
    if (!rawPath) {
      continue;
    }
    const resolvedPath = resolvePath(rawPath);
    if (!existsSync(resolvedPath)) {
      continue;
    }
    const value = readFileSync(resolvedPath, "utf8").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function loadKeyMaterial(): LocalApiJwtKeyMaterial {
  if (cachedKeyMaterial !== undefined) {
    return cachedKeyMaterial || {
      privateKey: null,
      publicKey: null,
      audience: DEFAULT_LOCAL_API_JWT_AUDIENCE,
      issuer: DEFAULT_LOCAL_API_JWT_ISSUER,
      keyId: "",
      sharedSecret: "",
    };
  }

  const sharedSecret = readCandidateValue(process.env.KERA_LOCAL_API_JWT_SECRET, process.env.KERA_API_SECRET);
  const audience = readCandidateValue(process.env.KERA_LOCAL_API_JWT_AUDIENCE) || DEFAULT_LOCAL_API_JWT_AUDIENCE;
  const issuer = readCandidateValue(process.env.KERA_LOCAL_API_JWT_ISSUER) || DEFAULT_LOCAL_API_JWT_ISSUER;
  const keyId = readCandidateValue(process.env.KERA_LOCAL_API_JWT_KEY_ID);

  const privatePem = readPemValue({
    base64EnvNames: ["KERA_LOCAL_API_JWT_PRIVATE_KEY_B64"],
    pathEnvNames: ["KERA_LOCAL_API_JWT_PRIVATE_KEY_PATH"],
    pemEnvNames: ["KERA_LOCAL_API_JWT_PRIVATE_KEY_PEM"],
  });
  const publicPem = readPemValue({
    base64EnvNames: ["KERA_LOCAL_API_JWT_PUBLIC_KEY_B64"],
    pathEnvNames: ["KERA_LOCAL_API_JWT_PUBLIC_KEY_PATH"],
    pemEnvNames: ["KERA_LOCAL_API_JWT_PUBLIC_KEY_PEM"],
  });

  let privateKey: KeyObject | null = null;
  if (privatePem) {
    privateKey = createPrivateKey(privatePem);
  }

  let publicKey: KeyObject | null = null;
  if (publicPem) {
    publicKey = createPublicKey(publicPem);
  } else if (privateKey) {
    publicKey = createPublicKey(privateKey);
  }

  cachedKeyMaterial = {
    privateKey,
    publicKey,
    audience,
    issuer,
    keyId,
    sharedSecret,
  };
  return cachedKeyMaterial;
}

export function resetLocalApiJwtKeyMaterialCache(): void {
  cachedKeyMaterial = undefined;
}

export function localApiJwtAudience(): string {
  return loadKeyMaterial().audience;
}

export function localApiJwtIssuer(): string {
  return loadKeyMaterial().issuer;
}

export function localApiJwtKeyId(): string {
  return loadKeyMaterial().keyId;
}

export function localApiJwtPrivateKey(): KeyObject | null {
  return loadKeyMaterial().privateKey;
}

export function localApiJwtPublicKey(): KeyObject | null {
  return loadKeyMaterial().publicKey;
}

export function localApiJwtSharedSecret(): string {
  return loadKeyMaterial().sharedSecret;
}
