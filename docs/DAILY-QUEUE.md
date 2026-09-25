# Meilenstein 8 – Tages-Queue

Die Tages-Queue ist der Arbeitsmodus für Cold Calls. Mitarbeiter müssen nicht im CRM nach dem nächsten Lead suchen.

## Prinzip

Die Queue wird live aus den Leads berechnet. Es gibt keine zweite Queue-Tabelle und damit keinen separaten Status, der vom CRM abweichen kann.

Ein Lead erscheint nur, wenn:
- er dem ausgewählten Mitarbeiter gehört,
- eine Telefonnummer vorhanden ist,
- der Kontakt nicht gesperrt ist,
- der Lead nicht gewonnen oder verloren ist,
- als nächster Schritt ein Call offen ist,
- oder ein Rückruf jetzt fällig ist.

## Sortierung

1. fällige Rückrufe
2. frühester Rückrufzeitpunkt
3. höchste Sales-Priorität
4. ältere Leads zuerst

## Call-Ergebnisse

Nach Klick auf „Jetzt anrufen“ werden die Ergebnisaktionen freigeschaltet.

### Nicht erreicht
- Call-Status: attempted
- nächster Schritt bleibt Call
- Aktivität `call_no_answer`
- der Lead wird für den restlichen Berliner Kalendertag aus der Queue ausgeblendet
- am nächsten Tag erscheint er automatisch wieder

### Info gewünscht
- Pipeline: contacted
- Call: connected
- E-Mail: ready
- nächster Schritt: `send_info`
- erfordert serverseitig `send_email`

### WhatsApp gewünscht
- Pipeline: contacted
- Call: connected
- WhatsApp: ready
- nächster Schritt: `whatsapp`
- erfordert serverseitig `use_whatsapp`

### Rückruf
Verwendet die bestehende gemeinsame Workflow-Funktion `scheduleCallback`. Bis zum Fälligkeitszeitpunkt verschwindet der Lead aus der Queue.

### Termin
Verwendet die bestehende gemeinsame Workflow-Funktion `scheduleManualMeeting` und benötigt `book_meetings`.

### Kein Interesse
Verwendet `markNoInterest`: Kontakt-Lock, E-Mail-Stopp, WhatsApp-Stopp und offene Automationen werden beendet.

## Team

Standardmäßig sieht jeder Mitarbeiter nur seine eigene Tages-Queue. Benutzer mit `view_all_leads` können oben auf einen anderen aktiven Mitarbeiter wechseln.

## Performance

Die Queue lädt nur die Felder, die der Caller tatsächlich benötigt. Maximal 40 Leads werden vorgeladen; in der Oberfläche erscheint nur der aktuelle Lead plus fünf kommende.

Für „Nicht erreicht heute“ wird die vorhandene Aktivitäts-Historie genutzt. Der bestehende Index auf `activities(lead_id, created_at)` verhindert eine zusätzliche Queue-Tabelle oder tägliche Reset-Jobs.
