# Zentrales CRM

Meilenstein 3 führt ein gemeinsames Workspace-CRM mit persönlichen Ansichten ein.

## Bedienung

- `Mein CRM`: nur Leads des angemeldeten Mitarbeiters.
- Mitarbeiter-Tabs: Leads eines konkreten Teammitglieds.
- `Unzugeordnet`: Leads ohne Owner.
- `Alle Leads`: gesamte Workspace-Pipeline.

Nur Benutzer mit `view_all_leads` sehen Team-Tabs, Unzugeordnet und Alle. Ohne dieses Recht wird serverseitig immer auf den eigenen Owner gefiltert.

## Performance

Die CRM-Liste lädt bewusst nur die Felder, die für die Übersicht benötigt werden. Große Felder wie Notizen, Pitch, Evidence, Aktivitäten, Outreach oder Events werden erst beim Öffnen einer Lead-Akte über `/api/crm/[id]` geladen.

- 50 Leads pro Request.
- Keyset-Pagination über `updated_at + id` statt großer Offset-Abfragen.
- 220-ms Debounce für Suche.
- Abbruch veralteter Requests mit AbortController.
- Client-Cache für bereits geöffnete, ungefilterte Tabs mit stillem Revalidate.
- Parallel ausgeführte DB-Abfragen für Liste, Tab-Zähler und Team-Metadaten.
- Indizes für `workspace_id, updated_at` sowie `workspace_id, owner_id, updated_at`.

## Zugriff

CRM-Zugriff ist nicht nur UI-seitig gefiltert:
- `/api/crm`, `/api/crm/[id]` und der bestehende Lead-Endpoint prüfen Lead-Rechte serverseitig.
- Ohne `view_all_leads` können fremde Lead-Akten nicht geladen oder bearbeitet werden.
- Owner-Wechsel ist nur mit `view_all_leads + manage_leads` möglich.
- Aufgaben werden für normale Mitarbeiter auf die eigene Assignee-ID gefiltert.

## Datenmodell

Leads bleiben einmalig im zentralen Workspace gespeichert. Persönliche CRMs sind Views auf `owner_id`, keine Kopien oder getrennten Datenbanken.
