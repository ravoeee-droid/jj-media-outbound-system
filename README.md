# JJ-Media Social Audit Engine

Outbound-Cockpit für personalisierte Social-Media-Analysen: Instagram-Lead-Import, Profil-Screenshot, Fake-Loom-Sequenz mit Mastervideo, persönliche Landingpage, CRM, Gmail-Follow-ups, Tracking und Kalender.

## Kernfunktionen

- Instagram-Profil per URL oder `@handle` als Lead anlegen/importieren
- automatische Aufnahme des öffentlichen Instagram-Profils beim bewussten Video-Start
- manueller Profil-Screenshot pro Lead als zuverlässiger Fallback bei Instagram-Login-Walls
- Fake-Loom-Video aus Instagram-Profil, JJ-Media-Mastervideo und optionalen Proof-Clips
- persönliche Social-Media-Analyse unter `/v/[slug]`
- CRM, Gmail-Vorlagen, Follow-ups, Watchtime, Kalender und Buchungen
- Neon/Postgres, Drizzle, Vercel Blob und Vercel Cron

## Deployment auf Vercel

1. Repository in Vercel importieren.
2. **Neon Postgres** und **Vercel Blob** mit dem Projekt verbinden.
3. Werte aus `.env.example` als Environment Variables hinterlegen.
4. Für Gmail in Google Cloud die Gmail API aktivieren und als Redirect-URL eintragen:

   `https://DEINE-DOMAIN/api/auth/callback/google`

5. `ALLOWED_EMAILS` auf die JJ-Media-E-Mail-Adresse begrenzen.
6. Deployen. `vercel-build` führt die Drizzle-Migration vor dem Next.js-Build aus.

Lokal:

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

## Instagram-Screenshots

Das System versucht zuerst, das öffentliche Profil automatisch aufzunehmen. Da Instagram automatisierte Browser gelegentlich mit einer Login-Wall blockiert, kann in der Lead-Tabelle über **IG-Screenshot** ein echter PNG-, JPG- oder WebP-Screenshot hochgeladen werden. Dieser hat bei der Videogenerierung Vorrang.

## Qualitätsprüfung

```bash
npm run typecheck
npm run lint
npm run build
```

## Recht und Zustellbarkeit

Vor dem Produktivversand müssen Rechtsgrundlage, Impressum/Datenschutz, Opt-out, Suppression-Liste, Versandvolumen und Domain-Reputation für den jeweiligen Markt sauber eingerichtet werden.
