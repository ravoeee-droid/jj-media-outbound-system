# Power-Modus / Bulk Actions

Meilenstein 5 ergänzt das zentrale CRM um sichere Mehrfachaktionen für bis zu 30 Leads.

## Bedienung

Mitarbeiter mit `manage_leads` können Leads per Checkbox auswählen. Die Auswahl ist bewusst auf 30 Leads begrenzt.

Verfügbare Aktionen:
- Enrichen
- Validieren
- Analysieren
- Instagram-Screenshots erstellen
- Owner zuweisen oder auf Unzugeordnet setzen

## Vorprüfung

Keine Bulk-Aktion startet sofort. `POST /api/crm/bulk` mit `mode=preview` prüft jeden ausgewählten Lead serverseitig.

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

Nur die serverseitig als geeignet markierten Leads werden verarbeitet.

- schnelle Aktionen: Chunks bis 10 Leads
- Enrichment: Chunks bis 5 Leads; serverseitig maximal 2 parallele Enrichment-Worker
- Screenshots: exakt 1 Browser-Capture gleichzeitig
- Fortschritt wird nach jedem Chunk bzw. Screenshot aktualisiert
- ein einzelner Fehler stoppt nicht die restlichen geeigneten Leads
- danach wird die CRM-Liste still revalidiert

## Screenshots

Bulk-Screenshots werden bewusst **nicht** als 30 parallele Chromium-Prozesse gestartet und auch nicht in eine tote Hintergrund-Queue gelegt.

Der Browser ruft für jeden geeigneten Lead nacheinander den bestehenden, abgesicherten Capture-Endpunkt auf:
`POST /api/leads/:id/capture-profile`

Damit gilt:
- höchstens ein Browser-Capture gleichzeitig
- sofort sichtbarer Fortschritt
- Fehler pro Lead isoliert
- kein zusätzlicher Cron oder Queue-Worker nötig
- keine zusätzliche DB-Infrastruktur für den Power-Modus

## Sicherheit

- Alle Bulk-Aktionen verlangen `manage_leads`.
- Screenshots verlangen zusätzlich `generate_video`.
- Owner-Wechsel verlangt `view_all_leads`.
- Ohne `view_all_leads` kann ein Mitarbeiter nur eigene Leads bulk-verarbeiten.
- Ein Owner-Ziel muss explizit angegeben werden.
- Die Preview wird auf dem Server gegen den aktuellen Datenstand berechnet.

## Performance

Die Liste selbst bleibt unverändert leichtgewichtig. Erst nach expliziter Freigabe werden die ausgewählten Leads verarbeitet. Schwere Browser-Arbeit wird serialisiert; schnelle DB-Aktionen werden in kleinen Chunks verarbeitet.
