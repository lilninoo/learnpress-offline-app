const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const log = require('electron-log');
const { machineIdSync } = require('node-machine-id');
const contextMenu = require('electron-context-menu');
const crypto = require('crypto');
const errorHandler = require('./lib/error-handler');
const config = require('./config');

// Import des modules personnalisés
const LearnPressAPIClient = require('./lib/api-client');
const SecureDatabase = require('./lib/database');
const { setupIpcHandlers } = require('./lib/ipc-handlers');

// Configuration du logging
log.transports.file.level = 'info';
autoUpdater.logger = log;


// ==================== GESTION DES ERREURS GLOBALES ====================

// Capturer les erreurs non gérées
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await errorHandler.handleError(error, { 
        type: 'uncaughtException',
        fatal: true 
    });
    
    // Fermer proprement
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

// ==================== GESTION DES ABONNEMENTS ====================

// Vérifier périodiquement le statut de l'abonnement
let membershipCheckInterval;

function startMembershipCheck() {
    // Vérifier immédiatement
    checkMembershipStatus();
    
    // Puis périodiquement
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
            // Envoyer l'événement au renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('membership-status-changed', {
                    isActive: false,
                    subscription: result.subscription
                });
            }
            
            // Appliquer les restrictions
            applyMembershipRestrictions(result.subscription);
        } else {
            // Abonnement actif - lever les restrictions
            removeMembershipRestrictions();
            
            // Vérifier si l'abonnement expire bientôt
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
        // Ne pas bloquer l'application si la vérification échoue
    }
}

function applyMembershipRestrictions(subscription) {
    // Implémenter les restrictions selon le niveau
    const restrictions = {
        canDownloadPremium: false,
        canSync: false,
        maxCourses: config.membership.freeTierLimits.maxCourses,
        maxDownloadSize: config.membership.freeTierLimits.maxDownloadSize
    };
    
    // Stocker les restrictions
    store.set('membershipRestrictions', restrictions);
    
    // Informer le renderer
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

// ==================== IPC HANDLERS ADDITIONNELS ====================

// Ajouter ces handlers dans setupIpcHandlers
ipcMain.handle('get-membership-restrictions', () => {
    return store.get('membershipRestrictions') || null;
});

ipcMain.handle('check-feature-access', (event, feature) => {
    const restrictions = store.get('membershipRestrictions');
    if (!restrictions) return true;
    
    return config.isFeatureEnabled(feature, { is_active: !restrictions });
});

ipcMain.handle('get-error-logs', () => {
    return errorHandler.getRecentErrors();
});

ipcMain.handle('report-error', async (event, error) => {
    await errorHandler.handleError(error, { source: 'renderer' });
});


// ==================== NETTOYAGE ET MAINTENANCE ====================

// Nettoyer périodiquement
let maintenanceInterval;

function startMaintenance() {
    maintenanceInterval = setInterval(async () => {
        try {
            // Nettoyer la base de données
            if (database) {
                await database.cleanupExpiredData();
                
                // Vérifier l'espace disque
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
            
            // Nettoyer les logs anciens
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
        if (process.platform === 'win32') {
            const { stdout } = await execPromise('wmic logicaldisk get size,freespace,caption');
            // Parser le résultat Windows
            // ...
        } else {
            const { stdout } = await execPromise('df -k .');
            // Parser le résultat Unix
            // ...
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

// ==================== MODIFICATIONS DU CYCLE DE VIE ====================

// Modifier app.whenReady()
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
        
        // Configurer les gestionnaires IPC avec les nouveaux handlers
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

// Modifier app.on('window-all-closed')
app.on('window-all-closed', () => {
    // Arrêter les vérifications
    stopMembershipCheck();
    stopMaintenance();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ==================== DEEP LINKING ====================

function handleDeepLinking() {
    // Gérer le protocole learnpress://
    app.setAsDefaultProtocolClient('learnpress');
    
    // Windows/Linux
    const deeplinkingUrl = process.argv.find((arg) => arg.startsWith('learnpress://'));
    if (deeplinkingUrl) {
        handleDeepLink(deeplinkingUrl);
    }
    
    // Événement pour les liens ouverts quand l'app est déjà lancée
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url) {
    // Parser l'URL
    // learnpress://course/123
    // learnpress://lesson/456
    
    const urlParts = url.replace('learnpress://', '').split('/');
    const type = urlParts[0];
    const id = urlParts[1];
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deep-link', { type, id });
        
        // Mettre la fenêtre au premier plan
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
}


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
    autoSync: { type: 'boolean', default: true }
  }
});

// Variables globales
let mainWindow;
let splashWindow;
let apiClient = null;
let database = null;
const isDev = process.env.NODE_ENV === 'development';
const deviceId = machineIdSync();

// Désactiver la sécurité en dev seulement
if (isDev) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

// Single instance lock
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

// Initialiser la base de données
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

// Fonction pour créer la fenêtre principale
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

  // Charger l'interface
  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  // Menu contextuel
  contextMenu({
    showInspectElement: isDev,
    showSearchWithGoogle: false,
    showCopyImage: true,
    prepend: () => []
  });

  // Empêcher la navigation externe
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Afficher quand prêt
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

  // Gestion de la fermeture
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (database) {
      database.close();
    }
  });

  // DevTools en dev seulement
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// Splash screen
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

// Menu de l'application
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
      label: 'Affichage',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'À propos',
              message: 'LearnPress Offline',
              detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}`,
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

  // macOS specific
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

// Initialisation de l'app
app.whenReady().then(async () => {
  try {
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
      apiClient,
      database,
      app,
      dialog,
      mainWindow,
      getApiClient: () => apiClient,
      setApiClient: (client) => { apiClient = client; },
      getDatabase: () => database
    });
    
    // Vérifier les mises à jour
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  } catch (error) {
    log.error('Erreur lors de l\'initialisation:', error);
    dialog.showErrorBox('Erreur', 'Impossible d\'initialiser l\'application');
    app.quit();
  }
});

// Fermeture sur toutes les fenêtres fermées (sauf macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Réactivation (macOS)
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
    message: 'Une nouvelle version est disponible. Elle sera téléchargée en arrière-plan.',
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
  let log_message = "Vitesse: " + progressObj.bytesPerSecond;
  log_message += ' - Téléchargé ' + progressObj.percent + '%';
  log_message += ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  log.info(log_message);
  
  // Envoyer la progression au renderer
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

// Empêcher l'ouverture de nouvelles fenêtres
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// CSP Headers
app.on('web-contents-created', (event, contents) => {
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
        ]
      }
    });
  });
});

// Export pour les tests
module.exports = { app, store };
