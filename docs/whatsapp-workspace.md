# WhatsApp im JJ-Media-Cockpit

Unter `/admin/dashboard/whatsapp` sind Inbox, Tageslauf, KI-Wissen und Verbindungen zusammengeführt. CRM und Lead-Liste verlinken direkt auf den jeweiligen WhatsApp-Kontakt.

## Im Team einrichten

1. **KI-Wissen & Regeln:** Angebote, Preise, Referenzen und Antwortbeispiele eintragen oder als TXT/Markdown importieren. Jeden Inhalt prüfen und freigeben. Geänderte Inhalte benötigen erneut eine Freigabe. Tonalität, Qualifizierungsfragen und Übergaberegeln festlegen. Der Testchat verwendet diese Einstellungen, verschickt aber keine Nachrichten und bucht keine Termine.
2. **Verbindungen:** WhatsApp-Server anbinden, QR-Code am Smartphone scannen und den Google-Kalender über den vorhandenen OAuth-Zugang freigeben.
3. **Inbox:** Lead auswählen, Telefonnummer überprüfen und Zustimmung mit Zeitpunkt, Quelle und Zweck dokumentieren. Zunächst Copilot nutzen: Entwurf prüfen, bearbeiten und senden. Eine manuelle Nachricht übernimmt die Unterhaltung für das Team.
4. **Autopilot:** In den Regeln und für den jeweiligen Kontakt aktivieren. Die KI beantwortet belegbare Fragen, schlägt tatsächlich freie Zeiten vor und bucht erst nach eindeutiger Auswahl einer zuvor versendeten Option. Individuelle Preise, Beschwerden, Rückrufwünsche, Anhänge und Unsicherheiten gehen an das Team.
5. **Tageslauf:** Geeignete Kontakte mit dokumentierter Zustimmung einzeln freigeben und den Lauf starten. Maximal 30 erste Nachrichten pro lokalem Kalendertag, innerhalb der eingestellten Wochentage und Stunden. Mindestens zwei Minuten Abstand; bei weniger geeigneten Kontakten wird weniger versendet. Antworten stoppen den Erstkontaktauftrag. Ein Lauf erteilt keine Zustimmung im Namen eines Kontakts und ändert dessen Antwortmodus nicht.

Das Wissen wird der KI passend zur Unterhaltung bereitgestellt. Hier werden keine Modellgewichte trainiert. Fehlende Fakten bleiben offen; Mustertexte für Preise und Referenzen sind deshalb anfangs nicht freigegeben.

## Betrieb

Der Next.js-Teil bleibt auf dem vorhandenen Vercel-Projekt. OpenWA braucht einen dauerhaft laufenden Chromium-Prozess und läuft separat. In `services/whatsapp-bridge` liegen ein Node-24-Dienst, Dockerfile und Compose-Datei. Die Integration verwendet die veröffentlichten OpenWA-v4-APIs aus Version 4.76.0. Sie kann über den kleinen HTTP-Vertrag später durch einen anderen WhatsApp-Anbieter ersetzt werden.

### WhatsApp-Server

Auf einem Linux-Server mit Docker und einer HTTPS-Domain:

```sh
cd services/whatsapp-bridge
cp bridge.env.example bridge.env
# Zwei verschiedene Schlüssel erzeugen und in bridge.env eintragen:
openssl rand -hex 32
openssl rand -hex 32
chmod 600 bridge.env
docker compose up -d --build
```

`WHATSAPP_WEBHOOK_URL` ist die vollständige öffentliche Cockpit-Adresse mit `/admin/api/whatsapp/webhook`. Die Domain muss direkt die produktive App erreichen; vorgeschalteter Vercel-Deployment-Schutz darf diesen signierten Webhook nicht abweisen. Der normale Cockpit-Login bleibt geschützt.

Port 3001 bindet nur an localhost. Ein bestehender HTTPS-Reverse-Proxy leitet die Bridge-Domain dorthin weiter. Alle Bridge-Endpunkte benötigen `Authorization: Bearer <WHATSAPP_BRIDGE_KEY>`. QR-Codes und Sitzungsdaten nicht veröffentlichen. Das Docker-Volume `whatsapp-session` erhält die Sitzung und das Versandjournal über Neustarts; regelmäßige geschützte Backups gehören zum Serverbetrieb.

### Vercel-Umgebung

| Variable | Wert |
| --- | --- |
| `WHATSAPP_BRIDGE_URL` | HTTPS-Basisadresse des WhatsApp-Servers ohne abschließenden Slash |
| `WHATSAPP_BRIDGE_KEY` | Derselbe geheime Schlüssel wie auf dem Server, mindestens 32 Zeichen |
| `WHATSAPP_WEBHOOK_SECRET` | Separater gemeinsamer HMAC-Schlüssel, mindestens 32 Zeichen |
| `WHATSAPP_WORKSPACE_ID` | ID des bestehenden JJ-Media-Workspaces, siehe Beispielkonfiguration |
| `WHATSAPP_AI_MODEL` | Optional: verfügbare Modell-ID im Vercel AI Gateway |
| `AI_GATEWAY_API_KEY` | Optional, falls keine AI-Gateway-Freigabe per Vercel OIDC besteht |

Vor Versand und Buchungen müssen `COCKPIT_PASSWORD` (mindestens 12 Zeichen) und `COCKPIT_AUTH_SECRET` (mindestens 32 zufällige Zeichen) gesetzt sein. Der bisherige Standardzugang reicht für diese Aktionen nicht aus. Nach Änderung der Variablen neu deployen und mit dem eigenen Passwort anmelden. Der AI Gateway muss für das Projekt freigeschaltet sein und Kontingent besitzen. Das Modell wird gegen die aktuelle Modellliste geprüft; ein fehlender Zugang oder ein erschöpftes Kontingent erzeugt einen sichtbaren Fehler und keine erfundene Antwort.

Google verwendet die vorhandenen Variablen `AUTH_GOOGLE_ID` und `AUTH_GOOGLE_SECRET`. Die Redirect-URI lautet `https://<Cockpit-Domain>/admin/api/gmail/callback`; `NEXT_PUBLIC_APP_URL` muss dieselbe öffentliche App-Basis enthalten. Zusätzlich zu den vorhandenen Mail-Berechtigungen werden für den Kalender `calendar.events` und `calendar.freebusy` angefragt. Eine erneute ausdrückliche Google-Freigabe ist erforderlich. Terminzeiten, Puffer, Vorlauf und Zeitzone werden im Cockpit gepflegt.

### Datenbank und Verarbeitung

Die Migration `supabase/migrations/20260902015002_jj_whatsapp_sales_workspace.sql` ergänzt fünf Tabellen mit RLS und ohne Zugriffsrechte für `anon` oder `authenticated`. Die produktive Anwendung greift wie bisher über den auf das JJ-Media-Projekt beschränkten Vercel-OIDC-Proxy zu. Dessen versionierter Code liegt unter `supabase/functions/jj-media-db-proxy`; die OIDC-Prüfung bleibt unverändert. Legitimes `UPDATE ... SET` und `ON CONFLICT ... DO UPDATE SET` werden unterstützt.

Der WhatsApp-Server sendet jede Minute einen signierten Tick. Der Tick verarbeitet höchstens eine offene Antwort oder einen freigegebenen Erstkontakt. Es braucht keinen minütlichen Vercel-Cron. In der App werden nur Nachrichten bereits zugeordneter CRM-Nummern gespeichert; Gruppen, Broadcasts und fremde Privatunterhaltungen werden nicht importiert. Ein- und ausgehende Nachrichten besitzen eindeutige IDs. Ausgehende Zustände `sending` oder `unknown` werden niemals blind erneut gesendet.

Bei unklarem Versandstatus in der Inbox **Status prüfen** verwenden und gegebenenfalls direkt in WhatsApp nachsehen. Die Bridge speichert Versand-IDs dauerhaft. Erledigte Webhooks behalten 30 Tage nur ihre IDs; zugestellter Nachrichtentext wird aus dem lokalen Webhook-Journal entfernt. Fehlgeschlagene Webhooks bleiben bis zur Fehlerbehebung in der Warteschlange. Ein Stop oder eine menschliche Übernahme invalidiert laufende KI-Entwürfe. Bereits an WhatsApp übergebene Nachrichten können technisch nicht zurückgehalten werden.

Kalenderbuchungen verwenden einen deterministischen Google-Event-Identifier und eine Sperre je Kalender. Vor der Buchung werden Verfügbarkeit und aktuelle Einstellungen erneut geprüft. Ein vom Kalender nicht eindeutig bestätigter Vorgang wird zur persönlichen Prüfung übergeben. Externe Änderungen im Google-Kalender bleiben möglich; die KI erhält kein Recht, bestehende Termine zu verschieben oder zu löschen. Bei eingehenden Anhängen wird zur persönlichen Bearbeitung übergeben; automatische Audiotranskription ist nicht Teil dieser Version.

## Verifikation

```sh
npm run test:whatsapp
npm run typecheck
npm run build
```

Die Tests verwenden keine Kundennummern, WhatsApp-Sitzungen, KI-Kontingente oder echten Kalendertermine. Sie prüfen unter anderem doppelte Aufrufe, unklare Sendebestätigungen, Neustarts, manipulierte Webhooks, Wissensfreigaben und mehrdeutige Terminauswahl. Ein vollständiger Integrationstest mit einer eigenen freigegebenen Testnummer und einem Testkalender folgt erst nach Einrichtung der Verbindungen.
