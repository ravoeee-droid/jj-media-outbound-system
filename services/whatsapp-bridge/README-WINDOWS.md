# JJ-Media WhatsApp auf Windows

## Einmalig

1. Ordner auf Jessys Laptop entpacken.
2. `INSTALL-WHATSAPP.bat` doppelklicken.
3. Die Adresse des Outbound Tools einfach mit Enter bestätigen.
4. Das Passwort des JJ-Media Outbound Tools eingeben. Das Passwort wird **nicht** lokal gespeichert; nur das daraus ausgestellte Sitzungstoken wird gespeichert.
5. Nach dem Start den QR-Code mit WhatsApp unter **Einstellungen → Verknüpfte Geräte → Gerät hinzufügen** scannen.
6. Im Outbound Tool unter **WhatsApp → Verbindungen** erscheint anschließend `Verbunden`.

## Danach

Der Dienst startet automatisch, sobald sich Jessy bei Windows anmeldet. Falls er einmal nicht läuft, `START-WHATSAPP.bat` doppelklicken. Zum bewussten Stoppen `STOP-WHATSAPP.bat` verwenden.

## Technik

Der Laptop hält die WhatsApp-WebSocket-Verbindung mit Baileys. Er baut ausschließlich ausgehende HTTPS-Verbindungen zum vorhandenen JJ-Media Outbound Tool auf. Es gibt keinen VPS, keinen Tunnel, keine offenen Router-Ports und keinen Chromium-Prozess.

Die Sitzung liegt nur lokal in `data/auth`. `data/` niemals teilen oder in Git hochladen. Bei Passwortänderung im Outbound Tool `INSTALL-WHATSAPP.bat` erneut ausführen. Bei einer WhatsApp-Abmeldung wird automatisch eine neue QR-Kopplung verlangt.

Baileys ist eine inoffizielle WhatsApp-Web-Anbindung. Ein Konto kann deshalb nie technisch gegen Einschränkungen garantiert werden. Das Outbound Tool behält deshalb Zustimmung/Opt-out, manuelle Freigabe, Tageslimits, Abstände und Stop-Schalter als Sicherheitsgrenzen bei.
