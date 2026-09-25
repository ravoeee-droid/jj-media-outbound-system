# Lead Workspace / Meilenstein 4

Die Lead-Akte ist die zentrale manuelle Arbeitsfläche. Mitarbeiter müssen für Standardaktionen nicht zwischen CRM, WhatsApp, Video und E-Mail-Modulen wechseln.

## Schnellaktionen

Je nach Rolle/Rechten und vorhandenen Lead-Daten stehen direkt in der Akte zur Verfügung:

- Anrufen über `tel:`
- WhatsApp-Thread öffnen
- Enrichment starten
- Lead validieren
- Readiness analysieren
- Instagram-Screenshot erstellen
- persönliches Video rendern
- Info-Mail vorbereiten, kopieren, manuell bestätigen oder direkt senden
- Rückruf einplanen
- manuellen Termin eintragen
- Lead als "Kein Interesse" schließen

Buttons werden deaktiviert, wenn eine notwendige Voraussetzung fehlt, z. B. Telefonnummer, E-Mail oder Instagram-Profil.

## Gemeinsame Workflow-Logik

`lib/lead-workflow.ts` kapselt die manuellen Kernschritte:

- `validateLead`
- `analyzeLead`
- `scheduleCallback`
- `scheduleManualMeeting`
- `markNoInterest`

Spätere Automationen sollen diese Funktionen wiederverwenden statt eigene Statuslogik zu duplizieren.

## Sicherheit

Die Schnellaktionen verlassen sich nicht auf ausgeblendete Buttons:

- Enrichment erfordert `manage_leads`.
- Video und Screenshot erfordern `generate_video`.
- E-Mail erfordert `send_email`.
- WhatsApp erfordert `use_whatsapp`.
- Manuelle Termine erfordern `book_meetings`.
- Ohne `view_all_leads` sind nur Leads des eigenen Owners zugänglich.

## Performance

Die Lead-Akte wird erst beim Öffnen geladen. Der Detail-Endpunkt sendet nur die tatsächlich benötigten Lead-Felder und begrenzte Verlaufsdaten:

- 40 Aktivitäten
- 20 Aufgaben
- 10 Outreach-Einträge
- 10 Termine

Schwere Vorgänge starten nur explizit per Klick und blockieren nicht das übrige CRM.

## Kontaktstopp

"Kein Interesse" setzt:

- Pipeline auf `lost`
- `contactLocked = true`
- Call auf erledigt
- E-Mail und WhatsApp auf gestoppt
- `nextAction = none`
- offene Aufgaben auf verworfen

Damit können spätere Automationen den Lead zuverlässig überspringen.
