// config/index.js - Configuration centralisée de l'application
const path = require('path');
const { app } = require('electron');

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

const config = {
    // Environnement
    env: process.env.NODE_ENV || 'production',
    isDev,
    isTest,
    isProduction: !isDev && !isTest,
    
    // Application
    app: {
        name: 'LearnPress Offline',
        version: app?.getVersion() || '1.0.0',
        id: 'com.teachmemore.learnpress-offline',
        protocol: 'learnpress',
        userAgent: `LearnPressOffline/${app?.getVersion() || '1.0.0'}`
    },
    
    // Chemins
    paths: {
        userData: app?.getPath('userData') || path.join(__dirname, '..', 'userData'),
        database: path.join(app?.getPath('userData') || '.', 'database'),
        courses: path.join(app?.getPath('userData') || '.', 'courses'),
        media: path.join(app?.getPath('userData') || '.', 'media'),
        logs: path.join(app?.getPath('userData') || '.', 'logs'),
        temp: path.join(app?.getPath('userData') || '.', 'temp'),
        cache: path.join(app?.getPath('userData') || '.', 'cache')
    },
    
    // Base de données
    database: {
        filename: 'courses.db',
        options: {
            verbose: isDev ? console.log : null,
            fileMustExist: false,
            timeout: 5000
        }
    },
    
    // API
    api: {
        timeout: 30000, // 30 secondes
        retryAttempts: 3,
        retryDelay: 1000, // 1 seconde
        namespace: 'col-lms/v1',
        endpoints: {
            auth: {
                login: '/auth/login',
                refresh: '/auth/refresh',
                verify: '/auth/verify',
                logout: '/auth/logout'
            },
            courses: {
                list: '/courses',
                details: '/courses/:id',
                package: '/courses/:id/package',
                media: '/courses/:id/media'
            },
            lessons: {
                content: '/lessons/:id/content'
            },
            progress: {
                sync: '/progress/sync'
            },
            packages: {
                status: '/packages/:id/status'
            }
        }
    },
    
    // Sécurité
    security: {
        algorithm: 'aes-256-gcm',
        keyLength: 32,
        saltLength: 32,
        iterations: 100000,
        tokenExpiry: 3600, // 1 heure
        refreshTokenExpiry: 604800, // 7 jours
        maxLoginAttempts: 5,
        lockoutDuration: 900 // 15 minutes
    },
    
    // Synchronisation
    sync: {
        autoSync: true,
        syncInterval: 1800000, // 30 minutes
        batchSize: 100,
        retryDelay: 60000, // 1 minute
        maxRetries: 3
    },
    
    // Téléchargement
    download: {
        maxConcurrent: 2,
        chunkSize: 1048576, // 1 MB
        resumable: true,
        timeout: 300000, // 5 minutes par fichier
        retryAttempts: 3,
        defaultOptions: {
            includeVideos: true,
            includeDocuments: true,
            compressImages: true,
            encryptionEnabled: true
        }
    },
    
    // Stockage
    storage: {
        maxCourseAge: 2592000000, // 30 jours en ms
        maxCacheSize: 1073741824, // 1 GB
        cleanupInterval: 86400000, // 24 heures
        compressionLevel: 6 // 0-9
    },
    
    // Lecteur vidéo
    player: {
        saveProgressInterval: 5000, // 5 secondes
        seekStep: 10, // secondes
        playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
        defaultPlaybackRate: 1,
        resumePlayback: true
    },
    
    // Interface utilisateur
    ui: {
        theme: 'auto', // auto, light, dark
        language: 'fr',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: 'HH:mm',
        animations: true,
        compactMode: false
    },
    
    // Logs
    logging: {
        level: isDev ? 'debug' : 'info',
        maxFiles: 5,
        maxFileSize: 10485760, // 10 MB
        format: isDev ? 'pretty' : 'json'
    },
    
    // Mises à jour
    updates: {
        autoCheck: true,
        autoDownload: false,
        checkInterval: 14400000, // 4 heures
        channel: isDev ? 'beta' : 'stable'
    },
    
    // Abonnements (Paid Memberships Pro)
    membership: {
        checkInterval: 3600000, // 1 heure
        warningDays: 7, // Avertir 7 jours avant expiration
        restrictedFeatures: [
            'download_premium_courses',
            'offline_sync',
            'advanced_stats'
        ],
        freeTierLimits: {
            maxCourses: 3,
            maxDownloadSize: 536870912, // 500 MB
            syncEnabled: false
        }
    },
    
    // Performances
    performance: {
        lazyLoadImages: true,
        preloadCount: 5,
        maxMemoryUsage: 536870912, // 512 MB
        gcInterval: 300000 // 5 minutes
    },
    
    // Développement
    dev: {
        devTools: isDev,
        hotReload: isDev,
        mockData: false,
        apiDelay: 0,
        offlineMode: false
    }
};

// Fonctions utilitaires
config.getPath = (type) => {
    return config.paths[type] || config.paths.userData;
};

config.getApiUrl = (endpoint, params = {}) => {
    let url = endpoint;
    
    // Remplacer les paramètres
    Object.keys(params).forEach(key => {
        url = url.replace(`:${key}`, params[key]);
    });
    
    return url;
};

config.isFeatureEnabled = (feature, userMembership = null) => {
    if (!config.membership.restrictedFeatures.includes(feature)) {
        return true;
    }
    
    // Vérifier si l'utilisateur a un abonnement actif
    return userMembership && userMembership.is_active;
};

// Validation de la configuration
config.validate = () => {
    const required = ['paths.userData', 'database.filename', 'api.namespace'];
    const errors = [];
    
    required.forEach(path => {
        const keys = path.split('.');
        let value = config;
        
        for (const key of keys) {
            value = value[key];
            if (!value) {
                errors.push(`Configuration manquante: ${path}`);
                break;
            }
        }
    });
    
    if (errors.length > 0) {
        throw new Error(`Erreurs de configuration:\n${errors.join('\n')}`);
    }
    
    return true;
};

// Charger la configuration spécifique à l'environnement
if (isDev) {
    try {
        const devConfig = require('./development');
        Object.assign(config, devConfig);
    } catch (e) {
        // Pas de config dev spécifique
    }
}

// Exporter un objet immutable en production
module.exports = isProduction ? Object.freeze(config) : config;
