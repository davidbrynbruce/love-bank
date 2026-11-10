// love-bank-talk-ai: turns a recorded Talk it through conversation into a write-up.
//   GET-like status:  POST JSON {action:"status", token}             -> {transcribe, writeup} (which keys are set)
//   transcribe:       POST multipart {token, file}                   -> {text}  (audio is never stored)
//   write-up:         POST JSON {action:"writeup", token, date, sections} -> {overall, needs[]}
// Every call needs a valid Love Bank session token. Keys come from the function's secrets:
// OPENAI_API_KEY (transcription) and ANTHROPIC_API_KEY (write-up).
import Anthropic from "npm:@anthropic-ai/sdk@1.2.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkSections, transcribe, writeUp, type Section } from "./ai.ts";

const SITE = "https://davidbrynbruce.github.io";
const AUDIO_MAX_BYTES = 24 * 1024 * 1024;

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
async function sessionOk(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length !== 64) return false;
  const { data, error } = await db.rpc("love_bank_session_ok", { p_token: token });
  return !error && data === true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  try {
    const type = req.headers.get("content-type") ?? "";

    // Audio clip -> text.
    if (type.startsWith("multipart/form-data")) {
      const form = await req.formData();
      if (!(await sessionOk(form.get("token")))) return json({ error: "not_signed_in" }, 401, origin);
      if (!openaiKey) return json({ error: "not_configured", missing: "OPENAI_API_KEY" }, 503, origin);
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return json({ error: "no_audio" }, 400, origin);
      if (file.size > AUDIO_MAX_BYTES) return json({ error: "too_big" }, 413, origin);
      const name = /webm/.test(file.type) ? "clip.webm" : /ogg/.test(file.type) ? "clip.ogg" : "clip.mp4";
      try {
        const text = await transcribe(fetch, openaiKey, file, name);
        return json({ text }, 200, origin);
      } catch (e) {
        console.log("transcribe error", String(e));
        return json({ error: "transcribe_failed" }, 502, origin);
      }
    }

    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
    if (!(await sessionOk(b.token))) return json({ error: "not_signed_in" }, 401, origin);

    if (b.action === "status") {
      return json({ transcribe: !!openaiKey, writeup: !!anthropicKey }, 200, origin);
    }

    if (b.action === "writeup") {
      if (!anthropicKey) return json({ error: "not_configured", missing: "ANTHROPIC_API_KEY" }, 503, origin);
      const problem = checkSections(b.sections);
      if (problem) return json({ error: problem }, 400, origin);
      const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
      const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2 });
      try {
        const out = await writeUp(client, date, b.sections as Section[]);
        return json(out, 200, origin);
      } catch (e) {
        if (e instanceof Error && (e.message === "declined" || e.message === "bad_output")) {
          return json({ error: e.message }, 502, origin);
        }
        if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_key" }, 503, origin);
        if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503, origin);
        if (e instanceof Anthropic.APIError) { console.log("claude error", e.status, e.message); return json({ error: "writeup_failed" }, 502, origin); }
        throw e;
      }
    }

    return json({ error: "unknown_action" }, 400, origin);
  } catch (e) {
    console.log("error", String(e));
    return json({ error: "server" }, 500, origin);
  }
});
