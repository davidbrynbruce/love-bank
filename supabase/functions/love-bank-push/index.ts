// love-bank-push: sends iPhone/Web Push alerts for Love notes.
//   {action:"note", ...}  called by the database trigger on love_bank_notes, authenticated with
//                         the hook secret in love_bank_push_config
//   {action:"key", token} the VAPID public key (made on first use; the private key stays here)
//   {action:"test", token, endpoint} a test alert to one phone
// Every other caller needs a valid Love Bank session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { makeVapidKeys, sendPush, type Subscription, type Vapid } from "./webpush.ts";

const SUBJECT = "https://davidbrynbruce.github.io/love-bank/";
const SITE = "https://davidbrynbruce.github.io";
const NAMES: Record<string, string> = { beth: "Beth", david: "David" };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(origin: string | null): Record<string, string> {
  const ok = origin === SITE || (origin !== null && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : SITE,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function config() {
  const { data, error } = await db.from("love_bank_push_config").select("hook_secret, public_key, private_jwk").eq("id", 1).single();
  if (error) throw error;
  return data as { hook_secret: string; public_key: string | null; private_jwk: JsonWebKey | null };
}
async function vapid(): Promise<Vapid> {
  let c = await config();
  if (!c.public_key || !c.private_jwk) {
    const k = await makeVapidKeys();
    // Only fills an empty slot, so two first calls at once can't leave mismatched keys.
    await db.from("love_bank_push_config").update({ public_key: k.publicKey, private_jwk: k.privateJwk }).eq("id", 1).is("public_key", null);
    c = await config();
  }
  return { publicKey: c.public_key!, privateJwk: c.private_jwk!, subject: SUBJECT };
}
async function sessionOk(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length !== 64) return false;
  const { data, error } = await db.rpc("love_bank_session_ok", { p_token: token });
  return !error && data === true;
}
async function deliver(subs: Subscription[], payload: unknown, v: Vapid): Promise<number> {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(s, payload, v);
      if (status === 404 || status === 410) {
        await db.from("love_bank_push_subs").delete().eq("endpoint", s.endpoint);
      } else if (status >= 200 && status < 300) {
        sent++;
        await db.from("love_bank_push_subs").update({ last_ok: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } else {
        console.log("push refused", status, new URL(s.endpoint).host);
      }
    } catch (e) {
      console.log("push failed", String(e));
    }
  }));
  return sent;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }

  try {
    if (b.action === "note") {
      const c = await config();
      if (!sameSecret(req.headers.get("x-love-bank-secret") ?? "", c.hook_secret)) return json({ error: "forbidden" }, 403, origin);
      const sender = b.sender === "beth" || b.sender === "david" ? b.sender : null;
      if (!sender) return json({ error: "bad_note" }, 400, origin);
      const to = sender === "beth" ? "david" : "beth";
      const { data: subs } = await db.from("love_bank_push_subs").select("endpoint, p256dh, auth").eq("person", to);
      if (!subs || !subs.length) return json({ sent: 0 }, 200, origin);
      const { count } = await db.from("love_bank_notes").select("id", { count: "exact", head: true }).eq("sender", sender).is("read_at", null);
      const text = typeof b.preview === "string" ? b.preview.trim() : "";
      const body = b.has_image ? (text ? "📷 " + text : "📷 Sent you a picture") : (text || "💌");
      const payload = { title: NAMES[sender] + " 💌", body: body.length > 160 ? body.slice(0, 157) + "…" : body, tag: "love-note", url: "./#notes", badge: count ?? 1 };
      const sent = await deliver(subs as Subscription[], payload, await vapid());
      return json({ sent }, 200, origin);
    }

    if (!(await sessionOk(b.token))) return json({ error: "not_signed_in" }, 401, origin);

    if (b.action === "key") {
      const v = await vapid();
      return json({ key: v.publicKey }, 200, origin);
    }
    if (b.action === "test") {
      if (typeof b.endpoint !== "string") return json({ error: "bad_endpoint" }, 400, origin);
      const { data: sub } = await db.from("love_bank_push_subs").select("endpoint, p256dh, auth").eq("endpoint", b.endpoint).maybeSingle();
      if (!sub) return json({ error: "not_subscribed" }, 404, origin);
      const sent = await deliver([sub as Subscription], { title: "Love Bank", body: "Alerts are on. You'll hear when a love note arrives. 💌", tag: "love-bank-test", url: "./#notes" }, await vapid());
      return json({ sent }, 200, origin);
    }
    return json({ error: "unknown_action" }, 400, origin);
  } catch (e) {
    console.log("error", String(e));
    return json({ error: "server" }, 500, origin);
  }
});
