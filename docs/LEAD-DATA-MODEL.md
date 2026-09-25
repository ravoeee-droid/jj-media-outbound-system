# JJ Media Lead-Datenmodell

Meilenstein 1 definiert einen einzigen Lead-Datensatz als Quelle der Wahrheit für CRM, Recherche, Calls, Mail, WhatsApp, Video und spätere Automationen.

## Ownership

- `ownerId`: verantwortlicher Mitarbeiter.
- `createdById`: Benutzer, der den Lead angelegt/importiert hat.
- `assignedAt`: Zeitpunkt der Zuweisung.

Bestehende Leads werden bei der Migration dem aktuellen Workspace-Owner zugeordnet.

## Kontakt- und Profildaten

- `instagramUrl`: dediziertes Instagram-Profil.
- `websiteUrl`: offizielle Unternehmenswebsite.
- `email`, `phone`, `contact`: direkte Kontaktdaten.

Legacy-Datensätze, bei denen Instagram bisher in `websiteUrl` lag, bleiben kompatibel. Die Migration kopiert erkannte Instagram-URLs zusätzlich nach `instagramUrl`; neuer Code bevorzugt das dedizierte Feld.

## Workflow-Status

- `researchStatus`: pending | enriched | failed
- `validationStatus`: pending | contact_found | needs_review | validated | invalid
- `analysisStatus`: pending | ready | failed
- `callStatus`: not_started | queued | attempted | connected | callback | completed
- `emailStatus`: not_started | ready | sent | replied | stopped
- `whatsappStatus`: not_started | ready | opened | active | replied | stopped
- `videoStatus`: bestehender Video-Status bleibt erhalten.

## Nächste Aktion

- `nextAction`: review | enrich | validate | call | callback | send_info | whatsapp | follow_up | meeting | none
- `nextActionAt`: optionaler Fälligkeitszeitpunkt.

Der spätere Heute-Modus kann damit immer aus einem Feld bestimmen, was als Nächstes zu tun ist.

## Kontaktsperre

- `contactLocked`
- `contactLockReason`

Bestehende verlorene oder als opt-out/do-not-contact/gesperrt markierte Leads werden bei der Migration gesperrt.

## Architekturregel

Manuelle Buttons und Automationen sollen dieselben Backend-Aktionen verwenden. Dieses Datenmodell ist dafür die gemeinsame Grundlage.
