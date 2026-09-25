# Meilenstein 6 – Lead Intake

Der Lead Intake ist der einzige empfohlene Weg für neue Recherchelisten ins CRM.

## Ablauf

1. Daten rein
2. serverseitig prüfen
3. die besten maximal 30 Leads auswählen
4. Owner festlegen
5. ins CRM übernehmen
6. optional direkt Enrichment → Validierung → Priorisierung starten

## Eingaben

Unterstützt werden:
- CSV
- JSON
- eingefügtes CSV/JSON
- eine Firma pro Zeile

Die bestehende Normalisierung erkennt u. a. Felder wie:
- company / companyName / firma / unternehmen / title
- website / homepage
- phone / telefon
- email
- Instagram-Profil
- Google-Maps-Exporte

## Dublettenprüfung

Die Vorschau schreibt noch nichts in die Datenbank.

Der Server normalisiert die komplette Liste und bündelt Dubletten innerhalb des Imports. Danach werden bestehende Leads in wenigen gebündelten Abfragen über folgende Identitäten gesucht:

1. Instagram-Profil
2. Domain
3. normalisierter Firmenname

Ergebnisse:
- **Neu**: neuer Lead
- **Ergänzen**: vorhandener Lead mit neuen/aktuelleren Feldern
- **Vorhanden**: kein Informationsgewinn, wird nicht erneut übernommen

Bestehende Kontaktdaten werden beim Ergänzen nicht mit leeren Importfeldern überschrieben.

## Beste 30

Standardmäßig werden maximal 30 geeignete Leads ausgewählt. Die Reihenfolge berücksichtigt:

1. Kontaktbereitschaft
2. direkten Kontaktweg
3. Sales Priority
4. Firmenname als stabilen Tie-Breaker

Damit wird bei großen Listen nicht einfach nach Dateireihenfolge gearbeitet.

## Ownership

Benutzer mit `view_all_leads` können neue Leads:
- sich selbst,
- einem aktiven Mitarbeiter,
- oder `Unzugeordnet`

zuweisen.

Bestehende Leads behalten beim Intake ihren bisherigen Owner.

Mitarbeiter ohne Team-Lead-Recht importieren automatisch in ihr eigenes CRM.

## Aufbereitung

Nach erfolgreicher Übernahme kann dieselbe Runde direkt mit den bestehenden Power-Modus-Endpunkten verarbeitet werden:

- Enrichment
- Validierung
- Analyse / Priorisierung

Die Verarbeitung bleibt bewusst synchron und sichtbar. Enrichment läuft in kleinen Chunks und nicht als unkontrollierter Hintergrundjob.

## Architektur / Performance

- keine zusätzliche Staging-Tabelle
- kein neuer Cron
- kein Queue-Worker
- Vorschau wird beim Commit serverseitig nochmals berechnet
- Dublettenabfragen werden gebündelt statt Lead für Lead ausgeführt
- maximal 100 normalisierte Datensätze in einer Vorschau
- maximal 30 Leads pro Übernahme
- neue Leads werden als Batch eingefügt
- bestehende Leads werden nur bei echtem Informationsgewinn aktualisiert

Der alte Outbound-Screen verweist für Importe auf den Intake, damit Mitarbeiter die Vorprüfung nicht versehentlich umgehen.
