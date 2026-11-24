# Zombiekalypse – Online-Spieltisch

Spieltisch für das Rollenspiel **Zombiekalypse**, aufgebaut wie das Daggerheart-Tool:
eigener kleiner Server, kein Konto nötig. Wer die Adresse öffnet, gibt einmal einen Namen ein (und ggf. den Zugangscode).

## Was die App kann

- **Charaktere anlegen und bearbeiten** nach den aktuellen Regeln (oder per „🎲 Zufallscharakter“ komplett auswürfeln lassen, passend zu einem von 14 Berufen und den gewählten Punktzahlen): vier Attribute, Fertigkeitsliste mit Spezialisierungen,
  Vor- und Nachteile, Waffen und Rüstung (mit Vorlagen aus den Regeltabellen), Inventar, Lernpunkte.
  Eine Übersicht prüft Attribut- und Fertigkeitspunkte und die Erstellungsgrenzen und rechnet Lebenspunkte, Ausdauer und Initiative aus.
- **Import aus Excel**: „Importieren (JSON/Excel)“ liest ein Charakterblatt im Format der Excel-Vorlage (.xlsx) ein: Name, Beruf, Alter,
  Geschlecht, Größe, Herkunft u. Ä., Attribute, Fertigkeiten (unbekannte werden als eigene Fertigkeit übernommen), Vor- und Nachteile
  (±2 = groß, ±1 = klein), Ausrüstung, Waffen, Stresswürfel, Lernpunkte und aktuelle LP/Ausdauer. Die Felder werden über ihre
  Beschriftung gefunden, kleine Verschiebungen im Blatt sind also kein Problem. Danach öffnet sich der Editor zum Prüfen.
- **Spielrunden**: Beim Beitreten wählt jede Person, ob sie als Spieler/in (mit einem ihrer Charaktere) oder als Spielleitung dabei ist. Die Rolle lässt sich jederzeit wechseln, mehrere Spielleitungen sind möglich. Wer die Runde anlegt, muss nicht die Spielleitung sein.
- **Charakterbögen der Gruppe** live für alle sichtbar. Wer den Charakter besitzt, kann LP, Ausdauer und Stresswürfel direkt anpassen
  und Fertigkeiten für die Steigerung markieren. Ein Klick auf Attribut, Fertigkeit oder Waffe im eigenen Bogen übernimmt den Wert in den Würfelautomaten (bei Waffen inkl. Angriffsfertigkeit; Zusatzerfolge wandern automatisch in den Schadenswurf).
- **Whiteboard** für alle: Freihand, Linien, Pfeile, Rechtecke, Ellipsen, Text, Marker (🧟 💀 🚗 …), Farben, Verschieben, Radierer.
  Jeder Charakter hat eine Figur mit Lebenspunkte-Ring; bewegen dürfen sie ihr Besitzer und die Spielleitung. Nur die Spielleitung kann die Fläche leeren.
- **Kampf & Initiative** (Reiter „⚔ Kampf“): Die Spielleitung bereitet einen Kampf vor und trägt Gegner ein (Name, Anzahl, Basiswert,
  wahlweise mit gemeinsamer Initiative für Gruppen). Charaktere fügen sich per Button hinzu. Jede Runde würfeln alle automatisch 2W10 + Basiswert
  (+ Übertrag aus der Vorrunde, Überraschte in Runde 1 nur den Grundwert). Die Liste ist absteigend sortiert; wer oben steht, gibt die Kosten
  seiner Aktion an (0 = abwarten und eine Position nach unten rutschen, X = passen). Bei 0 Punkten passt man automatisch, verteidigen (−2) geht
  immer, auch ins Minus. Haben alle gepasst, beginnt die nächste Runde von selbst.
- **Würfel**: Proben mit Attribut + Fertigkeit, Zustände Ruhe/Normal/Stress/Krise, Stresswürfel einsetzen und Wurf wiederholen,
  Initiative (2W10 + Körper + Willen) und Schaden gegen einen Rüstungswert. Alle Würfe erscheinen im gemeinsamen Protokoll.

Die Regeln in der App folgen dem Regelstand vom 24.11.2026.

## Dateien

| Datei | Zweck |
|---|---|
| `server.js` | Server (reines Node.js, keine Pakete): liefert die Seite aus, speichert die Daten, verteilt Änderungen live (Server-Sent Events) und prüft Schreibrechte |
| `public/index.html` | Die komplette App |
| `public/adapter.js` | Verbindung zwischen Seite und Server |
| `render.yaml` | Konfiguration für Render (Blueprint, kostenloser Plan) |

## Lokal ausprobieren

```bash
node server.js                       # http://localhost:3000
ACCESS_CODE=geheim node server.js    # mit Zugangscode
```

## Auf Render veröffentlichen

1. In Render: **New → Blueprint** → dieses Repository wählen. Render liest `render.yaml` und legt einen kostenlosen Web-Service an.
2. Die Umgebungsvariablen eintragen (siehe „Dauerhafter Speicher“) und bei `ACCESS_CODE` optional einen Zugangscode.
3. Die Adresse (`https://zombiekalypse-xxxx.onrender.com`) mit der Gruppe teilen.

## Dauerhafter Speicher

Ein kostenloser Render-Dienst hat keine Festplatte, die einen Deploy oder Neustart überlebt. Deshalb sichert der Server alles
zusätzlich in einer kostenlosen **Upstash-Redis-Datenbank** und lädt sie beim Start wieder:

1. Auf [upstash.com](https://upstash.com) kostenlos anmelden → **Create Database** (Redis, Region z. B. Frankfurt, Free).
2. In der Datenbank unter **REST API** die Werte `UPSTASH_REDIS_REST_URL` und `UPSTASH_REDIS_REST_TOKEN` kopieren.
3. In Render beim Dienst unter **Environment** beide Variablen eintragen und speichern (Render startet neu).
4. Prüfen: `https://<deine-adresse>/healthz` zeigt `"storage":"extern"`.

Alternativ geht ein bezahlter Render-Plan mit Persistent Disk: `plan: starter`, eine Disk mit Mount Path `/var/data` und `DATA_DIR=/var/data`.

**Zusätzliche Absicherung im Browser:** Jeder Browser hält eine Kopie seiner eigenen Charaktere. Fehlt ein Charakter auf dem Server
(z. B. nach einem Neustart ohne externen Speicher), lädt die App ihn beim nächsten Öffnen automatisch wieder hoch. Absichtlich
gelöschte Charaktere bleiben gelöscht. Spielrunden, Whiteboard und Würfelprotokoll sind nur mit externem Speicher oder Disk dauerhaft.

## Wachhalten

Kostenlose Render-Dienste schlafen nach 15 Minuten ohne Anfragen ein. Solange mindestens eine Person die Seite offen hat,
meldet sich die Seite alle 10 Minuten beim Server, und der Server ruft sich zusätzlich alle 10 Minuten über seine öffentliche
Adresse selbst auf (`RENDER_EXTERNAL_URL`, setzt Render automatisch). Schließen alle den Tisch, hört der Ping nach spätestens
15 Minuten auf und der Dienst darf einschlafen. Beim nächsten Aufruf wacht er nach etwa einer Minute wieder auf.

## Rechte

- Jeder Browser bekommt eine zufällige Kennung mit geheimem Schlüssel; der Server speichert nur dessen Hash.
- Charaktere kann nur ihr Besitzer ändern. Lesen dürfen alle (damit die Gruppe die Bögen sieht).
- Den Namen einer Runde ändern Ersteller und Spielleitung. Die eigene Teilnahme (Rolle, Charakter) ändert jede Person selbst; entfernen können Ersteller und Spielleitung.
- Whiteboard, Figuren und Würfelprotokoll dürfen alle Teilnehmenden ändern.

Daten liegen in `db.json` und `users.json` im Datenordner (und, falls eingerichtet, im externen Speicher). Bitte nur eine Instanz betreiben.
