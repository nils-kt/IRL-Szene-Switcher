const axios = require('axios');
const OBSWebSocket = require('obs-websocket-js').default;
const fs = require('fs');
const path = require('path');

class SceneSwitcher {
    constructor() {
        // Konfiguration aus externer Datei laden
        this.config = this.loadConfig();

        this.obs = new OBSWebSocket();
        this.isConnectedToOBS = false;
        this.lastPublishState = null; // Zur Vermeidung unnötiger Szenenwechsel
        this.intervalId = null;
    }

    loadConfig() {
        const configPath = path.join(__dirname, 'config.json');
        const defaultConfig = {
            srtApiUrl: 'http://localhost:9997/v3/srtconns/list',
            obsHost: 'localhost',
            obsPort: 4455,
            obsPassword: '',
            checkInterval: 5000,
            liveScene: 'Live',
            fallbackScene: 'Szene ohne Stream',
            logLevel: 'info'
        };

        try {
            if (fs.existsSync(configPath)) {
                const configData = fs.readFileSync(configPath, 'utf8');
                const userConfig = JSON.parse(configData);
                console.log('✅ Konfiguration aus config.json geladen');
                return { ...defaultConfig, ...userConfig };
            } else {
                console.log('⚠️  config.json nicht gefunden, verwende Standard-Konfiguration');
                // Erstelle config.json mit Standardwerten
                fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
                console.log('✅ config.json mit Standardwerten erstellt');
                return defaultConfig;
            }
        } catch (error) {
            console.error('❌ Fehler beim Laden der Konfiguration:', error.message);
            console.log('   Verwende Standard-Konfiguration');
            return defaultConfig;
        }
    }

    async connectToOBS() {
        try {
            console.log(`Verbinde mit OBS Studio auf ${this.config.obsHost}:${this.config.obsPort}...`);
            
            await this.obs.connect(`ws://${this.config.obsHost}:${this.config.obsPort}`, this.config.obsPassword);
            
            this.isConnectedToOBS = true;
            console.log('✅ Erfolgreich mit OBS Studio verbunden');
            
            // Event Listener für Verbindungsunterbrechungen
            this.obs.on('ConnectionClosed', () => {
                console.log('❌ Verbindung zu OBS Studio unterbrochen');
                this.isConnectedToOBS = false;
            });

            this.obs.on('ConnectionError', (error) => {
                console.log('❌ OBS Verbindungsfehler:', error.message);
                this.isConnectedToOBS = false;
            });

        } catch (error) {
            console.error('❌ Fehler beim Verbinden mit OBS Studio:', error.message);
            console.error('   Stellen Sie sicher, dass:');
            console.error('   - OBS Studio läuft');
            console.error('   - WebSocket Server Plugin aktiviert ist');
            console.error('   - Port und Passwort korrekt sind');
            this.isConnectedToOBS = false;
        }
    }

    async checkSRTConnections() {
        try {
            console.log('🔄 Überprüfe SRT-Verbindungen...');
            
            const response = await axios.get(this.config.srtApiUrl, {
                timeout: 3000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'OBS-SceneSwitcher/1.0'
                }
            });

            // Prüfe das API-Antwort Format
            let connections = [];
            
            if (Array.isArray(response.data)) {
                // Direktes Array Format
                connections = response.data;
            } else if (response.data && Array.isArray(response.data.items)) {
                // Objekt mit items Array Format
                connections = response.data.items;
                console.log(`📊 ${response.data.itemCount || connections.length} SRT-Verbindung(en) gefunden (${response.data.pageCount || 1} Seite(n))`);
            } else {
                console.log('⚠️  Unerwartete API-Antwort:', response.data);
                return false;
            }

            if (!Array.isArray(connections)) {
                console.log('❌ Keine gültigen Verbindungsdaten erhalten');
                return false;
            }

            console.log(`📊 ${connections.length} SRT-Verbindung(en) werden überprüft`);

            // Suche nach einer Verbindung mit "state": "publish"
            const publishConnection = connections.find(conn => conn.state === 'publish');
            
            if (publishConnection) {
                console.log('✅ Aktive Publish-Verbindung gefunden:', {
                    id: publishConnection.id || 'unknown',
                    state: publishConnection.state,
                    created: publishConnection.created || 'unknown'
                });
                return true;
            } else {
                console.log('❌ Keine aktive Publish-Verbindung gefunden');
                console.log('   Verfügbare Verbindungen:');
                connections.forEach((conn, index) => {
                    console.log(`   ${index + 1}. ID: ${conn.id || 'unknown'}, State: ${conn.state || 'unknown'}`);
                });
                return false;
            }

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.error('❌ Kann SRT-API nicht erreichen - Server läuft nicht auf Port 9997');
            } else if (error.code === 'ETIMEDOUT') {
                console.error('❌ Timeout beim Abrufen der SRT-Verbindungen');
            } else {
                console.error('❌ Fehler beim Abrufen der SRT-Verbindungen:', error.message);
            }
            return false;
        }
    }

    async switchToScene(sceneName, sceneType) {
        if (!this.isConnectedToOBS) {
            console.log('⚠️  Kann Szene nicht wechseln - nicht mit OBS verbunden');
            return false;
        }

        try {
            console.log(`🎬 Wechsle zu ${sceneType}-Szene: "${sceneName}"`);
            
            await this.obs.call('SetCurrentProgramScene', {
                sceneName: sceneName
            });
            
            console.log('✅ Szene erfolgreich gewechselt');
            return true;
            
        } catch (error) {
            console.error('❌ Fehler beim Szenenwechsel:', error.message);
            
            if (error.message.includes('No source')) {
                console.error(`   Szene "${sceneName}" existiert nicht in OBS`);
                console.error('   Verfügbare Szenen abrufen...');
                
                try {
                    const scenes = await this.obs.call('GetSceneList');
                    console.log('   Verfügbare Szenen:');
                    scenes.scenes.forEach((scene, index) => {
                        console.log(`   ${index + 1}. ${scene.sceneName}`);
                    });
                } catch (sceneError) {
                    console.error('   Konnte Szenen nicht abrufen:', sceneError.message);
                }
            }
            return false;
        }
    }

    async switchToLiveScene() {
        return await this.switchToScene(this.config.liveScene, 'Live');
    }

    async switchToFallbackScene() {
        return await this.switchToScene(this.config.fallbackScene, 'Fallback');
    }

    async performCheck() {
        const hasPublishConnection = await this.checkSRTConnections();
        
        // Nur Aktion ausführen wenn sich der Status geändert hat
        if (this.lastPublishState !== hasPublishConnection) {
            if (hasPublishConnection) {
                console.log('🔴 Live: Publish-Verbindung aktiv - wechsle zu Live-Szene');
                await this.switchToLiveScene();
            } else {
                console.log('🚨 Offline: Keine Publish-Verbindung - wechsle zu Fallback-Szene');
                await this.switchToFallbackScene();
            }
            this.lastPublishState = hasPublishConnection;
        } else {
            console.log(`ℹ️  Status unverändert (${hasPublishConnection ? '🔴 Live' : '⚫ Offline'})`);
        }
        
        console.log('─'.repeat(50));
    }

    async start() {
        console.log('🚀 OBS Scene Switcher gestartet');
        console.log('📋 Konfiguration:');
        console.log(`   SRT API: ${this.config.srtApiUrl}`);
        console.log(`   OBS: ${this.config.obsHost}:${this.config.obsPort}`);
        console.log(`   🔴 Live-Szene: "${this.config.liveScene}"`);
        console.log(`   ⚫ Fallback-Szene: "${this.config.fallbackScene}"`);
        console.log(`   Überprüfungsintervall: ${this.config.checkInterval}ms`);
        console.log('─'.repeat(50));

        // Verbindung zu OBS herstellen
        await this.connectToOBS();

        // Erste Überprüfung
        await this.performCheck();

        // Regelmäßige Überprüfung starten
        this.intervalId = setInterval(async () => {
            await this.performCheck();
        }, this.config.checkInterval);

        console.log('⏰ Automatische Überprüfung gestartet');
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.obs && this.isConnectedToOBS) {
            this.obs.disconnect();
        }

        console.log('🛑 Scene Switcher gestoppt');
    }
}

// Script starten
const sceneSwitcher = new SceneSwitcher();

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutdown Signal empfangen...');
    sceneSwitcher.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminate Signal empfangen...');
    sceneSwitcher.stop();
    process.exit(0);
});

// Script starten
sceneSwitcher.start().catch(error => {
    console.error('❌ Fataler Fehler beim Starten:', error);
    process.exit(1);
}); 