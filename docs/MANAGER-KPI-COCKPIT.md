# Meilenstein 11 – Manager-/KPI-Cockpit

Das Command Center ist die tägliche Steuerungsseite für Jessica und das Vertriebsteam.

## Ziel

Auf einer Seite beantworten:

- Haben die Caller genug Call-Leads?
- Wie viele Calls wurden tatsächlich gestartet?
- Wie viele abgeschlossene Call-Ergebnisse gab es?
- Wie viele echte Gespräche entstanden?
- Wie viele Kontakte wollten Infos oder WhatsApp?
- Wie viele eindeutige Leads wurden tatsächlich per Info-Mail / WhatsApp erreicht?
- Wie viele Termine wurden insgesamt gebucht?
- Wie viele Termine wurden direkt aus einem Call gebucht?
- Wo liegen überfällige Aufgaben?
- Reicht der Call-ready Vorrat?
- Laufen Research und Auto-Nachschub aktuell?
- Gibt es technische Fehler?

## Zeiträume

Standard: **Heute**

Zusätzlich:
- 7 Tage
- 30 Tage

Die Zeitgrenzen orientieren sich an `Europe/Berlin`. Die Berechnung verwendet den Offset am lokalen Tagesanfang und bleibt dadurch auch an deutschen DST-Wechseltagen korrekt.

Das Cockpit aktualisiert sich automatisch alle 60 Sekunden. Ein manueller Refresh bleibt verfügbar.

## Team-Sicht

Benutzer mit:
- `view_all_leads`
- und `view_kpis`

sehen das gesamte aktive Team.

Andere eingeloggte Benutzer sehen ausschließlich ihre eigenen Mitarbeiter-Kennzahlen.

## Standardisiertes Call-Tracking

M11 zählt Calls nicht mehr indirekt über unterschiedliche Workflow-Aktivitäten.

Ein Call aus der Tages-Queue erzeugt:

1. `call_started`
2. genau ein `call_result`

Mögliche Result-Werte:
- `no_answer`
- `info_requested`
- `whatsapp_requested`
- `callback`
- `meeting`
- `no_interest`

Damit zählen beispielsweise:
- ein Google-Calendar-Event,
- ein späterer CRM-Termin,
- ein Callback-Task,
- oder ein Seiten-Reload

nicht versehentlich als zusätzlicher Call.

### Call-Session-Schutz

Ein offener `call_started` wird bis zu vier Stunden als dieselbe Call-Session erkannt, solange noch kein Result dazu existiert.

Dadurch:
- zählt ein längeres Gespräch nicht doppelt,
- ein doppelter Klick erzeugt keinen zweiten Call,
- das Ergebnis kann bei einem Tracking-Aussetzer den fehlenden Start sicher nachziehen.

Nach einem `call_result` darf beim nächsten echten Anruf wieder eine neue Session entstehen.

## Stale-Queue-Schutz

Beim Klick auf „Jetzt anrufen“ prüft der Server nochmals, ob der Lead noch in der aktuellen Queue liegt.

Wenn der Lead inzwischen:
- neu zugewiesen,
- verarbeitet,
- gesperrt,
- oder aus der Queue entfernt wurde,

wird der Telefon-Intent bei einem 409/403/404 nicht geöffnet.

Ein reiner Tracking-/Netzwerkfehler blockiert den echten Anruf dagegen nicht.

## Mitarbeiter-KPIs

Pro Mitarbeiter:

- Queue-Bestand
- fällige Rückrufe
- High-Priority Calls
- Calls gestartet
- Calls mit Ergebnis
- Calls noch ohne Ergebnis
- nicht erreicht
- Gespräche
- Kontaktquote
- Info gewünscht
- eindeutige Leads mit Info-Mail gesendet
- WhatsApp gewünscht
- eindeutige Leads mit WhatsApp erreicht
- Termine insgesamt
- Termine direkt im Call
- direkte Call-Conversion
- offene Aufgaben
- überfällige Aufgaben
- Kalender verbunden / offen

## Attribution

Die KPI-Zeile trennt bewusst **Arbeitsleistung** und **Lead-Verantwortung**.

### Tatsächlicher Bearbeiter

Diese Werte werden dem Benutzer zugerechnet, der den Call wirklich bearbeitet hat:
- Call gestartet
- Call-Ergebnis
- Gespräch
- Info gewünscht
- WhatsApp gewünscht
- direkt im Call gebuchter Termin

Dafür wird `activities.user_id` verwendet.

Falls eine alte/technische Activity ausnahmsweise keinen User besitzt, fällt die Attribution auf den Lead-Owner zurück.

### Lead-Owner

Diese Werte werden dem aktuellen Lead-Owner zugerechnet:
- Queue
- tatsächlich versendete Info-Mail
- tatsächlich gesendeter WhatsApp-Kontakt
- Termine insgesamt
- Aufgaben

Damit bleibt sichtbar, wem die Pipeline gehört, auch wenn ein Admin einmal stellvertretend arbeitet.

Im UI steht diese Trennung direkt oberhalb der Mitarbeiter-Tabelle.

## Kontaktquote

Die Kontaktquote verwendet ausschließlich **Calls mit erfasstem Ergebnis** als Nenner.

Beispiel:
- 20 gestartete Calls
- 19 Ergebnisse
- 1 Call läuft noch
- 8 Gespräche

Kontaktquote = `8 / 19`, nicht `8 / 20`.

Dadurch verfälscht ein aktuell laufendes Gespräch die Live-Quote nicht.

## Direkte Call-Conversion

`Gespräch → Termin` basiert ausschließlich auf `call_result = meeting`.

Damit erhöhen:
- später gebuchte Landingpage-Termine,
- CRM-Termine ohne Call,
- oder andere Booking-Quellen

nicht künstlich die direkte Vertriebsquote.

**Termine insgesamt** werden trotzdem separat aus der Booking-Tabelle dargestellt.

## Versand-KPIs

### Info gesendet

Basiert auf tatsächlich als `sent` markiertem Outreach Step 1.

Mehrere technische Einträge / Wiederholungen für denselben Lead im selben Zeitraum werden als **ein erreichter Lead** gezählt.

### WhatsApp gesendet

Basiert auf tatsächlich gesendeten Outbound-Nachrichten.

Mehrere WhatsApp-Nachrichten an denselben Lead werden im Manager-KPI als **ein WhatsApp-Kontakt** gezählt.

Das Nachrichtenvolumen wird dadurch nicht mit erreichten Kontakten verwechselt.

## Call-Rollen

Queue-Mangel wird nur bei tatsächlichen Call-Rollen bewertet:
- Owner
- Admin
- Vertrieb
- Setter

Recherche- oder Viewer-Konten erscheinen nicht rot, nur weil sie keine Tages-Queue besitzen.

## Handlungsbedarf

Das System erzeugt konkrete Warnungen:

- Mitarbeiter-Queue fast leer
- Queue liegt bei aktiviertem Auto-Nachschub deutlich unter Ziel
- überfällige Aufgaben
- Caller ohne verbundenen Google Kalender
- Call-ready Vorrat wird knapp
- Lead Scout aktiv, aber letzter erfolgreicher Lauf älter als 30 Stunden
- Auto-Nachschub aktiv, aber letzter erfolgreicher Lauf älter als 30 Stunden
- technische Job-/Mail-/WhatsApp-Fehler der letzten 24 Stunden

Wenn nichts auffällig ist:
**Keine akuten Blocker erkannt.**

## Systemstatus

Der Manager sieht kompakt:

- Lead Scout automatisch aktiv / pausiert
- letzter Research-Lauf
- Auto-Nachschub aktiv / pausiert
- Anzahl ausgewählter Caller
- Queue-Ziel
- letzter Supply-Lauf
- Call-ready Vorrat
- fehlgeschlagene Jobs
- fehlgeschlagene E-Mails
- fehlgeschlagene WhatsApp-Jobs

## Performance

Das Dashboard lädt keine vollständigen Lead-Datensätze in den Browser.

Serverseitig:
- Activity-, Outreach-, Booking- und WhatsApp-Abfragen joinen den Lead-Owner direkt.
- Es gibt keinen Vollscan aller Lead-IDs nur für Owner-Mapping.
- Queue-Zahlen aller sichtbaren Mitarbeiter werden in **einer gruppierten DB-Abfrage** geladen.
- Es gibt keine 2 Queue-Abfragen pro Mitarbeiter.
- Info-/WhatsApp-Kontakte werden im Arbeitsspeicher auf eindeutige Leads dedupliziert.

Index:
`activities_workspace_created_idx (workspace_id, created_at)`

Der Index ist in Migration `0005_manager_dashboard.sql` dokumentiert und in Produktion vorhanden.

## UX

Startseite: `/dashboard`

Oben:
- Heute / 7 Tage / 30 Tage
- Live-Refresh
- sechs Kernmetriken

Mitte:
- Handlungsbedarf
- Nachschub & Technik

Darunter:
- Mitarbeiter-Tabelle
- Attributionserklärung

Abschluss:
- kompakter Call-Funnel:
  `Calls → Gespräche → Info/WhatsApp → direkt gebuchte Termine`
