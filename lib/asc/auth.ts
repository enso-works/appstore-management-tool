import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Project } from "../config";
import { fileExists } from "../paths";

/**
 * App Store Connect API tokens for the app's own key (user decision
 * 2026-10-09, see CLAUDE.md): the key is read here, in memory, only to sign
 * a short-lived ES256 token, and never written, logged or returned. Errors
 * name files, never their contents.
 *
 * The key is found the way fastlane and Apple's tools find it, first match wins:
 *  1. APP_STORE_CONNECT_API_KEY_PATH: a key file in fastlane's JSON format
 *     (key_id, issuer_id, key), as fastlane reads it;
 *  2. fastlane/asc_api_key.json in the app;
 *  3. AuthKey_<KEY_ID>.p8 in fastlane/ or Apple's ~/.appstoreconnect/private_keys,
 *     with the ids from ASC_KEY_ID / ASC_ISSUER_ID or the Fastfile's constants.
 */

export class AscAuthError extends Error {}

export interface AscKeyRef {
  /** Unknown until a token is signed when the ids sit inside fastlane's JSON key file. */
  keyId?: string;
  issuerId?: string;
  /** Where the key was found, relative to the app, for messages. */
  source: string;
}

interface LoadedKey {
  keyId: string;
  issuerId: string;
  source: string;
  privateKey: crypto.KeyObject;
}

/** A located key: its ids and where it is, and how to load it when a token is needed. */
interface LocatedKey {
  keyId: string;
  issuerId: string;
  source: string;
  load: () => crypto.KeyObject;
}

/**
 * Which key the app would use, without reading it: a JSON key file is only
 * checked for existence (it holds the key next to the ids), a .p8 is located
 * with the ids from the environment or the Fastfile.
 */
export function findAscKey(project: Project): AscKeyRef | undefined {
  const fromEnv = process.env.APP_STORE_CONNECT_API_KEY_PATH;
  if (fromEnv) return fileExists(fromEnv) ? { source: "APP_STORE_CONNECT_API_KEY_PATH" } : undefined;
  if (fileExists(path.join(project.root, "fastlane", "asc_api_key.json")))
    return { source: "fastlane/asc_api_key.json" };
  try {
    const { keyId, issuerId, source } = locateKey(project);
    return { keyId, issuerId, source };
  } catch {
    return undefined;
  }
}

function loadKey(project: Project): LoadedKey {
  const located = locateKey(project);
  return { keyId: located.keyId, issuerId: located.issuerId, source: located.source, privateKey: located.load() };
}

function locateKey(project: Project): LocatedKey {
  const dir = path.join(project.root, "fastlane");
  const fromEnv = process.env.APP_STORE_CONNECT_API_KEY_PATH;
  if (fromEnv) {
    if (!fileExists(fromEnv)) throw new AscAuthError("APP_STORE_CONNECT_API_KEY_PATH names a file that does not exist");
    return keyFromJson(fromEnv, "APP_STORE_CONNECT_API_KEY_PATH");
  }
  const json = path.join(dir, "asc_api_key.json");
  if (fileExists(json)) return keyFromJson(json, "fastlane/asc_api_key.json");

  // The ids sit in the environment or the Fastfile; neither holds a secret.
  const fastfile = path.join(dir, "Fastfile");
  const text = fileExists(fastfile) ? fs.readFileSync(fastfile, "utf8") : "";
  const constant = (names: string[]) => {
    for (const name of names) {
      // NAME = "x", or NAME = ENV.fetch('ENV', 'x') (the default is the id the lanes use).
      const m = new RegExp(
        `^\\s*${name}\\s*=\\s*(?:ENV\\.fetch\\(\\s*["'][^"']+["']\\s*,\\s*)?["']([^"']+)["']`,
        "m",
      ).exec(text);
      if (m) return m[1];
    }
    return undefined;
  };
  const keyId = process.env.ASC_KEY_ID || constant(["ASC_KEY_ID", "KEY_ID"]);
  const issuerId = process.env.ASC_ISSUER_ID || constant(["ASC_ISSUER_ID", "ISSUER_ID"]);
  if (!keyId || !issuerId) {
    throw new AscAuthError(
      "No App Store Connect key: set APP_STORE_CONNECT_API_KEY_PATH, add fastlane/asc_api_key.json, or name ASC_KEY_ID and ASC_ISSUER_ID in the Fastfile",
    );
  }
  const candidates = [
    { abs: path.join(dir, `AuthKey_${keyId}.p8`), shown: `fastlane/AuthKey_${keyId}.p8` },
    {
      abs: path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`),
      shown: `~/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`,
    },
  ];
  const found = candidates.find((c) => fileExists(c.abs));
  if (!found) {
    throw new AscAuthError(`No AuthKey_${keyId}.p8 in fastlane/ or ~/.appstoreconnect/private_keys`);
  }
  return {
    keyId,
    issuerId,
    source: found.shown,
    load: () => privateKeyFrom(fs.readFileSync(found.abs, "utf8"), found.shown),
  };
}

function keyFromJson(file: string, shown: string): LocatedKey {
  let parsed: { key_id?: unknown; issuer_id?: unknown; key?: unknown; is_key_content_base64?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new AscAuthError(`${shown} is not valid JSON`);
  }
  const { key_id: keyId, issuer_id: issuerId, key, is_key_content_base64: base64 } = parsed;
  if (typeof keyId !== "string" || typeof issuerId !== "string" || typeof key !== "string") {
    throw new AscAuthError(`${shown} needs key_id, issuer_id and key`);
  }
  return {
    keyId,
    issuerId,
    source: shown,
    load: () => privateKeyFrom(base64 ? Buffer.from(key, "base64").toString("utf8") : key, shown),
  };
}

function privateKeyFrom(pem: string, source: string): crypto.KeyObject {
  try {
    const key = crypto.createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ec") throw new Error();
    return key;
  } catch {
    throw new AscAuthError(`${source} does not hold an App Store Connect (EC P-256) private key`);
  }
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** An ES256 token App Store Connect accepts for up to 20 minutes. */
export function signToken(key: { keyId: string; issuerId: string; privateKey: crypto.KeyObject }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: key.keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: key.issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  // JWS wants the raw r||s signature, not DER.
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return { token: `${header}.${payload}.${b64url(signature)}`, expiresAt: (iat + 15 * 60) * 1000 };
}

/** A token source for one project: signs on first use and again shortly before expiry. */
export function tokenSource(project: Project): (fresh?: boolean) => string {
  let key: LoadedKey | undefined;
  let current: { token: string; expiresAt: number } | undefined;
  // `fresh` signs a new token even when the current one is still valid (after a 401).
  return (fresh = false) => {
    key ??= loadKey(project);
    if (fresh || !current || current.expiresAt - Date.now() < 60_000) current = signToken(key);
    return current.token;
  };
}
