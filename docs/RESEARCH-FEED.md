# Meilenstein 10 – Lead Scout

Der Lead Scout baut auf dem Recherche-Feed aus Meilenstein 7 auf. Rohkandidaten bleiben weiterhin bewusst außerhalb des CRM. Neu ist die harte **Call-ready-Stufe**: Ein Lead gilt erst dann als bereit für den Vertrieb, wenn die Telefonnummer normalisiert und auf ein plausibles deutsches Rufnummernformat geprüft wurde.

## Ziel

Morgens soll ein Vorrat von bis zu 100 wirklich anrufbaren, deduplizierten und priorisierten Leads bereitliegen. Der tägliche Lauf füllt den Vorrat auf das eingestellte Ziel auf, statt blind immer weitere Datensätze anzuhäufen.

## Ablauf

1. Admin definiert bis zu 10 Suchprofile, z. B. Branche + Region.
2. Der tägliche Vercel Cron startet den Lead Scout.
3. Google Places API (New) wird genutzt, wenn ein API-Key vorhanden ist; pro Suchprofil können bis zu drei Seiten mit insgesamt bis zu 60 Treffern gelesen werden.
4. Ohne Google Places oder bei fehlgeschlagenen Ergebnissen dient die Web-Suche als Fallback.
5. Kandidaten werden zuerst untereinander sowie gegen CRM und bestehenden Scout-Feed dedupliziert.
6. Dublettenprüfung nutzt Firmenname, Domain und zusätzlich normalisierte Telefonnummern.
7. Website-Enrichment ergänzt – innerhalb eines festen Laufzeitbudgets – E-Mail, Telefonnummer, Geschäftsführung und Social-Links.
8. Telefonnummer, E-Mail und Instagram werden vor dem Scoring normalisiert und validiert.
9. Nur Kandidaten mit plausibler Telefonnummer und ausreichendem Score erhalten den Status `call_ready`.
10. Unvollständige, aber interessante Kandidaten landen separat unter **Prüfen** und verfälschen den Call-ready-Zähler nicht.
11. Mitarbeiter können die besten 30 Call-ready Leads auswählen und in den bestehenden Lead Intake geben.
12. Nach erfolgreichem Intake werden Kandidat und tatsächlicher CRM-Lead serverseitig miteinander verknüpft.

## Kontaktvalidierung

**Telefon:** Deutsche Rufnummern werden auf `+49…` normalisiert. Zu kurze, zu lange, fremde oder durch typische Scraper-IDs/Datumswerte verunreinigte Nummern werden verworfen.

**E-Mail:** Adressen werden syntaktisch geprüft. Zusätzlich wird markiert, ob die Domain zur offiziellen Unternehmenswebsite passt. Freemail-Adressen bekommen keinen Firmen-Domain-Bonus.

**Instagram:** Nur echte Profilpfade werden akzeptiert und kanonisiert. Beiträge, Reels und Plattform-Systempfade zählen nicht als validiertes Profil.

## Status

- `call_ready` – Telefonnummer validiert, direkt anrufbar
- `new` – interessant, aber Kontakt noch unvollständig
- `shortlisted` – in den Intake übergeben
- `dismissed` – verworfen
- `imported` – ins CRM übernommen

Beim Wiederherstellen entscheidet die gespeicherte Kontaktvalidierung automatisch, ob der Kandidat zurück nach `call_ready` oder `new` gehört.

## Performance

- Zielbestand maximal 100 Call-ready Leads.
- Discovery-Pool maximal 300 Kandidaten pro Lauf.
- Google Places maximal 60 Treffer pro Suchprofil.
- Website-Enrichment maximal 120 Websites und mit festem Zeitbudget.
- Website-Aufrufe laufen in kleinen 5er-Batches.
- Deduplizierung erfolgt vor dem teureren Website-Enrichment.
- Der Lauf speichert Ziel, Bestand vorher/nachher, neue Call-ready Leads, Dubletten und Enrichment-Anzahl.

## Automation

Vercel Cron: `/api/cron/research-feed` täglich um 05:30 UTC.

Ein Workspace wird nur automatisch recherchiert, wenn „Täglich automatisch“ aktiviert und mindestens ein Suchprofil gespeichert ist. Der automatische Modus bleibt standardmäßig deaktiviert, damit keine externen API-Kosten ohne bewusste Aktivierung entstehen.
