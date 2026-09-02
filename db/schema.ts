import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt,
  updatedAt,
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] }), index("accounts_user_idx").on(table.userId)],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const authenticators = pgTable(
  "authenticators",
  {
    credentialID: text("credential_id").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.credentialID] })],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("email"),
    status: text("status").notNull().default("draft"),
    audience: text("audience").notNull().default(""),
    dailyLimit: integer("daily_limit").notNull().default(25),
    createdAt,
    updatedAt,
  },
  (table) => [index("campaigns_workspace_idx").on(table.workspaceId)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    slug: text("slug").notNull().unique(),
    company: text("company").notNull(),
    normalizedCompany: text("normalized_company").notNull(),
    contact: text("contact").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    websiteUrl: text("website_url").notNull().default(""),
    domain: text("domain").notNull().default(""),
    city: text("city").notNull().default(""),
    region: text("region").notNull().default(""),
    category: text("category").notNull().default("other"),
    pipelineStage: text("pipeline_stage").notNull().default("new"),
    videoStatus: text("video_status").notNull().default("not_started"),
    watchPercent: integer("watch_percent").notNull().default(0),
    scrollVideoUrl: text("scroll_video_url"),
    landingPath: text("landing_path").notNull(),
    score: integer("score").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    websiteScore: integer("website_score").notNull().default(0),
    salesPriority: integer("sales_priority").notNull().default(0),
    jobCount: integer("job_count").notNull().default(0),
    jobTitles: jsonb("job_titles").$type<string[]>().notNull().default([]),
    source: text("source").notNull().default("manual"),
    sourceRecords: integer("source_records").notNull().default(1),
    ceo: text("ceo").notNull().default(""),
    summary: text("summary").notNull().default(""),
    pitch: text("pitch").notNull().default(""),
    recommendedOffer: text("recommended_offer").notNull().default(""),
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    objection: text("objection").notNull().default(""),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    dealValue: integer("deal_value").notNull().default(0),
    probability: integer("probability").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("leads_workspace_idx").on(table.workspaceId),
    index("leads_pipeline_idx").on(table.workspaceId, table.pipelineStage),
    index("leads_priority_idx").on(table.workspaceId, table.salesPriority),
    index("leads_domain_idx").on(table.workspaceId, table.domain),
    uniqueIndex("leads_workspace_company_unique").on(table.workspaceId, table.normalizedCompany),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("activities_lead_idx").on(table.leadId, table.createdAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    type: text("type").notNull().default("follow_up"),
    createdAt,
    updatedAt,
  },
  (table) => [index("tasks_workspace_due_idx").on(table.workspaceId, table.status, table.dueAt)],
);

export const outreach = pgTable(
  "outreach",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    step: integer("step").notNull().default(1),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    createdAt,
    updatedAt,
  },
  (table) => [index("outreach_due_idx").on(table.workspaceId, table.status, table.scheduledAt)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    value: integer("value"),
    visitorId: text("visitor_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("events_lead_created_idx").on(table.leadId, table.createdAt)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    provider: text("provider").notNull().default("embedded"),
    externalId: text("external_id"),
    status: text("status").notNull().default("requested"),
    createdAt,
  },
  (table) => [index("bookings_lead_idx").on(table.leadId, table.scheduledAt)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    blobUrl: text("blob_url").notNull(),
    pathname: text("pathname").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull().default(0),
    createdAt,
  },
  (table) => [index("assets_workspace_kind_idx").on(table.workspaceId, table.kind, table.createdAt)],
);

export const settings = pgTable(
  "settings",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [index("jobs_queue_idx").on(table.status, table.scheduledAt)],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

// WhatsApp lives in the existing JJ-Media workspace; every query includes workspace_id.
export const whatsappThreads = pgTable("jj_whatsapp_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  mode: text("mode").$type<"manual" | "copilot" | "autopilot">().notNull().default("copilot"),
  consent: text("consent").notNull().default("unknown"),
  consentNote: text("consent_note").notNull().default(""),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  handoffReason: text("handoff_reason").notNull().default(""),
  summary: text("summary").notNull().default(""),
  intent: text("intent").notNull().default(""),
  unread: boolean("unread").notNull().default(false),
  version: integer("version").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastInboundId: uuid("last_inbound_id"),
  offeredSlots: jsonb("offered_slots").$type<import("@/lib/whatsapp/policy").CalendarSlot[]>().notNull().default([]),
  operatorSlots: jsonb("operator_slots").$type<import("@/lib/whatsapp/policy").CalendarSlot[]>().notNull().default([]),
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (t) => [uniqueIndex("jj_wa_phone_unique").on(t.workspaceId, t.phone), uniqueIndex("jj_wa_lead_unique").on(t.workspaceId, t.leadId), index("jj_wa_inbox_idx").on(t.workspaceId, t.lastMessageAt)]);

export const whatsappMessages = pgTable("jj_whatsapp_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => whatsappThreads.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  kind: text("kind").notNull().default("text"),
  status: text("status").notNull().default("draft"),
  body: text("body").notNull().default(""),
  providerId: text("provider_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceId: uuid("source_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (t) => [uniqueIndex("jj_wa_message_key_unique").on(t.workspaceId, t.idempotencyKey), uniqueIndex("jj_wa_provider_unique").on(t.workspaceId, t.providerId), index("jj_wa_history_idx").on(t.workspaceId, t.threadId, t.createdAt)]);

export const whatsappLocks = pgTable("jj_whatsapp_locks", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  token: uuid("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.key] })]);

export const whatsappQueue = pgTable("jj_whatsapp_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => whatsappThreads.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  messageId: uuid("message_id").references(() => whatsappMessages.id),
  error: text("error").notNull().default(""),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (t) => [uniqueIndex("jj_wa_queue_thread_unique").on(t.workspaceId, t.threadId), index("jj_wa_queue_due_idx").on(t.workspaceId, t.status, t.createdAt)]);

export const whatsappReservations = pgTable("jj_whatsapp_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => whatsappThreads.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id").notNull(),
  eventId: text("event_id").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("reserved"),
  joinUrl: text("join_url").notNull().default(""),
  createdAt,
  updatedAt,
}, (t) => [uniqueIndex("jj_wa_reservation_event_unique").on(t.workspaceId, t.eventId), index("jj_wa_reservation_idx").on(t.workspaceId, t.calendarId, t.startAt)]);
