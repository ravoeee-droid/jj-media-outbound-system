# JJ-Media WhatsApp auf Windows

## Einmalig

1. Ordner auf Jessys Laptop entpacken.
2. `INSTALL-WHATSAPP.bat` doppelklicken.
3. Die Adresse des Outbound Tools einfach mit Enter bestätigen.
4. Das Passwort des JJ-Media Outbound Tools eingeben. Das Passwort wird **nicht** lokal gespeichert; nur das daraus ausgestellte Sitzungstoken wird gespeichert.
5. Nach dem Start den QR-Code mit WhatsApp unter **Einstellungen → Verknüpfte Geräte → Gerät hinzufügen** scannen.
6. Im Outbound Tool unter **WhatsApp → Verbindungen** erscheint anschließend `Verbunden`.

## Alte WhatsApp-Chats für den Lead Radar einlesen

Für den ersten vollständigen History-Import nach diesem Update einmal `RESYNC-WHATSAPP-HISTORY.bat` doppelklicken.

Dadurch wird nur die lokale WhatsApp-Gerätekopplung zurückgesetzt. Die JJ-Media-Konfiguration, das Outbound-Tool-Login und Ollama bleiben erhalten. Anschließend den neuen QR-Code erneut unter **WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen** scannen.

Die Bridge verbindet sich danach im Desktop-History-Modus mit `syncFullHistory` und überträgt die von WhatsApp tatsächlich bereitgestellte 1:1-Historie an den JJ-Media Workspace. Gruppen, Status und Newsletter werden nicht importiert. Sehr alte Nachrichten oder einzelne LID-Historieneinträge können von WhatsApp ohne auflösbare Telefonnummer geliefert werden und werden dann nicht automatisch einem Kontakt zugeordnet.

Im Outbound Tool findest du anschließend unter **WhatsApp → Lead Radar**:

- heiße Leads und Kaufinteresse,
- eingeschlafene Kontakte für Reaktivierung,
- offene Follow-ups,
- erkannte Kundenkontakte,
- private bzw. ungeeignete Chats,
- KI-Zusammenfassungen, Priorität und Reaktivierungsentwürfe.

Die Analyse läuft lokal über Ollama. Es ist dafür kein Dify- oder OpenAI-API-Abo nötig.

## Automatische Reaktivierung und Terminierung

Historische Chats werden analysiert, aber nicht blind angeschrieben. Eine vorbereitete Reaktivierung darf nur automatisch versendet werden, wenn für den Kontakt im WhatsApp Workspace **Zustimmung** dokumentiert ist und **Autopilot** aktiv ist. Opt-outs, private Kontakte und klare Absagen bleiben gesperrt.

Antwortet ein freigegebener Lead, übernimmt der bestehende WhatsApp-Agent. Bei Termininteresse lädt er echte freie Kalenderzeiten. Erst wenn der Kontakt einen zuvor angebotenen Slot eindeutig auswählt, wird der Termin im verbundenen Kalender gebucht und anschließend bestätigt.

## Danach

Der Dienst startet automatisch, sobald sich Jessy bei Windows anmeldet. Falls er einmal nicht läuft, `START-WHATSAPP.bat` doppelklicken. Zum bewussten Stoppen `STOP-WHATSAPP.bat` verwenden.

## Technik

Der Laptop hält die WhatsApp-WebSocket-Verbindung mit Baileys und führt die lokale KI über Ollama aus. Er baut ausschließlich ausgehende HTTPS-Verbindungen zum vorhandenen JJ-Media Outbound Tool auf. Es gibt keinen VPS, keinen Tunnel und keine offenen Router-Ports.

Die WhatsApp-Sitzung liegt nur lokal in `data/auth`. `data/` niemals teilen oder in Git hochladen. Bei Passwortänderung im Outbound Tool `INSTALL-WHATSAPP.bat` erneut ausführen. Bei einer WhatsApp-Abmeldung wird automatisch eine neue QR-Kopplung verlangt.

Baileys ist eine inoffizielle WhatsApp-Web-Anbindung. Ein Konto kann deshalb nie technisch gegen Einschränkungen garantiert werden. Das Outbound Tool behält deshalb Zustimmung/Opt-out, Tageslimits, Abstände und Stop-Schalter als Sicherheitsgrenzen bei.
