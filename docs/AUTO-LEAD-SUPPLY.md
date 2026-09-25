# Meilenstein 10 – Automatischer Lead-Nachschub

M10 verbindet Lead Scout und Tages-Queue zu einem sicheren Nachschubsystem.

## Grundprinzip

Rohkandidaten werden niemals automatisch an Mitarbeiter verteilt.

Automatisch ins CRM dürfen nur Kandidaten mit Status `call_ready`:
- validierte, normalisierte Telefonnummer
- ausreichender Research-Score
- bereits gegen bestehende CRM-Leads und Research-Kandidaten dedupliziert
- Website-/Kontakt-Enrichment wurde im Lead Scout ausgeführt

## Zwei getrennte Automationen

### 1. Tägliche Recherche

Bestehender Schalter im Lead Scout:
- sucht neue Unternehmen
- enriched Kontakte
- validiert Telefonnummern
- baut den `call_ready`-Vorrat bis zum eingestellten Ziel auf

### 2. Auto-Nachschub

Separater Schalter:
- ausgewählte Mitarbeiter festlegen
- Sollwert offener Calls pro Mitarbeiter festlegen
- nur die Differenz zum Soll wird aufgefüllt

Beispiel:

- Jessica: 22 offene Calls
- Ziel: 30
- Auto-Nachschub importiert höchstens 8 neue Leads

## Zulässige Mitarbeiter

Automatisch beliefert werden nur aktive Konten mit:
- Rolle Owner, Admin, Vertrieb oder Setter
- Recht `manage_leads`
- Recht `view_own_leads`

Recherche- und Nur-Lesen-Konten werden nicht automatisch mit Call-Leads befüllt.

Der Admin muss die Mitarbeiter explizit auswählen. Standardmäßig ist Auto-Nachschub deaktiviert.

## Faire Verteilung

Die besten Call-ready Kandidaten werden nicht einfach dem ersten Mitarbeiter gegeben.

Die Verteilung priorisiert den niedrigsten relativen Queue-Füllstand:
- aktueller Queue-Bestand / Zielwert
- anschließend absoluter Queue-Bestand
- stabiler Name-Tie-Breaker

Dadurch werden ausgewählte Mitarbeiter möglichst gleichmäßig aufgefüllt.

## Zweiter Sicherheitsdurchlauf

Zwischen Research und finalem CRM-Import kann theoretisch eine neue Dublette entstehen.

Deshalb:
1. Kandidat wird vor der Übernahme nochmals durch den bestehenden Intake geprüft.
2. Wird er dort als bestehend erkannt, wird kein neuer CRM-Lead erzeugt.
3. Der Research-Kandidat wird sauber mit dem bestehenden Lead verknüpft.
4. Der Auto-Supply nimmt im nächsten Durchlauf einen weiteren Call-ready Kandidaten.

Bis zu drei Nachfüll-Pässe gleichen solche Race-Conditions aus.

## CRM-Status neuer Auto-Leads

Neu erzeugte Leads erhalten:
- Owner = ausgewählter Mitarbeiter
- `pipelineStage = contact_ready`
- `researchStatus = enriched`
- `validationStatus = validated`
- `analysisStatus = ready`
- `callStatus = not_started`
- `nextAction = call`

Damit erscheinen sie sofort in der bestehenden Tages-Queue.

Sie werden nicht erneut als Rohlead durch die komplette Intake-Aufbereitung geschickt, weil Research und Kontaktvalidierung bereits im Lead Scout erfolgt sind.

## Bestehende Leads

Wenn beim finalen Intake ein Kandidat bereits im CRM existiert:
- bestehender Lead wird nicht in eine frühere Pipeline-Stufe zurückgesetzt
- vorhandener Owner wird nicht überschrieben
- Kandidat wird als `imported` mit dem bestehenden CRM-Lead verknüpft

## Tages-Queue als Sollbestand

Für den Sollwert zählt dieselbe Live-Queue wie im Mitarbeiter-Cockpit:
- offene Call-Leads
- fällige Rückrufe
- keine gesperrten Leads
- keine gewonnenen/verlorenen Leads
- heute bereits als „nicht erreicht“ bearbeitete Leads zählen für den restlichen Tag nicht

Dadurch füllt das System tatsächliche Arbeitskapazität statt nur CRM-Datensätze.

## Limits

- Queue-Ziel pro Mitarbeiter: 10–60
- maximal 20 ausgewählte Mitarbeiter
- maximal 100 neue Queue-Leads pro Supply-Lauf
- maximal 30 Kandidaten je Intake-Batch
- maximal drei Nachfüll-Pässe
- Research-Vorrat wird nach Score und Fundzeit sortiert

## Manueller Betrieb

Alle Automationen bleiben einzeln bedienbar:

- `Jetzt recherchieren` → füllt nur den Lead-Scout-Vorrat
- `Queues jetzt auffüllen` → verteilt nur bereits Call-ready Kandidaten
- manueller `Im Intake prüfen`-Flow bleibt unverändert verfügbar

Der Auto-Nachschub kann ausgeschaltet sein, während die manuelle Verteilung weiterhin funktioniert.

## Nachtlauf

Der vorhandene Cron `/api/cron/research-feed` orchestriert nun beide Stufen.

Für jeden Workspace:
1. falls tägliche Recherche aktiv → Research-Feed auffüllen
2. falls Auto-Nachschub aktiv → ausgewählte Mitarbeiter-Queues auffüllen

Ein Workspace wird auch verarbeitet, wenn nur eine der beiden Stufen aktiv ist.

Zeitplan:
- Vercel Cron: täglich 05:30 UTC
- im deutschen Sommer entspricht das 07:30 Uhr Europe/Berlin

## Sicherheit beim Rollout

Neue Installationen bzw. bestehende Workspaces haben:
- `enabled = false`
- keine ausgewählten Mitarbeiter
- Queue-Ziel = 30

Ein Deployment von M10 löst deshalb nicht automatisch Lead-Importe aus.

Erst nach explizitem Speichern der Auto-Nachschub-Einstellungen darf der Cron produktiv verteilen.
