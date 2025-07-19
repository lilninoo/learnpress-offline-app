const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const log = require('electron-log');
const { machineIdSync } = require('node-machine-id');
const contextMenu = require('electron-context-menu');
const crypto = require('crypto');

// Import des modules personnalisés
const LearnPressAPIClient = require('./lib/api-client');
const SecureDatabase = require('./lib/database');
const { setupIpcHandlers } = require('./lib/ipc-handlers');
const errorHandler = require('./lib/error-handler');
const config = require('./config');

// Configuration du logging
log.transports.file.level = config.logging.level;
log.transports.file.maxSize = config.logging.maxFileSize;
autoUpdater.logger = log;

// ==================== GESTION DES ERREURS GLOBALES ====================

process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await errorHandler.handleError(error, { 
        type: 'uncaughtException',
        fatal: true 
    });
    
    if (database) {
        database.close();
    }
    
    app.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await errorHandler.handleError(new Error(reason), { 
        type: 'unhandledRejection',
        promise 
    });
});

// ==================== VARIABLES GLOBALES ====================

let mainWindow = null;
let splashWindow = null;
let apiClient = null;
let database = null;
let membershipCheckInterval = null;
let maintenanceInterval = null;

const isDev = process.env.NODE_ENV === 'development';
const deviceId = machineIdSync();

// Générer ou récupérer une clé de chiffrement sécurisée
function getOrCreateEncryptionKey() {
    const keyFile = path.join(app.getPath('userData'), '.key');
    
    if (fs.existsSync(keyFile)) {
        return fs.readFileSync(keyFile, 'utf8');
    } else {
        const key = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(keyFile, key, { mode: 0o600 });
        return key;
    }
}

// Store sécurisé pour les données sensibles
const store = new Store({
    encryptionKey: getOrCreateEncryptionKey(),
    schema: {
        apiUrl: { type: 'string', default: '' },
        token: { type: 'string', default: '' },
        refreshToken: { type: 'string', default: '' },
        userId: { type: 'number', default: 0 },
        username: { type: 'string', default: '' },
        savedApiUrl: { type: 'string', default: '' },
        savedUsername: { type: 'string', default: '' },
        lastSync: { type: 'string', default: '' },
        autoSync: { type: 'boolean', default: true },
        theme: { type: 'string', default: 'auto' },
        language: { type: 'string', default: 'fr' },
        membershipRestrictions: { type: 'object', default: {} }
    }
});

// ==================== GESTION DES ABONNEMENTS ====================

function startMembershipCheck() {
    checkMembershipStatus();
    
    membershipCheckInterval = setInterval(async () => {
        await checkMembershipStatus();
    }, config.membership.checkInterval);
}

function stopMembershipCheck() {
    if (membershipCheckInterval) {
        clearInterval(membershipCheckInterval);
        membershipCheckInterval = null;
    }
}

async function checkMembershipStatus() {
    if (!apiClient) return;
    
    try {
        const result = await apiClient.verifySubscription();
        
        if (!result.success || !result.isActive) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('membership-status-changed', {
                    isActive: false,
                    subscription: result.subscription
                });
            }
            
            applyMembershipRestrictions(result.subscription);
        } else {
            removeMembershipRestrictions();
            
            if (result.subscription.expires_at) {
                const expiresAt = new Date(result.subscription.expires_at);
                const daysUntilExpiry = Math.floor((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
                
                if (daysUntilExpiry <= config.membership.warningDays && daysUntilExpiry > 0) {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('membership-expiring-soon', {
                            daysLeft: daysUntilExpiry,
                            expiresAt: result.subscription.expires_at
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'abonnement:', error);
    }
}

function applyMembershipRestrictions(subscription) {
    const restrictions = {
        canDownloadPremium: false,
        canSync: false,
        maxCourses: config.membership.freeTierLimits.maxCourses,
        maxDownloadSize: config.membership.freeTierLimits.maxDownloadSize
    };
    
    store.set('membershipRestrictions', restrictions);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('apply-restrictions', restrictions);
    }
}

function removeMembershipRestrictions() {
    store.delete('membershipRestrictions');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remove-restrictions');
    }
}

// ==================== NETTOYAGE ET MAINTENANCE ====================

function startMaintenance() {
    maintenanceInterval = setInterval(async () => {
        try {
            if (database) {
                await database.cleanupExpiredData();
                
                const stats = await database.getStats();
                const diskSpace = await checkDiskSpace();
                
                if (diskSpace.free < 1024 * 1024 * 1024) { // Moins de 1GB
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('low-disk-space', {
                            free: diskSpace.free,
                            used: diskSpace.used
                        });
                    }
                }
            }
            
            cleanOldLogs();
            
        } catch (error) {
            console.error('Erreur lors de la maintenance:', error);
        }
    }, config.storage.cleanupInterval);
}

function stopMaintenance() {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = null;
    }
}

async function checkDiskSpace() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    try {
        const userDataPath = app.getPath('userData');
        
        if (process.platform === 'win32') {
            const drive = path.parse(userDataPath).root;
            const { stdout } = await execPromise(`wmic logicaldisk where caption="${drive.replace('\\', '')}" get size,freespace`);
            const lines = stdout.trim().split('\n');
            if (lines.length >= 2) {
                const values = lines[1].trim().split(/\s+/);
                return {
                    free: parseInt(values[0]) || 0,
                    total: parseInt(values[1]) || 0,
                    used: (parseInt(values[1]) || 0) - (parseInt(values[0]) || 0)
                };
            }
        } else {
            const { stdout } = await execPromise(`df -k "${userDataPath}" | tail -1`);
            const parts = stdout.trim().split(/\s+/);
            return {
                total: parseInt(parts[1]) * 1024,
                used: parseInt(parts[2]) * 1024,
                free: parseInt(parts[3]) * 1024
            };
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'espace disque:', error);
        return { free: 0, used: 0, total: 0 };
    }
}

function cleanOldLogs() {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 jours
    
    fs.readdir(logsDir, (err, files) => {
        if (err) return;
        
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                
                if (Date.now() - stats.mtime.getTime() > maxAge) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Erreur lors de la suppression du log:', err);
                    });
                }
            });
        });
    });
}

// ==================== INITIALISATION ====================

async function initializeDatabase() {
    try {
        const dbPath = path.join(app.getPath('userData'), 'database', 'courses.db');
        const encryptionKey = getOrCreateEncryptionKey();
        database = new SecureDatabase(dbPath, encryptionKey);
        log.info('Base de données initialisée');
    } catch (error) {
        log.error('Erreur lors de l\'initialisation de la base de données:', error);
        throw error;
    }
}

// ==================== CRÉATION DES FENÊTRES ====================

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 600,
        height: 400,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    splashWindow.loadFile(path.join(__dirname, 'src/splash.html'));
    
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        show: false,
        icon: path.join(__dirname, 'assets/icons/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: !isDev
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    });

    mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

    contextMenu({
        showInspectElement: isDev,
        showSearchWithGoogle: false,
        showCopyImage: true,
        prepend: () => []
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.once('ready-to-show', () => {
        if (splashWindow) {
            setTimeout(() => {
                splashWindow.close();
                mainWindow.show();
            }, 1500);
        } else {
            mainWindow.show();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (database) {
            database.close();
        }
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

function createMenu() {
    const template = [
        {
            label: 'Fichier',
            submenu: [
                {
                    label: 'Synchroniser',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('sync-courses');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Paramètres',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        mainWindow.webContents.send('open-settings');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Déconnexion',
                    click: () => {
                        mainWindow.webContents.send('logout');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quitter',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Édition',
            submenu: [
                { role: 'undo', label: 'Annuler' },
                { role: 'redo', label: 'Rétablir' },
                { type: 'separator' },
                { role: 'cut', label: 'Couper' },
                { role: 'copy', label: 'Copier' },
                { role: 'paste', label: 'Coller' },
                { role: 'selectall', label: 'Tout sélectionner' }
            ]
        },
        {
            label: 'Affichage',
            submenu: [
                { role: 'reload', label: 'Recharger' },
                { role: 'forcereload', label: 'Forcer le rechargement' },
                { type: 'separator' },
                { role: 'resetzoom', label: 'Réinitialiser le zoom' },
                { role: 'zoomin', label: 'Zoom avant' },
                { role: 'zoomout', label: 'Zoom arrière' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Plein écran' }
            ]
        },
        {
            label: 'Aide',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        shell.openExternal('https://docs.votre-site.com');
                    }
                },
                {
                    label: 'Support',
                    click: () => {
                        shell.openExternal('https://support.votre-site.com');
                    }
                },
                { type: 'separator' },
                {
                    label: 'À propos',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'À propos',
                            message: 'LearnPress Offline',
                            detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}`,
                            buttons: ['OK']
                        });
                    }
                },
                {
                    label: 'Vérifier les mises à jour',
                    click: () => {
                        autoUpdater.checkForUpdatesAndNotify();
                    }
                }
            ]
        }
    ];

    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services', submenu: [] },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        });
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ==================== DEEP LINKING ====================

function handleDeepLinking() {
    app.setAsDefaultProtocolClient('learnpress');
    
    const deeplinkingUrl = process.argv.find((arg) => arg.startsWith('learnpress://'));
    if (deeplinkingUrl) {
        handleDeepLink(deeplinkingUrl);
    }
    
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url) {
    const urlParts = url.replace('learnpress://', '').split('/');
    const type = urlParts[0];
    const id = urlParts[1];
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deep-link', { type, id });
        
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
}

// ==================== IPC HANDLERS ADDITIONNELS ====================

function setupAdditionalIpcHandlers() {
    // Handlers pour les abonnements
    ipcMain.handle('get-membership-restrictions', () => {
        return store.get('membershipRestrictions') || null;
    });

    ipcMain.handle('check-feature-access', (event, feature) => {
        const restrictions = store.get('membershipRestrictions');
        if (!restrictions) return true;
        
        return config.isFeatureEnabled(feature, { is_active: !restrictions });
    });

    // Handlers pour les logs et erreurs
    ipcMain.handle('get-error-logs', () => {
        return errorHandler.getRecentErrors();
    });

    ipcMain.handle('report-error', async (event, error) => {
        await errorHandler.handleError(error, { source: 'renderer' });
    });

    ipcMain.handle('save-log', async (event, logEntry) => {
        try {
            const logsDir = path.join(app.getPath('userData'), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            
            const logFile = path.join(logsDir, `renderer-${new Date().toISOString().split('T')[0]}.log`);
            const logLine = `${logEntry.timestamp} [${logEntry.level}] ${logEntry.message}\n`;
            
            fs.appendFileSync(logFile, logLine);
            return { success: true };
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du log:', error);
            return { success: false, error: error.message };
        }
    });

    // Handlers pour les notifications
    ipcMain.handle('show-notification', (event, options) => {
        if (Notification.isSupported()) {
            const notification = new Notification({
                title: options.title || 'LearnPress Offline',
                body: options.body,
                icon: path.join(__dirname, 'assets/icons/icon.png'),
                silent: options.silent || false
            });
            
            notification.on('click', () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                }
            });
            
            notification.show();
        }
    });

    // Handler pour l'export PDF
    ipcMain.handle('export-certificate-pdf', async (event, certificateData) => {
        try {
            // Ici on pourrait utiliser une librairie comme PDFKit
            // Pour l'instant, on retourne une erreur
            return { 
                success: false, 
                error: 'Fonctionnalité en cours de développement' 
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

// ==================== SINGLE INSTANCE ====================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(async () => {
    try {
        // Valider la configuration
        config.validate();
        
        // Initialiser la base de données
        await initializeDatabase();
        
        // Créer les fenêtres
        createSplashWindow();
        createMainWindow();
        createMenu();
        
        // Configurer les gestionnaires IPC
        setupIpcHandlers(ipcMain, {
            store,
            deviceId,
            app,
            dialog,
            mainWindow,
            getApiClient: () => apiClient,
            setApiClient: (client) => { 
                apiClient = client;
                if (client) {
                    startMembershipCheck();
                } else {
                    stopMembershipCheck();
                }
            },
            getDatabase: () => database,
            errorHandler,
            config
        });
        
        // Ajouter les handlers supplémentaires
        setupAdditionalIpcHandlers();
        
        // Démarrer la maintenance
        startMaintenance();
        
        // Vérifier les mises à jour
        if (!isDev && config.updates.autoCheck) {
            autoUpdater.checkForUpdatesAndNotify();
        }
        
        // Gérer le deep linking
        handleDeepLinking();
        
    } catch (error) {
        log.error('Erreur lors de l\'initialisation:', error);
        await errorHandler.handleError(error, { 
            type: 'initialization',
            fatal: true 
        });
        app.quit();
    }
});

app.on('window-all-closed', () => {
    stopMembershipCheck();
    stopMaintenance();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// ==================== AUTO UPDATER ====================

autoUpdater.on('checking-for-update', () => {
    log.info('Vérification des mises à jour...');
});

autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Mise à jour disponible',
        message: `Une nouvelle version (${info.version}) est disponible. Elle sera téléchargée en arrière-plan.`,
        buttons: ['OK']
    });
});

autoUpdater.on('update-not-available', () => {
    log.info('Aucune mise à jour disponible.');
});

autoUpdater.on('error', (err) => {
    log.error('Erreur lors de la mise à jour:', err);
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
        mainWindow.webContents.send('update-progress', progressObj);
    }
});

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Mise à jour prête',
        message: 'La mise à jour a été téléchargée. L\'application va redémarrer.',
        buttons: ['Redémarrer maintenant', 'Plus tard']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

// ==================== SÉCURITÉ ====================

app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
        shell.openExternal(navigationUrl);
    });
    
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' file:; font-src 'self' data:;"
                ]
            }
        });
    });
});

// Désactiver la sécurité en dev seulement
if (isDev) {
    app.commandLine.appendSwitch('ignore-certificate-errors');
}

// Export pour les tests
module.exports = { app, store };
