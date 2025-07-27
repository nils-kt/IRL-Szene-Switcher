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
        this.lastBitrateState = null; // Zur Vermeidung unnötiger Bitrate-Warnungen
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
            logLevel: 'info',
            bitrateMonitoring: {
                enabled: false,
                threshold: 1.0,
                sourceName: 'Low Bitrate Warning',
                connectionType: 'publish'
            }
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
                
                // Bitrate-Informationen zurückgeben wenn Monitoring aktiviert
                if (this.config.bitrateMonitoring.enabled) {
                    const targetConnection = this.config.bitrateMonitoring.connectionType === 'publish' 
                        ? publishConnection 
                        : connections.find(conn => conn.state === this.config.bitrateMonitoring.connectionType);
                    
                    if (targetConnection) {
                        const bitrate = targetConnection.mbpsSendRate || 0;
                        console.log(`📊 Bitrate (${this.config.bitrateMonitoring.connectionType}): ${bitrate.toFixed(2)} Mbps`);
                        return { hasPublish: true, bitrate: bitrate };
                    }
                }
                
                return { hasPublish: true, bitrate: null };
            } else {
                console.log('❌ Keine aktive Publish-Verbindung gefunden');
                console.log('   Verfügbare Verbindungen:');
                connections.forEach((conn, index) => {
                    console.log(`   ${index + 1}. ID: ${conn.id || 'unknown'}, State: ${conn.state || 'unknown'}, Bitrate: ${(conn.mbpsSendRate || 0).toFixed(2)} Mbps`);
                });
                return { hasPublish: false, bitrate: null };
            }

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.error('❌ Kann SRT-API nicht erreichen - Server läuft nicht auf Port 9997');
            } else if (error.code === 'ETIMEDOUT') {
                console.error('❌ Timeout beim Abrufen der SRT-Verbindungen');
            } else {
                console.error('❌ Fehler beim Abrufen der SRT-Verbindungen:', error.message);
            }
            return { hasPublish: false, bitrate: null };
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

    async setSourceVisibility(sourceName, visible) {
        if (!this.isConnectedToOBS) {
            console.log('⚠️  Kann Quelle nicht steuern - nicht mit OBS verbunden');
            return false;
        }

        try {
            // Versuche zuerst die aktuelle Szene zu ermitteln
            const currentScene = await this.obs.call('GetCurrentProgramScene');
            const sceneName = currentScene.currentProgramSceneName;

            console.log(`${visible ? '👁️' : '🚫'} ${visible ? 'Zeige' : 'Verstecke'} Quelle "${sourceName}" in Szene "${sceneName}"`);
            
            await this.obs.call('SetSceneItemEnabled', {
                sceneName: sceneName,
                sceneItemId: await this.getSceneItemId(sceneName, sourceName),
                sceneItemEnabled: visible
            });
            
            console.log(`✅ Quelle "${sourceName}" ${visible ? 'angezeigt' : 'ausgeblendet'}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Fehler beim ${visible ? 'Anzeigen' : 'Ausblenden'} der Quelle "${sourceName}":`, error.message);
            
            if (error.message.includes('No source')) {
                console.error(`   Quelle "${sourceName}" existiert nicht in der aktuellen Szene`);
                await this.listAvailableSources();
            }
            return false;
        }
    }

    async getSceneItemId(sceneName, sourceName) {
        try {
            const sceneItems = await this.obs.call('GetSceneItemList', {
                sceneName: sceneName
            });

            const item = sceneItems.sceneItems.find(item => 
                item.sourceName === sourceName
            );

            if (!item) {
                throw new Error(`Quelle "${sourceName}" nicht in Szene "${sceneName}" gefunden`);
            }

            return item.sceneItemId;
        } catch (error) {
            throw new Error(`Konnte Scene Item ID nicht ermitteln: ${error.message}`);
        }
    }

    async listAvailableSources() {
        try {
            const currentScene = await this.obs.call('GetCurrentProgramScene');
            const sceneName = currentScene.currentProgramSceneName;
            const sceneItems = await this.obs.call('GetSceneItemList', {
                sceneName: sceneName
            });

            console.log(`   Verfügbare Quellen in Szene "${sceneName}":`);
            sceneItems.sceneItems.forEach((item, index) => {
                console.log(`   ${index + 1}. ${item.sourceName} (${item.sceneItemEnabled ? 'sichtbar' : 'ausgeblendet'})`);
            });
        } catch (error) {
            console.error('   Konnte Quellen nicht abrufen:', error.message);
        }
    }

    async performCheck() {
        const result = await this.checkSRTConnections();
        const hasPublishConnection = result.hasPublish;
        const currentBitrate = result.bitrate;
        
        // Szenen-Management: Nur Aktion ausführen wenn sich der Status geändert hat
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

        // Bitrate-Monitoring: Nur wenn aktiviert und Live-Verbindung vorhanden
        if (this.config.bitrateMonitoring.enabled && hasPublishConnection && currentBitrate !== null) {
            const isLowBitrate = currentBitrate < this.config.bitrateMonitoring.threshold;
            
            // Nur Aktion ausführen wenn sich der Bitrate-Status geändert hat
            if (this.lastBitrateState !== isLowBitrate) {
                if (isLowBitrate) {
                    console.log(`📉 Niedrige Bitrate erkannt (${currentBitrate.toFixed(2)} < ${this.config.bitrateMonitoring.threshold} Mbps) - zeige Warning`);
                    await this.setSourceVisibility(this.config.bitrateMonitoring.sourceName, true);
                } else {
                    console.log(`📈 Bitrate OK (${currentBitrate.toFixed(2)} >= ${this.config.bitrateMonitoring.threshold} Mbps) - verstecke Warning`);
                    await this.setSourceVisibility(this.config.bitrateMonitoring.sourceName, false);
                }
                this.lastBitrateState = isLowBitrate;
            } else if (this.config.logLevel === 'debug') {
                console.log(`🔍 Bitrate unverändert: ${currentBitrate.toFixed(2)} Mbps (${isLowBitrate ? 'niedrig' : 'OK'})`);
            }
        }

        // Warning verstecken wenn keine Live-Verbindung
        if (this.config.bitrateMonitoring.enabled && !hasPublishConnection && this.lastBitrateState !== null) {
            console.log('⚫ Offline - verstecke Bitrate-Warning');
            await this.setSourceVisibility(this.config.bitrateMonitoring.sourceName, false);
            this.lastBitrateState = null;
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
        
        if (this.config.bitrateMonitoring.enabled) {
            console.log('📊 Bitrate-Monitoring:');
            console.log(`   📉 Threshold: ${this.config.bitrateMonitoring.threshold} Mbps`);
            console.log(`   🎯 Quelle: "${this.config.bitrateMonitoring.sourceName}"`);
            console.log(`   🔗 Verbindungstyp: ${this.config.bitrateMonitoring.connectionType}`);
        } else {
            console.log('📊 Bitrate-Monitoring: Deaktiviert');
        }
        
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