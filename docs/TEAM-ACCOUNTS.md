# Team & Benutzerkonten

Meilenstein 2 ersetzt den gemeinsamen Mitarbeiterzugang durch persönliche Konten, ohne den bestehenden Bootstrap-Zugang für Jessica und den lokalen WhatsApp-Worker zu brechen.

## Anmeldung

- Jessica/Worker: bestehender Passwort-only Login bleibt kompatibel.
- Mitarbeiter: E-Mail + eigenes Passwort.
- Sitzungen werden 30 Tage als signiertes, HttpOnly Cookie gespeichert.
- Mitarbeiter-Passwörter werden ausschließlich als PBKDF2-SHA256 Hash + zufälligem Salt gespeichert.

## Rollen

- Admin
- Vertrieb
- Setter
- Recherche
- Nur lesen

Der Workspace-Owner bleibt geschützt und kann nicht versehentlich deaktiviert oder umgestuft werden.

## Rechte

Rollen liefern Standardrechte, Jessica kann Rechte pro Mitarbeiter individuell abweichend setzen.

- Eigene Leads sehen
- Team-Leads sehen
- Leads bearbeiten
- E-Mails senden
- WhatsApp nutzen
- Videos erstellen
- Termine buchen
- Mitarbeiter verwalten
- Einstellungen ändern
- KPIs sehen

## Aufgaben

Tasks besitzen jetzt `assigneeId`. Bestehende Aufgaben werden bei der Migration dem Lead-Owner bzw. Workspace-Owner zugeordnet. Neue Outreach-Follow-ups werden automatisch dem Lead-Owner zugewiesen.

## Sicherheitsprinzip

Teamverwaltung selbst ist serverseitig durch `manage_team` geschützt. Die Navigation blendet Module anhand der Rechte aus. Weitere fachliche Datenfilter (z. B. Mein CRM vs. Team CRM) werden in Meilenstein 3 umgesetzt.
