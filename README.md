# OBS Scene Switcher

Ein Node.js Script, das automatisch Szenen in OBS Studio wechselt, basierend auf dem Status von SRT-Verbindungen.

## Funktionalität

Das Script:
- Überprüft regelmäßig die SRT-Verbindungen über eine API (`http://localhost:9997/v3/srtconns/list`)
- Sucht nach einer Verbindung mit dem Status `"state": "publish"`
- Wechselt automatisch zwischen zwei Szenen in OBS Studio:
  - **Live-Szene**: Wenn eine aktive Publish-Verbindung gefunden wird
  - **Fallback-Szene**: Wenn keine aktive Publish-Verbindung vorhanden ist
- **Bitrate-Monitoring** (optional): Überwacht die Bitrate und blendet eine konfigurierbare Quelle ein/aus:
  - **Quelle anzeigen**: Bei Bitrate unter dem konfigurierten Schwellenwert (z.B. "Low Bitrate" Text)
  - **Quelle ausblenden**: Bei Bitrate über dem Schwellenwert

## Voraussetzungen

1. **Node.js** (Version 14 oder höher)
2. **OBS Studio** mit aktiviertem WebSocket Server Plugin
3. **SRT Server/Service** der auf Port 9997 läuft

## Installation

1. Dependencies installieren:
```bash
npm install
```

## Konfiguration

### OBS Studio Setup

1. Öffnen Sie OBS Studio
2. Gehen Sie zu `Tools` → `WebSocket Server Settings`
3. Aktivieren Sie `Enable WebSocket server`
4. Notieren Sie sich Port (Standard: 4455) und Passwort (falls gesetzt)
5. Erstellen Sie zwei Szenen:
   - **Live-Szene** (z.B. "Live") - wird angezeigt wenn SRT-Stream aktiv ist
   - **Fallback-Szene** (z.B. "Offline") - wird angezeigt wenn kein Stream vorhanden ist
6. **Für Bitrate-Monitoring (optional):**
   - Erstellen Sie eine Text-Quelle in Ihrer Live-Szene (z.B. "Low Bitrate Warning")
   - Gestalten Sie diese als Warning-Overlay (rote Schrift, auffälliger Hintergrund)
   - Text könnte sein: "⚠️ NIEDRIGE BITRATE" oder "📶 CONNECTION ISSUE"
   - Positionieren Sie die Quelle an gewünschter Stelle (z.B. obere Ecke)
   - Die Quelle wird automatisch ein-/ausgeblendet basierend auf der Bitrate

### Script Konfiguration

Bearbeiten Sie die Datei `config.json`:

```json
{
  "srtApiUrl": "http://localhost:9997/v3/srtconns/list",
  "obsHost": "localhost",
  "obsPort": 4455,
  "obsPassword": "",
  "checkInterval": 1000,
  "liveScene": "Live",
  "fallbackScene": "Offline",
  "logLevel": "info",
  "bitrateMonitoring": {
    "enabled": false,
    "threshold": 1.0,
    "sourceName": "Low Bitrate Warning",
    "connectionType": "publish"
  }
}
```

Die `config.json` wird automatisch mit Standardwerten erstellt, wenn sie nicht existiert.

**Wichtige Einstellungen:**
- `obsPassword`: Lassen Sie dies leer, wenn kein Passwort in OBS gesetzt ist
- `liveScene`: Name der Szene die aktiviert wird wenn eine Publish-Verbindung aktiv ist
- `fallbackScene`: Name der Szene die aktiviert wird wenn keine Publish-Verbindung vorhanden ist
- `checkInterval`: Intervall in Millisekunden (1000 = 1 Sekunde)
- **Beide Szenen müssen exakt dem Namen existierender Szenen in OBS entsprechen**

**Bitrate-Monitoring Einstellungen:**
- `enabled`: Aktiviert/Deaktiviert das Bitrate-Monitoring
- `threshold`: Bitrate-Schwellenwert in Mbps (z.B. 1.0 = unter 1 Mbps zeigt Warning)
- `sourceName`: Name der OBS-Quelle die ein-/ausgeblendet werden soll (z.B. "Low Bitrate Warning")
- `connectionType`: Welche Verbindung überwacht werden soll ("publish" oder "read")

## Verwendung

Script starten:
```bash
npm start
```

Oder direkt mit Node.js:
```bash
node index.js
```

### Ausgabe verstehen

Das Script gibt detaillierte Informationen aus:
- ✅ Erfolgreiche Aktionen
- ❌ Fehler und Probleme  
- 🔄 Laufende Überprüfungen
- 🔴 Live-Status und Wechsel zur Live-Szene
- ⚫ Offline-Status und Wechsel zur Fallback-Szene
- 📊 Gefundene SRT-Verbindungen mit Bitrate-Informationen
- 📉 Bitrate-Warnungen und Quellen-Steuerung (falls aktiviert)
- 👁️ Ein-/Ausblenden von OBS-Quellen

### Script beenden

Drücken Sie `Ctrl+C` um das Script sauber zu beenden.

## Fehlerbehebung

### "Kann SRT-API nicht erreichen"
- Überprüfen Sie, ob der SRT-Service auf Port 9997 läuft
- Testen Sie die URL manuell: `http://localhost:9997/v3/srtconns/list`

### "Fehler beim Verbinden mit OBS Studio"
- Stellen Sie sicher, dass OBS Studio läuft
- Überprüfen Sie die WebSocket Server Einstellungen in OBS
- Verifizieren Sie Port und Passwort in der Script-Konfiguration

### "Szene existiert nicht in OBS"
- Das Script zeigt verfügbare Szenen an
- Stellen Sie sicher, dass der Name in `fallbackScene` exakt übereinstimmt
- Beachten Sie Groß-/Kleinschreibung

### "Quelle existiert nicht in der aktuellen Szene"
- Das Script zeigt verfügbare Quellen in der aktuellen Szene an
- Stellen Sie sicher, dass die Bitrate-Warning-Quelle in der Live-Szene existiert
- Der Name in `sourceName` muss exakt mit der OBS-Quelle übereinstimmen
- Die Quelle muss als Scene Item in der entsprechenden Szene vorhanden sein

### Bitrate-Monitoring funktioniert nicht
- Überprüfen Sie, dass `enabled: true` in der bitrateMonitoring Konfiguration gesetzt ist
- Vergewissern Sie sich, dass eine aktive Publish-Verbindung vorhanden ist
- Kontrollieren Sie den `threshold` Wert (z.B. 1.0 für 1 Mbps)
- Prüfen Sie den `connectionType` - "publish" oder "read" je nach gewünschter Überwachung

### OBS WebSocket Plugin fehlt
Für OBS Studio 28+:
- Das WebSocket Plugin ist bereits integriert
- Gehen Sie zu Tools → WebSocket Server Settings

Für ältere OBS Versionen:
- Installieren Sie das obs-websocket Plugin
- Download: https://github.com/obsproject/obs-websocket/releases

## Beispiel-Ausgaben

### Normale Szenen-Umschaltung:
```
🔴 Live: Publish-Verbindung aktiv - wechsle zu Live-Szene
🎬 Wechsle zu Live-Szene: "Live"
✅ Szene erfolgreich gewechselt
```

### Bitrate-Monitoring aktiviert:
```
📊 Bitrate (publish): 0.85 Mbps
📉 Niedrige Bitrate erkannt (0.85 < 1.00 Mbps) - zeige Warning
👁️ Zeige Quelle "Low Bitrate Warning" in Szene "Live"
✅ Quelle "Low Bitrate Warning" angezeigt

📊 Bitrate (publish): 1.25 Mbps  
📈 Bitrate OK (1.25 >= 1.00 Mbps) - verstecke Warning
🚫 Verstecke Quelle "Low Bitrate Warning" in Szene "Live"
✅ Quelle "Low Bitrate Warning" ausgeblendet
```

## Beispiel API-Response

Die SRT-API sollte folgendes Format zurückgeben:
```json
{
  "itemCount": 2,
  "pageCount": 1,
  "items": [
    {
      "id": "connection_1",
      "state": "publish",
      "created": "2024-01-01T12:00:00Z",
      "mbpsSendRate": 1.25
    },
    {
      "id": "connection_2", 
      "state": "read",
      "created": "2024-01-01T11:30:00Z",
      "mbpsSendRate": 0.85
    }
  ]
}
```

## Lizenz

MIT 