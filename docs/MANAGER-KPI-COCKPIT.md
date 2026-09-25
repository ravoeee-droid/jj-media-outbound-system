# Meilenstein 11 – Manager-/KPI-Cockpit

Das Command Center ist die tägliche Steuerungsseite für Jessica und das Vertriebsteam.

## Ziel

Auf einer Seite beantworten:

- Haben die Mitarbeiter genug Call-Leads?
- Wie viele Calls wurden gemacht?
- Wie viele echte Gespräche entstanden?
- Wie viele Kontakte wollten Infos oder WhatsApp?
- Wie viele Infos / WhatsApps wurden tatsächlich versendet?
- Wie viele Termine wurden gebucht?
- Wo liegen überfällige Aufgaben?
- Reicht der Call-ready Vorrat?
- Gibt es technische Fehler?

## Zeiträume

Standard: **Heute**

Zusätzlich:
- 7 Tage
- 30 Tage

Die Zeitgrenzen orientieren sich an `Europe/Berlin`.

Das Cockpit aktualisiert sich automatisch alle 60 Sekunden. Ein manueller Refresh bleibt verfügbar.

## Team-Sicht

Benutzer mit:
- `view_all_leads`
- und `view_kpis`

sehen das gesamte aktive Team.

Andere eingeloggte Benutzer sehen ausschließlich ihre eigenen Kennzahlen.

## Mitarbeiter-KPIs

Pro Mitarbeiter:

- Queue-Bestand
- fällige Rückrufe
- High-Priority Calls
- Calls
- nicht erreicht
- Gespräche
- Kontaktquote
- Info gewünscht
- Info-Mail tatsächlich gesendet
- WhatsApp gewünscht
- WhatsApp-Nachrichten tatsächlich gesendet
- Termine
- Gespräch → Termin Conversion
- offene Aufgaben
- überfällige Aufgaben
- Kalender verbunden / offen

## Attribution

KPIs werden dem aktuellen **Lead-Owner** zugerechnet.

Das ist bewusst konsistent über:
- Call-Outcomes
- Info-Mails
- WhatsApp
- Termine

Dadurch bleibt eine Mitarbeiterzeile vergleichbar, auch wenn ein Admin stellvertretend eine Aktion ausführt.

## Call-Definition

Als Call-Ergebnis zählen die strukturierten Queue-/CRM-Aktivitäten:

- `call_no_answer`
- `call_info_requested`
- `call_whatsapp_requested`
- `callback_scheduled`
- `meeting_scheduled`
- `calendar`
- `no_interest`

Als erreicht gelten alle davon außer `call_no_answer`.

## Versand-KPIs

**Info gesendet** basiert nicht auf einem Klick, sondern auf tatsächlich als `sent` markiertem Outreach Step 1.

**WhatsApp gesendet** basiert auf tatsächlich gesendeten Outbound-Nachrichten im WhatsApp-System.

Dadurch werden Absicht und tatsächlicher Versand getrennt dargestellt.

## Termine

Termine werden aus der Booking-Tabelle gezählt und dem Lead-Owner zugerechnet.

Gezählt werden:
- requested
- confirmed

## Handlungsbedarf

Das System erzeugt konkrete Warnungen, zum Beispiel:

- Mitarbeiter-Queue fast leer
- Queue liegt bei aktiviertem Auto-Nachschub deutlich unter Ziel
- überfällige Aufgaben
- Call-ready Vorrat wird knapp
- technische Job-/Mail-/WhatsApp-Fehler der letzten 24 Stunden

Wenn nichts auffällig ist, erscheint explizit:
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

Serverseitig werden nur die für KPIs benötigten Felder gelesen und aggregiert.

Für die zeitbasierte Activity-Auswertung existiert zusätzlich:

`activities_workspace_created_idx (workspace_id, created_at)`

Der Index ist in Migration `0005_manager_dashboard.sql` dokumentiert und in der Produktionsdatenbank bereits vorhanden.

## UX

Die Startseite `/dashboard` ist jetzt das Manager-Cockpit.

Oben:
- Zeitraum
- Live-Status
- sechs Kernmetriken

Mitte:
- Handlungsbedarf
- Nachschub & Technik

Darunter:
- Mitarbeiter-Tabelle

Abschluss:
- kompakter Funnel Calls → Gespräche → Info/WhatsApp → Termine
