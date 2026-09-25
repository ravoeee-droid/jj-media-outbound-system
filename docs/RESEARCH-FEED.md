# Meilenstein 7 – Recherche-Feed

Der Recherche-Feed hält Rohkandidaten bewusst getrennt vom CRM.

## Tagesablauf

1. Admin definiert bis zu 10 Suchprofile, z. B. Branche + Region.
2. Der tägliche Cron ruft den Recherche-Feed auf.
3. Google Places wird genutzt, wenn ein API-Key vorhanden ist.
4. Ohne Google Places oder bei leeren Ergebnissen wird eine Web-Suche als Fallback verwendet.
5. Kandidaten werden untereinander und gegen CRM + bestehenden Feed dedupliziert.
6. Bis zu 12 der stärksten Websites werden pro Lauf zusätzlich nach Telefon/E-Mail geprüft.
7. Kandidaten werden nach Datenqualität gescored und erscheinen im Feed.
8. Mitarbeiter wählen maximal 30 aus und schicken sie in den bestehenden Lead Intake.
9. Nach erfolgreichem Intake wechseln die Kandidaten auf "Übernommen".

## Status

- new
- shortlisted
- dismissed
- imported

## Score

Der Kandidaten-Score berücksichtigt u. a.:
- Website vorhanden
- Telefonnummer vorhanden
- E-Mail vorhanden
- Google-Bewertung
- Anzahl Google-Bewertungen

Der Score ist eine Priorisierung für die Recherche-Queue, kein Umsatzversprechen.

## Deduplizierung

Vor dem Insert werden Kandidaten gegen folgende Identitäten geprüft:
- Domain
- normalisierter Firmenname

Dabei werden sowohl bestehende CRM-Leads als auch frühere Feed-Kandidaten berücksichtigt.

## Performance

- Feed-Abfrage maximal 200 Kandidaten.
- Tagesziel maximal 100.
- maximal 20 Google-Places-Treffer je Suchprofil und Lauf.
- Google-Details in kleinen 5er-Batches.
- Website-Enrichment nur für maximal 12 starke Kandidaten, in 3er-Batches.
- keine 100 parallelen Browser-/Website-Aufrufe.
- Feed besitzt eigene Indizes nach Workspace, Status, Score, Domain und Firmenname.

## Automation

Vercel Cron: `/api/cron/research-feed` täglich um 05:30 UTC.

Die Route ist mit `CRON_SECRET` geschützt. Ein Workspace wird nur automatisch recherchiert, wenn:
- "Täglich automatisch" aktiviert ist
- mindestens ein Suchprofil gespeichert ist

Ohne Google Places funktioniert weiterhin der Web-Fallback. Google Places verbessert insbesondere Telefonnummern, Bewertungen und Standortdaten.
