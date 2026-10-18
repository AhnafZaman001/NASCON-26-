// Twilio WhatsApp (I1) over plain REST — no SDK. Credentials come from apps/api/.env:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (default: the sandbox number)
//   TWILIO_WORKSPACE_ID (optional; which workspace the sandbox number belongs to, default: newest)
//   PUBLIC_API_URL (optional; when set, Twilio posts status callbacks to it)
import { createHmac, timingSafeEqual } from "node:crypto";

export const twilioEnv = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, token, from: process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886" } : null;
};

export type TwilioMessage = {
  sid: string; from: string; to: string; body: string; status: string; direction: string;
  date_created: string; error_code: number | null; error_message: string | null;
};

async function call<T>(path: string, init?: { method?: string; form?: Record<string, string> }): Promise<T> {
  const env = twilioEnv();
  if (!env) throw new Error("Twilio isn't configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.sid}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: "Basic " + Buffer.from(`${env.sid}:${env.token}`).toString("base64"),
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message ?? `Twilio error ${res.status}`) as Error & { status: number; code?: number };
    err.status = res.status; err.code = json.code;
    throw err;
  }
  return json as T;
}

export const toWhatsApp = (phone: string) => `whatsapp:${phone.startsWith("+") ? phone : `+${phone}`}`;
export const fromWhatsApp = (addr: string) => addr.replace(/^whatsapp:/, "");

export function sendWhatsApp(to: string, body: string) {
  const env = twilioEnv()!;
  const cb = process.env.PUBLIC_API_URL ? `${process.env.PUBLIC_API_URL.replace(/\/$/, "")}/api/webhooks/twilio/status` : undefined;
  return call<TwilioMessage>("/Messages.json", {
    method: "POST", form: { From: env.from, To: toWhatsApp(to), Body: body, ...(cb ? { StatusCallback: cb } : {}) },
  });
}

export const recentMessages = () => call<{ messages: TwilioMessage[] }>("/Messages.json?PageSize=50").then((r) => r.messages);

/** I1.2: X-Twilio-Signature = base64(HMAC-SHA1(authToken, fullUrl + sorted(key+value)...)) */
export function validSignature(signature: string | undefined, url: string, params: Record<string, string>) {
  const env = twilioEnv();
  if (!env || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", env.token).update(data).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Temporary failures are retried by the caller; permanent ones get a plain explanation (I5.5). */
export function explain(e: unknown) {
  const err = e as { status?: number; code?: number; message?: string };
  if (err.code === 63016) return "WhatsApp only allows free-form replies within 24 hours of the customer's last message.";
  if (err.code === 63015 || err.code === 21608) return "This number hasn't joined the WhatsApp sandbox yet. Ask them to send the join phrase first.";
  if (err.status === 401) return "Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.";
  if (err.status && err.status >= 500) return "Twilio is temporarily unavailable. Try again in a moment.";
  return err.message ?? "Twilio couldn't send the message.";
}
