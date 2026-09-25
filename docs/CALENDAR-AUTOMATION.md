# Meilenstein 9 – Google Kalender & Termin-Automation

M9 ersetzt die manuelle Terminsuche im Call durch echte Kalenderverfügbarkeit und Google-Meet-Buchungen.

## Zielablauf

1. Mitarbeiter klickt im Call auf **Termin**.
2. Das System verwendet den Google-Kalender des Lead-Owners.
3. Nur echte freie Slots werden angezeigt.
4. Ein Slot wird ausgewählt und nochmals bestätigt.
5. Direkt vor der Buchung wird die Verfügbarkeit erneut geprüft.
6. Google Calendar erstellt den Termin und einen Google-Meet-Link.
7. Wenn der Lead eine gültige E-Mail hat, wird er als Teilnehmer eingeladen.
8. CRM, Booking-Historie, Pipeline und Aktivität werden aktualisiert.
9. Offene Rückruf-/Info-/WhatsApp-Aufgaben und ausstehende E-Mail-Follow-ups werden beendet.
10. Die Tages-Queue springt zum nächsten Lead.

## Persönliche Kalender

Google OAuth-Tokens werden bereits pro `userId` gespeichert. Deshalb besitzt jeder Mitarbeiter seinen eigenen Kalenderzugang.

Für einen Lead gilt:
- ist ein Owner gesetzt, wird dessen Kalender verwendet;
- ist der Lead unzugeordnet, wird der Kalender des handelnden Benutzers verwendet.

Jessica/Admin kann die Queue eines Mitarbeiters öffnen und einen Termin in **dessen** verbundenem Kalender buchen. Im Audit-Log bleibt trotzdem erhalten, welcher Benutzer die Buchung tatsächlich ausgelöst hat.

## Kalenderprofil

Pro Mitarbeiter wird ohne neue Tabelle ein JSON-Profil in `settings` gespeichert:

`calendar_profile:<userId>`

Einstellungen:
- Kalender-ID, standardmäßig `primary`
- Zeitzone
- Gesprächsdauer
- Mindestvorlauf
- Arbeitsbeginn / Arbeitsende
- Puffer vor und nach Terminen
- Arbeitstage

Standard:
- Europe/Berlin
- 30 Minuten
- 2 Stunden Vorlauf
- 09:00–18:00
- 15 Minuten Puffer
- Montag–Freitag

## Slot-Auswahl

Der Slot-Service:
- prüft Google FreeBusy für bis zu 14 Tage,
- arbeitet in 15-Minuten-Schritten,
- berücksichtigt Dauer und Puffer,
- zeigt maximal 9 Vorschläge,
- maximal 3 sinnvolle Vorschläge je Tag,
- hält Vorschläge am selben Tag mindestens 90 Minuten auseinander.

Dadurch bekommt der Caller eine kleine, gut lesbare Auswahl statt einer langen Terminliste.

## Buchungssicherheit

Vor dem Insert wird der gewählte Slot erneut gegen Google FreeBusy geprüft.

Buchungen sind zusätzlich geschützt durch:
- Workspace-Lease pro Mitarbeiter + Kalender,
- deterministische Google-Event-ID,
- 409-/Idempotenz-Behandlung,
- erneutes Abrufen eines bereits existierenden Events,
- Meet-Link gilt erst als bestätigt, wenn Google ihn tatsächlich liefert.

Wenn Google den Termin anlegt, der Meet-Link aber noch nicht bereit ist, wird **kein zweiter Termin** erzeugt. Ein erneuter Versuch liest dasselbe Event.

## Google Event

Das Event enthält:
- Unternehmen
- Ansprechpartner
- Telefon
- E-Mail
- Website
- Lead-Kontext
- Google Meet
- 60-Minuten E-Mail-Erinnerung
- 10-Minuten Popup-Erinnerung

Bei gültiger Lead-E-Mail:
- Lead wird als Attendee eingetragen
- Google verschickt die Kalendereinladung über `sendUpdates=all`

Ohne Lead-E-Mail:
- Termin wird trotzdem gebucht
- UI zeigt den Meet-Link zum manuellen Kopieren

## CRM-Status nach bestätigter Buchung

- `pipelineStage = call_booked`
- `callStatus = completed`
- `nextAction = meeting`
- `nextActionAt = Terminzeit`
- Wahrscheinlichkeit mindestens 60
- Aktivität `Google-Meet-Termin gebucht`
- Booking mit Provider `google_calendar`

Zusätzlich werden erledigt:
- offene Callback-Tasks
- offene `send_info`-Tasks
- offene `whatsapp_followup`-Tasks
- geplante E-Mail-Follow-ups

## Manuelles Fallback

Automatisierung ersetzt die manuelle Funktion nicht.

Sowohl Tages-Queue als auch Lead-Akte bieten weiterhin **Zeit manuell eintragen**. Dieser Fallback dokumentiert den Termin im CRM, erstellt aber bewusst kein Google-Event.

## Google Verbindung

Benötigte OAuth-Scopes:
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.freebusy`

Der E-Mail-Versand bleibt vollständig bei STRATO; die Google-Verbindung ist nur für Kalenderfunktionen.

OAuth-Rückwege:
- Verbindung aus Tages-Queue → zurück zur Tages-Queue
- Verbindung aus Integrationen → zurück zu Integrationen
- bestehender WhatsApp-Kalender-Connect bleibt unverändert nutzbar

## Team-Kontrolle

Unter Team zeigt jeder Mitarbeiter:
- **Kalender verbunden**
- oder **Kalender offen**

Damit erkennt Jessica vor der Arbeit, bei wem die Termin-Automation einsatzbereit ist.

## Bestehender WhatsApp-Agent

Der WhatsApp-Agent behält seine bestehende, strengere Terminlogik mit Consent-, Thread-Version- und Autopilot-Prüfungen. Die menschliche Queue/CRM-Buchung verwendet den neuen allgemeinen Meeting-Service. Beide greifen auf dieselben persönlichen Google-Konten und Calendar-Scopes zu.
