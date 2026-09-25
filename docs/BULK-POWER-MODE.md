# Power-Modus / Bulk Actions

Meilenstein 5 ergänzt das zentrale CRM um sichere Mehrfachaktionen für bis zu 30 Leads.

## Bedienung

Mitarbeiter mit `manage_leads` können Leads über Checkboxen auswählen. Die Auswahl ist bewusst auf 30 Leads begrenzt.

Verfügbare Aktionen:
- Enrichen
- Validieren
- Analysieren
- Screenshot/Medienvorbereitung
- Owner zuweisen oder auf Unzugeordnet setzen

## Vorprüfung

Keine Bulk-Aktion startet sofort. `POST /api/crm/bulk` mit `mode=preview` prüft jeden Lead serverseitig.

Beispiele für Skip-Gründe:
- Lead ist abgeschlossen oder gesperrt
- bereits validiert
- Analyse bereits aktuell
- bereits enriched und direkter Kontakt vorhanden
- Instagram-Profil fehlt
- Profil-Screenshot existiert bereits
- Owner ist bereits korrekt

Die UI zeigt vor der Ausführung:
- ausgewählte Leads
- geeignete Leads
- übersprungene Leads
- konkreten Grund je Lead

## Ausführung

Der Browser führt nur die zuvor geeigneten IDs aus.

- schnelle Aktionen: Chunks bis 10 Leads
- Enrichment: Chunks bis 5 Leads, serverseitig maximal 2 parallele Enrichment-Worker
- Fortschritt wird nach jedem Chunk aktualisiert
- ein fehlgeschlagener Lead stoppt nicht automatisch den ganzen Chunk
- nach Ende wird die CRM-Liste still revalidiert

## Medien-Queue

Bulk-Screenshots starten bewusst nicht 30 Browser-Captures in einem Vercel-Request.

Stattdessen werden geeignete Leads als `profile_capture_prepare` in der bestehenden `jobs`-Tabelle vorgemerkt:
- Status `queued`
- Lead `videoStatus = queued`
- `nextAction = screenshot`

Die eigentliche Queue-Verarbeitung kann dadurch kontrolliert und einzeln erfolgen, ohne das CRM zu blockieren.

## Sicherheit

- Alle Aktionen verlangen `manage_leads`.
- Medienvorbereitung verlangt zusätzlich `generate_video`.
- Owner-Wechsel verlangt `view_all_leads`.
- Ohne `view_all_leads` kann ein Mitarbeiter nur eigene Leads bulk-verarbeiten.
- Ein Owner-Ziel muss explizit angegeben werden; fehlendes Ziel führt zu HTTP 400.

## Performance

Für die Medien-Queue existiert der Index:

`jobs(workspace_id, type, status, lead_id)`

Damit bleiben Queue-Prüfungen auch bei wachsender Job-Historie gezielt.
