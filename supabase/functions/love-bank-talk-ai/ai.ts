// Pure helpers for love-bank-talk-ai, kept free of Deno APIs so they can be tested in Node.
// The Anthropic client is passed in, so tests can give it a fake fetch.
import type Anthropic from "npm:@anthropic-ai/sdk@1.2.0";

export const MODEL = "claude-opus-5-5";
export const NEED_KEYS = [
  "affection", "intimacy", "conversation", "recreation", "honesty",
  "attraction", "finances", "domestic", "family", "admiration",
] as const;
export const TRANSCRIPT_MAX_CHARS = 200_000;

export type PersonRatings = { matters?: number; met?: number; rank?: number; why?: string } | null;
export type Section = {
  label: string;          // "warm-up", "wrap-up", or a need's display name
  need?: string;          // need key when the section was recorded on a need's screen
  transcript: string;
  beth?: PersonRatings;
  david?: PersonRatings;
};
export type WriteUp = {
  overall: string;
  needs: { need: string; talked_about: string; next_step: string }[];
};

export const WRITEUP_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string", description: "Two to four sentences on how the conversation went and its main threads." },
    needs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          need: { type: "string", enum: [...NEED_KEYS] },
          talked_about: { type: "string", description: "One to three sentences: what was said about this need." },
          next_step: { type: "string", description: "The concrete thing agreed to try, and who will do it if that was said. Empty string if nothing was agreed." },
        },
        required: ["need", "talked_about", "next_step"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall", "needs"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You write up a private conversation between a couple, Beth and David, for an app only the two of them use. On a date they went through the emotional needs from Willard Harley's "His Needs, Her Needs" (affection, sexual intimacy, conversation, shared recreation, honesty and openness, attraction, financial security, domestic support, family commitment, admiration). Before the date each of them rated every need for how much it matters (0-10) and how it's going (0-10), ranked a top five, and sometimes wrote why.

You get the transcript in sections. Most sections were recorded while a particular need was on screen, so their talk is mostly about that need, but people drift: put what was said under the need it was actually about.

The transcript is machine-made from one phone on a restaurant table. It has no speaker labels and will contain mistakes and background noise. Read it charitably and ignore obvious mis-hearings and unrelated chatter (ordering food, the waiter).

How to write:
- Address the couple together in the second person ("You talked about...", "You agreed..."). Warm, plain, specific; no therapy jargon, no advice, no judging either of them.
- Say who said something only when the transcript makes the speaker clear, for example when they use their own name, address the other by name, or refer to their own rating in a way that matches only one person's numbers. When it isn't clear, don't guess: describe it as something that came up.
- Use their own words and examples where you can. Never add anything that wasn't said.
- talked_about: one to three sentences for each need that was actually discussed. Leave out needs nobody talked about.
- next_step: only something they agreed to try or said they would do, including who if they said. If nothing was agreed for that need, use an empty string. Don't invent next steps.
- overall: two to four sentences on the shape of the conversation.`;

/** Builds the user message: the couple's ratings for context, then the transcript sections. */
export function buildUserMessage(date: string, sections: Section[]): string {
  const lines: string[] = [];
  lines.push(`Date of the conversation: ${date}`);
  lines.push("");
  for (const s of sections) {
    const head = s.need ? `=== Section recorded on the "${s.label}" screen (need key: ${s.need}) ===` : `=== Section: ${s.label} ===`;
    lines.push(head);
    for (const [who, r] of [["Beth", s.beth], ["David", s.david]] as const) {
      if (!s.need || !r) continue;
      const bits: string[] = [];
      if (typeof r.matters === "number") bits.push(`matters ${r.matters}/10`);
      if (typeof r.met === "number") bits.push(`going ${r.met}/10`);
      if (typeof r.rank === "number") bits.push(`#${r.rank} in top five`);
      if (r.why) bits.push(`wrote: "${r.why}"`);
      if (bits.length) lines.push(`${who}'s check-in: ${bits.join(", ")}`);
    }
    lines.push("Transcript:");
    lines.push(s.transcript.trim() || "(nothing was picked up)");
    lines.push("");
  }
  lines.push("Write up this conversation.");
  return lines.join("\n");
}

/** Validates the sections a client sent. Returns an error code, or null when they're fine. */
export function checkSections(sections: unknown): string | null {
  if (!Array.isArray(sections) || !sections.length || sections.length > 80) return "bad_sections";
  let total = 0;
  for (const s of sections as Section[]) {
    if (!s || typeof s.label !== "string" || typeof s.transcript !== "string") return "bad_sections";
    if (s.need !== undefined && !(NEED_KEYS as readonly string[]).includes(s.need)) return "bad_sections";
    total += s.transcript.length;
  }
  if (total > TRANSCRIPT_MAX_CHARS) return "too_long";
  if (!(sections as Section[]).some((s) => s.transcript.trim())) return "empty";
  return null;
}

/** Asks Claude for the write-up. Throws Error("declined") on a refusal, Error("bad_output") on unusable output. */
export async function writeUp(client: Anthropic, date: string, sections: Section[]): Promise<WriteUp> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: WRITEUP_SCHEMA as unknown as { [key: string]: unknown } },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(date, sections) }],
  });
  if (response.stop_reason === "refusal") throw new Error("declined");
  if (response.stop_reason === "max_tokens") throw new Error("bad_output");
  const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  let parsed: WriteUp;
  try { parsed = JSON.parse(text); } catch { throw new Error("bad_output"); }
  if (!parsed || typeof parsed.overall !== "string" || !Array.isArray(parsed.needs)) throw new Error("bad_output");
  const seen = new Set<string>();
  parsed.needs = parsed.needs.filter((n) =>
    n && (NEED_KEYS as readonly string[]).includes(n.need) && !seen.has(n.need) && seen.add(n.need) &&
    typeof n.talked_about === "string" && typeof n.next_step === "string");
  return parsed;
}

/** Sends one audio clip to OpenAI's transcription endpoint and returns the text. */
export async function transcribe(fetchImpl: typeof fetch, apiKey: string, audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "gpt-transcribe");
  form.append("response_format", "json");
  form.append("language", "en");
  const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`transcribe_failed:${res.status}:${detail.slice(0, 200)}`);
  }
  const j = await res.json() as { text?: unknown };
  return typeof j.text === "string" ? j.text : "";
}
