// utils.js - Fonctions utilitaires pour l'application

// ==================== FORMATAGE ====================

// Formater la taille de fichier
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Formater la durée
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Formater la date
function formatDate(dateString, format = 'short') {
    const date = new Date(dateString);
    
    if (format === 'short') {
        return date.toLocaleDateString('fr-FR');
    } else if (format === 'long') {
        return date.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } else if (format === 'relative') {
        return formatRelativeTime(date);
    }
    
    return date.toLocaleString('fr-FR');
}

// Formater le temps relatif
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    
    if (seconds < 60) return 'À l\'instant';
    if (seconds < 3600) return `Il y a ${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `Il y a ${Math.floor(seconds / 3600)} heures`;
    if (seconds < 604800) return `Il y a ${Math.floor(seconds / 86400)} jours`;
    
    return formatDate(date, 'short');
}

// ==================== VALIDATION ====================

// Valider une URL
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Valider un email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Valider un mot de passe (au moins 8 caractères)
function isValidPassword(password) {
    return password && password.length >= 8;
}

// ==================== MANIPULATION DOM ====================

// Créer un élément avec attributs et contenu
function createElement(tag, attributes = {}, content = '') {
    const element = document.createElement(tag);
    
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'dataset') {
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                element.dataset[dataKey] = dataValue;
            });
        } else {
            element.setAttribute(key, value);
        }
    });
    
    if (typeof content === 'string') {
        element.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        element.appendChild(content);
    } else if (Array.isArray(content)) {
        content.forEach(child => element.appendChild(child));
    }
    
    return element;
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ==================== STOCKAGE LOCAL ====================

// Gestion du cache local temporaire
const LocalCache = {
    set(key, value, ttl = 3600000) { // TTL par défaut : 1 heure
        const item = {
            value: value,
            expiry: Date.now() + ttl
        };
        sessionStorage.setItem(key, JSON.stringify(item));
    },
    
    get(key) {
        const itemStr = sessionStorage.getItem(key);
        if (!itemStr) return null;
        
        const item = JSON.parse(itemStr);
        if (Date.now() > item.expiry) {
            sessionStorage.removeItem(key);
            return null;
        }
        
        return item.value;
    },
    
    remove(key) {
        sessionStorage.removeItem(key);
    },
    
    clear() {
        sessionStorage.clear();
    }
};

// ==================== GESTION DES ERREURS ====================

// Logger centralisé
const Logger = {
    log(message, data = null) {
        console.log(`[LearnPress] ${message}`, data || '');
    },
    
    warn(message, data = null) {
        console.warn(`[LearnPress] ${message}`, data || '');
    },
    
    error(message, error = null) {
        console.error(`[LearnPress] ${message}`, error || '');
        window.electronAPI.logError({ message, error: error?.toString() });
    },
    
    debug(message, data = null) {
        if (window.DEBUG_MODE) {
            console.debug(`[LearnPress Debug] ${message}`, data || '');
        }
    }
};

// Gestionnaire d'erreurs global
window.addEventListener('error', (event) => {
    Logger.error('Erreur non gérée:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('Promise rejetée:', event.reason);
});

// ==================== ANIMATIONS ====================

// Fade in element
function fadeIn(element, duration = 300) {
    element.style.opacity = 0;
    element.style.display = 'block';
    
    const start = performance.now();
    
    function animate(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        element.style.opacity = progress;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    requestAnimationFrame(animate);
}

// Fade out element
function fadeOut(element, duration = 300) {
    const start = performance.now();
    const initialOpacity = parseFloat(window.getComputedStyle(element).opacity);
    
    function animate(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        
        element.style.opacity = initialOpacity * (1 - progress);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            element.style.display = 'none';
        }
    }
    
    requestAnimationFrame(animate);
}

// ==================== UTILITAIRES DIVERS ====================

// Générer un ID unique
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Deep clone d'un objet
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    
    const clonedObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            clonedObj[key] = deepClone(obj[key]);
        }
    }
    
    return clonedObj;
}

// Trier un tableau d'objets
function sortArray(array, key, order = 'asc') {
    return array.sort((a, b) => {
        if (order === 'asc') {
            return a[key] > b[key] ? 1 : -1;
        } else {
            return a[key] < b[key] ? 1 : -1;
        }
    });
}

// Filtrer un tableau avec plusieurs critères
function filterArray(array, filters) {
    return array.filter(item => {
        return Object.entries(filters).every(([key, value]) => {
            if (value === null || value === undefined || value === '') return true;
            return item[key] === value;
        });
    });
}

// ==================== HELPERS POUR L'APPLICATION ====================

// Calculer l'espace de stockage utilisé
async function calculateStorageUsed() {
    try {
        // Cette fonction devrait idéalement être implémentée côté main process
        // Pour l'instant, retourner une valeur fictive
        return {
            courses: 1024 * 1024 * 245, // 245 MB
            cache: 1024 * 1024 * 50,    // 50 MB
            total: 1024 * 1024 * 295    // 295 MB
        };
    } catch (error) {
        Logger.error('Erreur lors du calcul du stockage:', error);
        return { courses: 0, cache: 0, total: 0 };
    }
}

// Vérifier si un cours est expiré
function isCourseExpired(course) {
    if (!course.expires_at) return false;
    return new Date(course.expires_at) < new Date();
}

// Obtenir l'icône pour un type de fichier
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'mp4': '🎥', 'avi': '🎥', 'mov': '🎥', 'mkv': '🎥',
        'pdf': '📕', 'doc': '📄', 'docx': '📄', 'txt': '📝',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
        'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵',
        'zip': '📦', 'rar': '📦', '7z': '📦',
        'xls': '📊', 'xlsx': '📊', 'csv': '📊'
    };
    
    return icons[ext] || '📎';
}

// Parser les paramètres de l'URL
function parseQueryParams(url) {
    const params = new URLSearchParams(url);
    const result = {};
    
    for (const [key, value] of params) {
        result[key] = value;
    }
    
    return result;
}

// ==================== EXPORTS GLOBAUX ====================

// Exposer les utilitaires globalement
window.Utils = {
    // Formatage
    formatFileSize,
    formatDuration,
    formatDate,
    formatRelativeTime,
    
    // Validation
    isValidUrl,
    isValidEmail,
    isValidPassword,
    
    // DOM
    createElement,
    debounce,
    throttle,
    
    // Cache
    LocalCache,
    
    // Logger
    Logger,
    
    // Animations
    fadeIn,
    fadeOut,
    
    // Divers
    generateId,
    deepClone,
    sortArray,
    filterArray,
    
    // App specific
    calculateStorageUsed,
    isCourseExpired,
    getFileIcon,
    parseQueryParams
};

// Raccourcis globaux
window.log = Logger.log;
window.logError = Logger.error;
window.logWarn = Logger.warn;
window.logDebug = Logger.debug;

// Mode debug (peut être activé via la console)
window.DEBUG_MODE = false;

// ==================== POLYFILLS ====================

// Polyfill pour padStart (si nécessaire)
if (!String.prototype.padStart) {
    String.prototype.padStart = function padStart(targetLength, padString) {
        targetLength = targetLength >> 0;
        padString = String(typeof padString !== 'undefined' ? padString : ' ');
        if (this.length >= targetLength) {
            return String(this);
        } else {
            targetLength = targetLength - this.length;
            if (targetLength > padString.length) {
                padString += padString.repeat(targetLength / padString.length);
            }
            return padString.slice(0, targetLength) + String(this);
        }
    };
}
