# Zombiekalypse – Online-Spieltisch

Spieltisch für das Rollenspiel **Zombiekalypse**, aufgebaut wie das Daggerheart-Tool:
eigener kleiner Server, kein Konto nötig. Wer die Adresse öffnet, gibt einmal einen Namen ein (und ggf. den Zugangscode).

## Was die App kann

- **Charaktere anlegen und bearbeiten** nach den aktuellen Regeln (oder per „🎲 Zufallscharakter“ komplett auswürfeln lassen, passend zu einem von 14 Berufen und den gewählten Punktzahlen): vier Attribute, Fertigkeitsliste mit Spezialisierungen,
  Vor- und Nachteile, Waffen und Rüstung (mit Vorlagen aus den Regeltabellen), Inventar, Lernpunkte.
  Eine Übersicht prüft Attribut- und Fertigkeitspunkte und die Erstellungsgrenzen und rechnet Lebenspunkte, Ausdauer und Initiative aus.
- **Spielrunden**: Beim Beitreten wählt jede Person, ob sie als Spieler/in (mit einem ihrer Charaktere) oder als Spielleitung dabei ist. Die Rolle lässt sich jederzeit wechseln, mehrere Spielleitungen sind möglich. Wer die Runde anlegt, muss nicht die Spielleitung sein.
- **Charakterbögen der Gruppe** live für alle sichtbar. Wer den Charakter besitzt, kann LP, Ausdauer und Stresswürfel direkt anpassen
  und Fertigkeiten für die Steigerung markieren.
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
| `render.yaml` | Konfiguration für Render (Blueprint) |

## Lokal ausprobieren

```bash
node server.js                       # http://localhost:3000
ACCESS_CODE=geheim node server.js    # mit Zugangscode
```

## Auf Render veröffentlichen

1. In Render: **New → Blueprint** → dieses Repository wählen. Render liest `render.yaml` und legt einen Web-Service
   mit 1 GB dauerhaftem Speicher (`/var/data`) an.
2. Bei `ACCESS_CODE` einen Zugangscode für die Gruppe eintragen oder leer lassen.
3. Die Adresse (`https://zombiekalypse-xxxx.onrender.com`) mit der Gruppe teilen.

Persistent Disks gibt es nur auf bezahlten Instanzen. Auf dem kostenlosen Plan (`plan: free`, `disk`-Block entfernen) läuft die App auch,
aber alle Daten gehen bei jedem Neustart verloren. Charaktere lassen sich jederzeit als JSON exportieren und wieder importieren.

## Rechte

- Jeder Browser bekommt eine zufällige Kennung mit geheimem Schlüssel; der Server speichert nur dessen Hash.
- Charaktere kann nur ihr Besitzer ändern. Lesen dürfen alle (damit die Gruppe die Bögen sieht).
- Den Namen einer Runde ändern Ersteller und Spielleitung. Die eigene Teilnahme (Rolle, Charakter) ändert jede Person selbst; entfernen können Ersteller und Spielleitung.
- Whiteboard, Figuren und Würfelprotokoll dürfen alle Teilnehmenden ändern.

Daten liegen in `db.json` und `users.json` im Datenordner. Bitte nur eine Instanz betreiben.
