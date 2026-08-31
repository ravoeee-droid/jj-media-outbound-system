# Systemarchitektur

## Verantwortlichkeiten

- **Next.js auf Vercel:** privates Cockpit, CRM, Imports, personalisierte Kundenseiten, Tracking und API.
- **Neon Postgres:** Leads, Aktivitäten, Pipeline, Kampagnen, Follow-ups, Buchungen und Jobs.
- **Vercel Blob:** speichert das wiederverwendbare Mastervideo.
- **Thum.io Free:** liefert ohne API-Key die echte Website-Aufnahme; die Landingpage animiert sie als Scroll-Sequenz.
- **Google OAuth/Gmail:** Cockpit-Anmeldung und Versand in echten Gmail-Threads.
- **n8n Cloud:** zeitgesteuerte, nachvollziehbare Automationen. Die Workflow-Definitionen liegen versioniert in GitHub.

## Datenfluss

1. CSV oder JSON wird im Cockpit importiert.
2. Der Import normalisiert Feldnamen, gruppiert Jobzeilen pro Unternehmen und dedupliziert nach Domain/Firmenname.
3. Enrichment ergänzt Places- und PageSpeed-Signale.
4. Die kostenlose Website-Vorschau wird ohne API-Key erzeugt und auf der Landingpage animiert.
5. `/v/[slug]` kombiniert Scrollvideo, wiederverwendbares Mastervideo und Kalender.
6. Views, Plays, Watchtime und Buchungen laufen in die CRM-Akte zurück.
7. Gmail sendet Erstkontakt und Follow-ups im gleichen Thread.
8. Vercel Cron oder n8n ruft den geschützten Follow-up Runner auf.

## Sicherheitsgrenzen

- `/dashboard` und alle Cockpit-APIs benötigen Google-Anmeldung.
- `ALLOWED_EMAILS` ist eine explizite Positivliste.
- Nur `/v/[slug]`, Tracking und Buchungsendpunkte sind öffentlich.
- API-Keys liegen ausschließlich in Vercel-, GitHub- oder n8n-Secrets.
- Der n8n Runner ist mit `CRON_SECRET` geschützt.
- Gepostete oder versehentlich veröffentlichte Keys müssen vor dem Produktivstart rotiert werden.
