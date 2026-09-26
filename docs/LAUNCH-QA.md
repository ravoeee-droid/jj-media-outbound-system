# Meilenstein 12 – Launch-QA / End-to-End-Abnahme

M12 ersetzt die alte Setup-Anzeige durch eine echte Produktions-Readiness-Prüfung.

## Grundsatz

Der Launch-Check ist **read-only**.

Er:
- erstellt keine Leads,
- sendet keine E-Mails,
- sendet keine WhatsApp-Nachrichten,
- bucht keine Termine,
- verändert keine Pipeline-Stufen.

Damit kann der Check jederzeit auch auf Produktion ausgeführt werden.

## Schnellcheck

Der normale Check prüft:

### Startkritisch
- Datenbank erreichbar
- Vercel Blob konfiguriert
- STRATO-Mail konfiguriert
- CRON_SECRET vorhanden
- Jessica-Mastervideo vorhanden
- mindestens ein aktiver Caller
- Renderer-Konfiguration vorhanden

### Betriebsqualität
- aktuelle Call-Queue
- Google-Kalender pro Caller
- Fehlerjobs der letzten 24 Stunden
- fehlgeschlagene E-Mails der letzten 24 Stunden
- unklare/fehlgeschlagene WhatsApp-Jobs
- offene und überfällige Aufgaben

### Aktivierte Automationen
Nur tatsächlich aktivierte Automationen können den Automationsstatus blockieren:
- Lead Scout
- Auto-Nachschub
- WhatsApp + lokale KI

Ein deaktivierter optionaler Kanal macht das Tool nicht automatisch „kaputt“.

## Tiefencheck

Der Tiefencheck führt zusätzlich zwei sichere Live-Probes aus.

### STRATO
- TLS-Verbindung zu IMAP
- Login
- lesender Zugriff auf den Posteingang
- keine Nachricht wird verändert oder versendet

### Video Renderer
- FFmpeg-Start
- kurzes synthetisches Mastervideo
- synthetischer Profil-Screenshot
- Social-Profile-Segment
- Image-Segment
- Speaker-Segment
- MP4 H.264/AAC-Ausgabe

Dabei werden keine Kundendaten verwendet und keine Testvideos dauerhaft gespeichert.

## Launch-Ampel

### Blocked
Mindestens eine startkritische Voraussetzung oder eine **aktivierte** Automation ist nicht betriebsbereit.

### Ready with warnings
Startkritische Basis ist betriebsbereit, aber mindestens eine empfohlene Betriebsqualität ist offen.

Beispiele:
- ein Caller hat Google Kalender noch nicht verbunden,
- Queue ist leer,
- Aufgabe ist überfällig.

Manuelle Fallbacks bleiben berücksichtigt.

### Ready
Keine Blocker und keine Betriebswarnungen.

## Caller-Abnahme

Der Systemcheck zeigt pro Caller:
- aktueller Queue-Bestand,
- fällige Rückrufe,
- High-Priority-Leads,
- Google Kalender verbunden / offen,
- für Auto-Nachschub ausgewählt / manuell.

Damit erkennt Jessica vor dem Arbeitstag, ob jemand technisch oder operativ blockiert ist.

## Automations-Sicherheit

### Lead Scout
Wenn automatische Recherche aktiviert ist:
- mindestens ein Suchprofil muss vorhanden sein,
- letzter erfolgreicher Lauf darf nicht älter als 30 Stunden sein.

### Auto-Nachschub
Wenn automatische Verteilung aktiviert ist:
- alle ausgewählten Caller müssen weiterhin aktiv/berechtigt sein,
- mindestens ein Caller muss ausgewählt sein,
- letzter erfolgreicher Lauf darf nicht älter als 30 Stunden sein.

### WhatsApp
Wenn WhatsApp-Automation aktiviert ist:
- lokaler Worker muss einen frischen Heartbeat liefern,
- WhatsApp muss verbunden sein,
- lokale Ollama-KI muss bereit sein.

Wenn WhatsApp-Automation deaktiviert ist, bleibt manueller WhatsApp-Betrieb optional und blockiert den Gesamtlaunch nicht.

## Oberfläche

Route:
`/system`

Ganz oben:
- Launch-Ampel
- Blocker / Warnungen
- Schnellcheck
- Tiefencheck
- operative Kennzahlen
- gruppierte Checks
- Caller-Abnahme

Darunter bleibt die bestehende System-Historie mit Jobs, Fehlern und Kampagnensteuerung erhalten.

## Definition von „Tool fertig“

Der Code kann als technisch produktionsbereit gelten, wenn:

1. CI / TypeScript / Lint grün sind.
2. Vercel Production READY ist.
3. keine aktuellen Runtime-Errors vorliegen.
4. Launch-Schnellcheck keine startkritischen Blocker zeigt.
5. Tiefencheck STRATO + Renderer erfolgreich bestätigt.
6. externe einmalige Verbindungen, die bewusst Benutzeraktion erfordern (z. B. Google Kalender / lokaler WhatsApp-Laptop), entweder verbunden sind oder als klarer optionaler Warnpunkt/Fallback sichtbar sind.

Danach ist weiteres Arbeiten Optimierung und Skalierung – nicht mehr Grundaufbau.
