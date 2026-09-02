import { z } from "zod";

export const modeSchema = z.enum(["manual", "copilot", "autopilot"]);
export const knowledgeSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  category: z.enum(["company", "offer", "price", "reference", "faq", "objection", "process"]),
  content: z.string().trim().min(1).max(8_000),
  source: z.string().trim().max(500).default(""),
  approved: z.boolean().default(false),
});

export const agentConfigSchema = z.object({
  version: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(false),
  defaultMode: modeSchema.default("copilot"),
  name: z.string().trim().min(1).max(80).default("JJ-Media Assistent"),
  handoffName: z.string().trim().min(1).max(80).default("Jessica"),
  tone: z.string().trim().max(2_000).default("Freundlich, persönlich, klar. Siezen, bis der Kontakt das Du anbietet. Kurze WhatsApp-Nachrichten, höchstens eine Frage auf einmal. Kein Verkaufsdruck."),
  instructions: z.string().trim().max(8_000).default("Bedarf und Ziel des Unternehmens verstehen. Konkrete Fragen mit freigegebenem Wissen beantworten. Bei Interesse ein 15-minütiges Potenzialgespräch anbieten. Social-Media-Analysen zuerst mit Jessica abstimmen; keine unfertigen Analysen versenden."),
  qualification: z.string().trim().max(3_000).default("Was möchten Sie über Social Media erreichen?\nWelche Kanäle nutzen Sie bisher?\nWo benötigen Sie am meisten Unterstützung?"),
  handoffRules: z.string().trim().max(3_000).default("Preisverhandlungen, individuelle Angebote, Beschwerden, Vertragsfragen, unklare Aussagen, Rückrufwünsche oder der Wunsch nach einem Menschen: an Jessica übergeben."),
  allowBooking: z.boolean().default(false),
  calendarId: z.string().trim().min(1).max(320).default("primary"),
  timezone: z.string().refine((v) => { try { new Intl.DateTimeFormat("de-DE", { timeZone: v }); return true; } catch { return false; } }, "Ungültige Zeitzone.").default("Europe/Berlin"),
  durationMinutes: z.number().int().min(15).max(60).multipleOf(15).default(15),
  startHour: z.number().int().min(0).max(22).default(9),
  endHour: z.number().int().min(1).max(23).default(17),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  noticeHours: z.number().int().min(1).max(168).default(3),
  bufferMinutes: z.number().int().min(0).max(60).default(15),
  maxAutoReplies: z.number().int().min(1).max(30).default(8),
  dailyOutreachEnabled: z.boolean().default(false),
  dailyOutreachLimit: z.number().int().min(1).max(30).default(30),
  outreachStartHour: z.number().int().min(0).max(22).default(9),
  outreachEndHour: z.number().int().min(1).max(23).default(17),
  outreachInstructions: z.string().trim().max(3_000).default("An die dokumentierte WhatsApp-Zustimmung anknüpfen. Eine konkrete, belegte Beobachtung aus den Lead-Daten aufgreifen. Kurz erklären, wie JJ-Media helfen kann, und eine offene Frage stellen. Keine unbewiesenen Ergebnisse, keine Behauptung über ein bereits erstelltes Video."),
  knowledge: z.array(knowledgeSchema).max(60).default([]),
}).refine((c) => c.endHour > c.startHour, "Das Ende der Terminzeiten muss nach dem Beginn liegen.")
  .refine((c) => c.outreachEndHour > c.outreachStartHour, "Das Versandfenster muss nach seinem Beginn enden.")
  .refine((c) => c.knowledge.reduce((n, k) => n + k.content.length, 0) <= 90_000, "Die Wissensbasis ist zu umfangreich. Bitte kürzen oder aufteilen.")
  .refine((c) => new Set(c.knowledge.map((k) => k.id)).size === c.knowledge.length, "Wissenseinträge müssen eindeutige IDs haben.");

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentMode = z.infer<typeof modeSchema>;
export type KnowledgeEntry = z.infer<typeof knowledgeSchema>;
export type CalendarSlot = { id: string; start: string; end: string; label: string; expiresAt: string; configVersion: number; calendarId: string };

export const DEFAULT_AGENT = agentConfigSchema.parse({
  knowledge: [
    { id: "jj-company", title: "JJ-Media & Ansprechpartnerin", category: "company", content: "JJ-Media unterstützt Unternehmen mit Social-Media-Strategie, Content Creation, Reels und Social Ads. Ansprechpartnerin ist Jessica Just.", source: "Bestehendes JJ-Media-Projekt", approved: true },
    { id: "jj-process", title: "Persönliche Analyse & Potenzialgespräch", category: "process", content: "JJ-Media bereitet individuelle Social-Media-Analysen vor. Jessica prüft und erläutert die Ergebnisse. Ein Potenzialgespräch dauert 15 Minuten. Eine Analyse oder ein Video darf nur verschickt werden, wenn es für den Kontakt fertiggestellt und ausdrücklich zum Versand ausgewählt ist.", source: "JJ-Media Social Audit Engine", approved: true },
    { id: "jj-offer", title: "Leistungsumfang bestätigen", category: "offer", content: "Bitte hier den aktuellen, verbindlichen Leistungsumfang eintragen: Kanäle, Content-Menge, Drehtage, Betreuung und enthaltene Leistungen.", source: "Noch auszufüllen", approved: false },
    { id: "jj-prices", title: "Preise & Laufzeiten ergänzen", category: "price", content: "Bitte freigegebene Paketpreise, Einrichtungsgebühren, Laufzeiten und Kündigungsregeln eintragen. Bis dahin nennt die KI keine Preise.", source: "Noch auszufüllen", approved: false },
    { id: "jj-proof", title: "Referenzen freigeben", category: "reference", content: "Bitte nur belegbare und zur Verwendung freigegebene Kundenreferenzen mit Quelle, Leistung und tatsächlich erzieltem Ergebnis eintragen.", source: "Noch auszufüllen", approved: false },
  ],
});

export function normalizePhone(value: string): string | null {
  let input = value.trim().replace(/[\s()./-]/g, "");
  if (input.includes("@")) input = input.replace(/@c\.us$/, "");
  if (input.startsWith("00")) input = input.slice(2);
  else if (input.startsWith("+")) input = input.slice(1);
  else if (input.startsWith("0")) input = `49${input.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(input) ? input : null;
}

export function isOptOut(text: string) {
  return /\b(stop|stopp|unsubscribe|abmelden|abbestellen|opt[ -]?out)\b/i.test(text)
    || /(?:nicht|keine?|nie).{0,40}(?:kontaktieren|anschreiben|nachrichten|werbung|mehr schreiben)/i.test(text)
    || /(?:lassen sie mich in ruhe|löschen sie meine (?:nummer|daten)|loeschen sie meine)/i.test(text)
    || /(?:schreib\w*|kontaktier\w*).{0,45}(?:nicht mehr|nie wieder)/i.test(text)
    || /(?:kein(?:e|en)? interesse|kein bedarf)/i.test(text);
}

export function requiresHuman(text: string) {
  return /\b(rabatt|nachlass|verhandeln|beschwerde|anwalt|vertrag|kündig|garantie|versprechen|zu teuer|rückruf|zurückrufen)\b/i.test(text)
    || /(?:menschen|menschlich|persönlich sprechen|jessica sprechen|rufen sie mich|ruf mich)/i.test(text);
}

export function isSuppressed(tags: string[]) {
  return tags.some((t) => ["opt-out", "do-not-contact", "gesperrt"].includes(t.toLowerCase()));
}

// Only an unambiguous choice of a previously offered time authorizes a booking.
export function chosenSlot(text: string, slots: CalendarSlot[], now = Date.now(), timezone = "Europe/Berlin"): CalendarSlot | null {
  const clean = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (!clean || /[?]|\b(nicht|kein|vielleicht|könnte|falls|oder|statt|nein)\b/.test(clean)) return null;
  const current = slots.filter((s) => Date.parse(s.expiresAt) > now && Date.parse(s.start) > now);
  const choice = clean.match(/^(?:(?:termin|option|nummer)\s*)?([1-3])(?:\s*(?:bitte|passt|nehmen wir|ist gut))?$/);
  if (choice) {
    const selected = slots[Number(choice[1]) - 1];
    return selected && current.some((slot) => slot.id === selected.id) ? selected : null;
  }
  if (!/\b(passt|nehmen|buche|buchen|gerne|bestätig|bestatig|ja|perfekt|bitte)\b/.test(clean)) return null;
  const matched = current.filter((slot) => {
    const time = slot.label.match(/(\d{2}):(\d{2})/);
    if (!time) return false;
    const hour = Number(time[1]);
    const pattern = new RegExp(`(?:^|\\D)0?${hour}(?::${time[2]}|\\.${time[2]}${time[2] === "00" ? "|\\s*uhr" : ""})(?:\\D|$)`);
    return pattern.test(clean);
  });
  if (matched.length !== 1) return null;
  const selected = matched[0];
  const dateParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((p) => [p.type, p.value]));
  const selectedDate = dateParts(new Date(selected.start));
  const today = dateParts(new Date(now));
  if (/(?:^|\s)(heute|morgen|übermorgen)(?:\s|$)/u.test(clean)) {
    const offset = /übermorgen/.test(clean) ? 2 : /morgen/.test(clean) ? 1 : 0;
    const expected = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + offset)).toISOString().slice(0, 10);
    if (`${selectedDate.year}-${selectedDate.month}-${selectedDate.day}` !== expected) return null;
  }
  const weekday = clean.match(/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/)?.[1];
  if (weekday && new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "long" }).format(new Date(selected.start)).toLowerCase() !== weekday) return null;
  if (/nächste|naechste|übernächste|woche/.test(clean)) return null;
  const explicitDate = clean.match(/\b(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[012])\.(?:(\d{4})\b)?/);
  if (explicitDate && (Number(explicitDate[1]) !== Number(selectedDate.day) || Number(explicitDate[2]) !== Number(selectedDate.month) || explicitDate[3] && explicitDate[3] !== selectedDate.year)) return null;
  return selected;
}

export function effectiveMode(global: AgentConfig, threadMode: AgentMode): AgentMode {
  if (!global.enabled || global.defaultMode === "manual" || threadMode === "manual") return "manual";
  if (global.defaultMode !== "autopilot" || threadMode !== "autopilot") return "copilot";
  return "autopilot";
}

export function selectKnowledge(entries: KnowledgeEntry[], query: string): KnowledgeEntry[] {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\d]{3,}/gu) || [])];
  const scored = entries.filter((e) => e.approved).map((entry, index) => ({ entry, index, score: words.reduce((sum, word) => sum + (`${entry.title} ${entry.content}`.toLowerCase().includes(word) ? 1 : 0), 0) + (["company", "process"].includes(entry.category) ? 2 : 0) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  let length = 0;
  return scored.filter(({ entry }) => { length += entry.content.length; return length <= 22_000; }).slice(0, 12).map(({ entry }) => entry);
}

type Decision = { reply: string; intent: string; confidence: number; handoff: boolean; reason: string; knowledgeIds: string[] };
export function guardDecision<T extends Decision>(input: T, latest: string, knowledge: KnowledgeEntry[], outreach = false): T {
  const decision = { ...input };
  const approved = knowledge.filter((entry) => entry.approved);
  const knownIds = new Set(approved.map((entry) => entry.id));
  if (decision.knowledgeIds.some((id) => !knownIds.has(id))) {
    decision.handoff = true; decision.reason = "Der Entwurf enthält nicht belegte Wissensquellen.";
  }
  if (!outreach && (isOptOut(latest) || requiresHuman(latest))) {
    decision.handoff = true; decision.reason = "Der Kontakt benötigt eine persönliche Bearbeitung.";
  }
  if (decision.intent === "handoff" || decision.intent === "price" && !approved.some((entry) => entry.category === "price")) {
    decision.handoff = true; decision.reason ||= "Für diese Antwort ist eine persönliche Prüfung nötig.";
  }
  if (decision.confidence < 0.84 || !decision.reply.trim() || /(?:[€$]|\b(?:EUR|Euro)\b)/i.test(decision.reply) && !approved.some((entry) => entry.category === "price") || ["price", "question"].includes(decision.intent) && !decision.knowledgeIds.length) {
    decision.handoff = true; decision.reason ||= "Der Entwurf benötigt eine Prüfung durch das Team.";
  }
  if (/(?:termin|gespräch).{0,45}(?:gebucht|bestätigt|eingetragen)|(?:habe|haben).{0,30}(?:gebucht|eingetragen)|(?:gebucht|bestätigt|eingetragen).{0,35}(?:termin|gespräch)/i.test(decision.reply)) {
    decision.handoff = true; decision.reply = "Ich gebe Ihren Terminwunsch an unser Team weiter.";
    decision.reason = "Eine Buchung muss zuerst vom Kalender bestätigt werden.";
  }
  return decision;
}
