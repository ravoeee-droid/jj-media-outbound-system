# Meilenstein 7 – Recherche-Feed

Der Recherche-Feed hält Rohkandidaten bewusst getrennt vom CRM. Nur geprüfte Kandidaten gelangen über den Lead Intake in die eigentliche Pipeline.

## Tagesablauf

1. Admin definiert bis zu 10 Suchprofile, z. B. Branche + Region.
2. Der tägliche Cron ruft den Recherche-Feed auf.
3. Google Places API (New) wird genutzt, wenn ein API-Key vorhanden ist.
4. Ohne Google Places oder bei leeren/fehlgeschlagenen Ergebnissen wird die Web-Suche als Fallback verwendet.
5. Kandidaten werden untereinander und gegen CRM + bestehenden Feed dedupliziert.
6. Die stärksten Websites werden zusätzlich nach Telefon, E-Mail, Geschäftsführung und Social-Profilen geprüft.
7. Kandidaten werden nach Datenqualität und Kontaktierbarkeit priorisiert und erscheinen im Feed.
8. Mitarbeiter wählen maximal 30 Kandidaten und schicken sie in den bestehenden Lead Intake.
9. Nach erfolgreichem Intake werden Kandidat und tatsächlicher CRM-Lead serverseitig miteinander verknüpft.

## Google Places API (New)

Der Feed nutzt:
- `POST https://places.googleapis.com/v1/places:searchText`
- explizite Field Mask
- maximal 20 Ergebnisse je Suchprofil und Request

Benötigte Felder wie Website, Telefonnummer, Adresse, Rating und Review-Anzahl kommen direkt aus Text Search (New). Dadurch entfällt die frühere zusätzliche Detail-Abfrage pro Treffer.

Google Places ist optional. Ohne API-Key läuft der Web-Fallback weiter. Ein aktivierter Google-Places-Key kann abhängig vom Google-Cloud-Tarif Nutzungskosten verursachen.

## Social-Signale

Beim Website-Enrichment werden vorhandene Social-Links erkannt. Ein gefundenes Instagram-Profil wird:
- im Kandidaten-Rohdatensatz gespeichert,
- im Recherche-Feed direkt verlinkt,
- als zusätzliches Relevanzsignal im Score berücksichtigt,
- beim Übergang in den Intake als `instagramUrl` mitgegeben.

## Status

- `new`
- `shortlisted`
- `dismissed`
- `imported`

Kandidaten im Status `shortlisted` können direkt zurück in `new` gelegt werden, wenn der Intake abgebrochen wird.

## Score

Der Kandidaten-Score berücksichtigt:
- Website vorhanden
- Telefonnummer vorhanden
- E-Mail vorhanden
- Instagram-Profil gefunden
- Google-Bewertung
- Anzahl Google-Bewertungen

Der Score priorisiert den Recherche-Feed; er ist kein Umsatz- oder Abschlussversprechen.

## Deduplizierung

Vor dem Insert werden Kandidaten gegen folgende Identitäten geprüft:
- Domain
- normalisierter Firmenname

Dabei werden sowohl bestehende CRM-Leads als auch frühere Feed-Kandidaten berücksichtigt.

Im Intake findet anschließend eine zweite, strengere Prüfung statt:
- Instagram
- Domain
- normalisierter Firmenname

Wenn ein Recherche-Kandidat zwischen Discovery und Intake bereits im CRM existiert, wird er automatisch auf `imported` gesetzt und mit dem vorhandenen Lead verknüpft.

## Performance

- Feed-Abfrage maximal 200 Kandidaten.
- Tagesziel maximal 100.
- maximal 20 Google-Places-Treffer je Suchprofil und Request.
- Google Places (New) liefert die benötigten Felder in einer Anfrage statt Search + Details je Treffer.
- Website-Enrichment nur für maximal 20 priorisierte Kandidaten, in 3er-Batches.
- keine 100 parallelen Website-Aufrufe.
- Feed besitzt eigene Indizes nach Workspace, Status, Score, Domain und Firmenname.
- Insert-Zähler basiert auf tatsächlich geschriebenen Rows und bleibt auch bei parallelen Läufen korrekt.

## Automation

Vercel Cron: `/api/cron/research-feed` täglich um 05:30 UTC.

Die Route ist mit `CRON_SECRET` geschützt. Ein Workspace wird nur automatisch recherchiert, wenn:
- „Täglich automatisch“ aktiviert ist
- mindestens ein Suchprofil gespeichert ist

Der automatische Modus ist standardmäßig deaktiviert.
