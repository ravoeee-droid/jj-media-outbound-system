# WhatsApp im JJ-Media Outbound Tool

Unter `/admin/dashboard/whatsapp` liegen Inbox, Tageslauf, KI-Wissen und Verbindungen im bestehenden JJ-Media Outbound Tool.

## Ablauf

1. Leads werden zuerst geprüft und angereichert.
2. Erstkontakte landen vor dem Versand in der manuellen Freigabe. Der feste Einstieg lautet `Hallo, bin ich da bei <Unternehmensname> gelandet?`.
3. Nur freigegebene Kontakte mit dokumentierter WhatsApp-Zustimmung können in den Tageslauf gehen.
4. Der Tageslauf verschickt höchstens das eingestellte Tageslimit und mindestens drei Minuten auseinander. Antworten stoppen den offenen Erstkontakt.
5. Nach einer Antwort folgt die Verkaufslogik Situation → Problem → Auswirkung → Priorität/Ziel → bisherige Versuche → Erlaubnis für Lösung. Pro Nachricht höchstens eine Frage.
6. Opt-out, geschlossene Chats, Sperr-Tags oder menschliche Übernahme stoppen die Automatik.

## Kostenloser Windows-Betrieb

Der WhatsApp-Teil läuft auf Jessys Windows-Laptop mit `@whiskeysockets/baileys` 6.7.24. Baileys hält direkt eine WebSocket-Verbindung zu WhatsApp und benötigt keinen Browser/Chromium.

Architektur:

`WhatsApp ↔ Baileys auf Jessys Laptop → HTTPS → JJ-Media Outbound Tool auf Vercel → Datenbank/KI/CRM`

Der Laptop öffnet keine Ports und benötigt weder VPS noch Cloudflare Tunnel. Das Outbound Tool versucht niemals, den Laptop direkt zu erreichen.

### Einmalige Einrichtung

Im Ordner `services/whatsapp-bridge`:

1. `INSTALL-WHATSAPP.bat` doppelklicken.
2. Die vorgeschlagene Outbound-Tool-Adresse bestätigen.
3. Das Outbound-Tool-Passwort eingeben. Das Klartextpasswort wird nicht gespeichert.
4. Der Installer richtet Node.js bei Bedarf, die Abhängigkeiten und den Windows-Autostart ein.
5. Danach WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen und den QR-Code scannen. Der QR erscheint sowohl im lokalen Fenster als auch unter **WhatsApp → Verbindungen** im Outbound Tool.

Danach startet der Dienst automatisch bei der Windows-Anmeldung. Manuell kann er über `START-WHATSAPP.bat` gestartet und über `STOP-WHATSAPP.bat` gestoppt werden.

Lokale Sitzungsdaten und das Versandjournal liegen unter `services/whatsapp-bridge/data/` und sind von Git ausgeschlossen. Sie dürfen nicht geteilt werden.

## Versand-Sicherheit

Vercel validiert Kontaktstatus, Zustimmung, KI-Regeln und Stop-Schalter, bevor eine Nachricht auf `sending` gesetzt wird. Der Laptop zieht nur solche validierten Aufträge. Vor dem tatsächlichen Senden prüft der Server den Kontaktstatus erneut. Der lokale Worker führt zusätzlich ein dauerhaftes Versandjournal. Ein Vorgang, dessen Zustand nach einem Absturz unklar ist, wird **nicht** automatisch wiederholt.

Manuell vom verknüpften WhatsApp-Handy gesendete Nachrichten werden für bereits im CRM zugeordnete 1:1-Kontakte in die gemeinsame Timeline gespiegelt. Gruppen, Broadcasts, Newsletter und fremde private Chats werden ignoriert. Beim ersten Verbinden wird bewusst keine alte Chat-Historie automatisch importiert, damit historische Nachrichten keine neue KI-Antwort auslösen.

Baileys ist eine inoffizielle WhatsApp-Web-Anbindung. Deshalb gibt es keine technische Garantie gegen Kontoeinschränkungen. Das System enthält keine Tricks zur Umgehung von Spam-Erkennung; die Schutzschicht besteht aus Zustimmung, manueller Freigabe, Limits, Abstand, Opt-out und Kill-Switch. Für größere Volumen sollte die offizielle WhatsApp Business Platform verwendet werden.

## Verifikation

Root-Anwendung:

```sh
npm run typecheck
npm run test:whatsapp
```

Windows-Worker:

```sh
cd services/whatsapp-bridge
npm install
npm test
```
