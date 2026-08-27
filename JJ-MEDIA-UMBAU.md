# JJ-Media Social-Outbound – Umbau

## Neuer Ablauf

1. Lead mit Unternehmen und Instagram-Profil (`@handle` oder Profil-URL) anlegen oder importieren.
2. Optional in der Lead-Tabelle über **IG-Screenshot** einen echten Profil-Screenshot hochladen.
3. Über **Video erstellen** die Fake-Loom-Sequenz rendern.
4. Das System nutzt zuerst den hochgeladenen Screenshot. Ohne Upload versucht es eine automatische Aufnahme des öffentlichen Instagram-Profils.
5. Die persönliche Landingpage zeigt die Social-Media-Analyse, das JJ-Media-Mastervideo und den Kalender.

## Unterstützte Importspalten

Der Import erkennt unter anderem:

- `company`, `companyName`, `unternehmen` oder `firma`
- `instagramUrl`, `instagramProfile`, `instagram`, `socialUrl` oder `profileUrl`
- `contact`, `email`, `phone`, `city`

Ältere Dateien mit `websiteUrl` oder `url` werden aus Kompatibilitätsgründen ebenfalls akzeptiert, der Wert muss jetzt jedoch ein Instagram-Profil sein.

## Screenshot-Fallback

Instagram kann automatisierte Server-Browser mit einer Login-Wall blockieren. Deshalb ist der manuelle Screenshot-Fallback bewusst eingebaut. Erlaubt sind JPG, PNG und WebP bis 8 MB. Der Upload wird optimiert und privat in Vercel Blob gespeichert.

## Branding

- Marke: JJ-Media
- Produkt: Social Audit Engine
- Akzent: Instagram-inspiriertes Pink
- Standardangebot: Social Media Wachstumssystem
