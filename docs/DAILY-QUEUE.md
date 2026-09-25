# Meilenstein 8 – Tages-Queue

Die Tages-Queue ist der fokussierte Arbeitsmodus für Cold Calls. Mitarbeiter müssen nicht im CRM nach dem nächsten Lead suchen.

## Prinzip

Die Queue wird live aus dem CRM berechnet. Es gibt keine zweite Queue-Tabelle und damit keinen separaten Queue-Status, der vom Lead abweichen kann.

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

In der Oberfläche wird nur ein Lead als aktuelle Aufgabe gezeigt. Fünf weitere werden als Vorschau angezeigt.

## Call-Ergebnisse

Ergebnisaktionen werden erst nach Klick auf „Jetzt anrufen“ freigeschaltet.

### Nicht erreicht
- Call-Status: attempted
- nächster Schritt bleibt Call
- Aktivität `call_no_answer`
- der Lead wird für den restlichen Berliner Kalendertag aus der Queue ausgeblendet
- ein eventuell fälliger Callback-Task wird abgeschlossen

### Info gewünscht
- Pipeline: contacted
- Call: connected
- E-Mail: ready
- nächster Schritt: `send_info`
- offener Callback-Task wird abgeschlossen
- ein hoch priorisierter Task `send_info` wird angelegt
- falls die E-Mail im Lead fehlt, kann sie direkt in der Queue während des Gesprächs eingetragen werden
- ohne vorhandene E-Mail wird der Lead nicht still verloren: `nextAction=collect_email` und der Task weist explizit auf die fehlende Adresse hin
- benötigt serverseitig `send_email`

### WhatsApp gewünscht
- Pipeline: contacted
- Call: connected
- WhatsApp: ready
- nächster Schritt: `whatsapp`
- offener Callback-Task wird abgeschlossen
- ein hoch priorisierter Task `whatsapp_followup` wird angelegt
- benötigt serverseitig `use_whatsapp`

### Rückruf
Verwendet `scheduleCallback`. Ein vorhandener offener Callback-Task wird aktualisiert statt dupliziert. Bis zum Fälligkeitszeitpunkt verschwindet der Lead aus der Queue.

### Termin
Verwendet `scheduleManualMeeting` und benötigt `book_meetings`. Nach Eintragung wird ein eventuell offener Callback-Task abgeschlossen.

### Kein Interesse
Verwendet `markNoInterest`: Kontakt-Lock, E-Mail-Stopp, WhatsApp-Stopp und offene Automationen/Aufgaben werden beendet.

## Schutz vor Bedienfehlern

Vor jeder Ergebnisaktion prüft der Server erneut, ob der Lead **jetzt gerade** noch in einer gültigen Tages-Queue liegt.

Dadurch kann ein alter Browser-Tab keinen Lead mehr bearbeiten, wenn dieser inzwischen:
- neu zugewiesen wurde,
- bereits verarbeitet wurde,
- gesperrt wurde,
- einen anderen nächsten Schritt hat,
- oder als „Nicht erreicht“ für heute bereits erledigt ist.

In diesem Fall antwortet die API mit HTTP 409 und fordert zum Neuladen auf, statt einen technischen 500-Fehler zu erzeugen.

## Team

Standardmäßig sieht jeder Mitarbeiter seine eigene Tages-Queue. Benutzer mit `view_all_leads` können auf die Queue eines anderen aktiven Mitarbeiters wechseln.

Die Schreibrechte selbst werden trotzdem serverseitig geprüft.

## Performance

- maximal 40 Leads werden für eine Queue vorgeladen
- nur die für Caller notwendigen Lead-Felder werden geladen
- aktuelle Aufgabe + fünf kommende Leads werden dargestellt
- keine zweite Queue-Tabelle
- keine täglichen Reset-Jobs
- „Nicht erreicht heute“ verwendet die vorhandene Aktivitätshistorie
- bestehender Index auf `activities(lead_id, created_at)`

## Grundprinzip

Ein Call-Ergebnis darf nie nur „verschwinden“. Sobald aus einem Gespräch eine Folgeaktion entsteht, bleibt sie zusätzlich als `nextAction` am Lead erhalten und wird für Info-Mail bzw. WhatsApp als Mitarbeiter-Task materialisiert.
