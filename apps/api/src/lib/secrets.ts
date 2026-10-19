// Secret handling (I5.3, I3.2): OAuth tokens are encrypted with AES-256-GCM before they touch the
// database (integration_secrets.ciphertext) and are only ever decrypted on the server.
// Key: TOKEN_ENCRYPTION_KEY = 32 random bytes, base64 or hex.  Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.ts";

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new HttpError(503, "The server isn't configured for storing connections yet (TOKEN_ENCRYPTION_KEY is missing).");
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (k.length !== 32) throw new HttpError(503, "TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex characters).");
  return k;
}

/** Output: v1.<iv>.<tag>.<data>, each part base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/* ---- signed, expiring state for the OAuth round trip (CSRF protection, Q3) ---- */
const sign = (body: string) => createHmac("sha256", key()).update(`oauth-state:${body}`).digest("base64url");

export function signState(payload: Record<string, unknown>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, n: randomBytes(8).toString("hex"), exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the payload, or null when the signature is wrong or the state has expired. */
export function verifyState<T extends Record<string, unknown>>(state: string | undefined): T | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body)), given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    return typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/** Show a secret as •••• plus its last four characters. Never render a full key in the interface. */
export const maskSecret = (v: string) => (v.length <= 8 ? "••••" : `••••${v.slice(-4)}`);
