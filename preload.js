const { contextBridge, ipcRenderer } = require('electron');

// API sécurisée exposée au renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Device & App Info
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Auto-login check
  checkAutoLogin: () => ipcRenderer.invoke('check-auto-login'),
  
  // Store sécurisé
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    clear: () => ipcRenderer.invoke('store-clear')
  },
  
  // API Client - toutes les opérations passent par le main process
  api: {
    // Auth
    login: (apiUrl, username, password) => 
      ipcRenderer.invoke('api-login', { apiUrl, username, password }),
    logout: () => ipcRenderer.invoke('api-logout'),
    refreshToken: () => ipcRenderer.invoke('api-refresh-token'),
    verifySubscription: () => ipcRenderer.invoke('api-verify-subscription'),
    
    // Courses
    getCourses: (page, perPage) => 
      ipcRenderer.invoke('api-get-courses', { page, perPage }),
    getCourseDetails: (courseId) => 
      ipcRenderer.invoke('api-get-course-details', courseId),
    downloadCourse: (courseId, options) => 
      ipcRenderer.invoke('api-download-course', { courseId, options }),
    
    // Lessons
    getLessonContent: (lessonId) => 
      ipcRenderer.invoke('api-get-lesson-content', lessonId),
    
    // Progress
    syncProgress: (progressData) => 
      ipcRenderer.invoke('api-sync-progress', progressData),
    
    // Media
    getMediaInfo: (courseId) => 
      ipcRenderer.invoke('api-get-media-info', courseId),
    downloadMedia: (mediaUrl, lessonId) => 
      ipcRenderer.invoke('api-download-media', { mediaUrl, lessonId })
  },
  
  // Database operations
  db: {
    // Courses
    saveCourse: (courseData) => ipcRenderer.invoke('db-save-course', courseData),
    getCourse: (courseId) => ipcRenderer.invoke('db-get-course', courseId),
    getAllCourses: () => ipcRenderer.invoke('db-get-all-courses'),
    updateCourseAccess: (courseId) => ipcRenderer.invoke('db-update-course-access', courseId),
    deleteCourse: (courseId) => ipcRenderer.invoke('db-delete-course', courseId),
    searchCourses: (query) => ipcRenderer.invoke('db-search-courses', query),
    getCourseProgress: (courseId) => ipcRenderer.invoke('db-get-course-progress', courseId),
    
    // Sections
    saveSection: (sectionData) => ipcRenderer.invoke('db-save-section', sectionData),
    getSections: (courseId) => ipcRenderer.invoke('db-get-sections', courseId),
    
    // Lessons
    saveLesson: (lessonData) => ipcRenderer.invoke('db-save-lesson', lessonData),
    getLesson: (lessonId) => ipcRenderer.invoke('db-get-lesson', lessonId),
    getLessons: (sectionId) => ipcRenderer.invoke('db-get-lessons', sectionId),
    updateLessonProgress: (lessonId, progress, completed) => 
      ipcRenderer.invoke('db-update-lesson-progress', { lessonId, progress, completed }),
    
    // Media
    saveMedia: (mediaData) => ipcRenderer.invoke('db-save-media', mediaData),
    getMedia: (mediaId) => ipcRenderer.invoke('db-get-media', mediaId),
    getMediaByLesson: (lessonId) => ipcRenderer.invoke('db-get-media-by-lesson', lessonId),
    
    // Quiz
    saveQuiz: (quizData) => ipcRenderer.invoke('db-save-quiz', quizData),
    getQuiz: (quizId) => ipcRenderer.invoke('db-get-quiz', quizId),
    saveQuizAttempt: (quizId, answers, score) => 
      ipcRenderer.invoke('db-save-quiz-attempt', { quizId, answers, score }),
    
    // Sync
    getUnsyncedItems: () => ipcRenderer.invoke('db-get-unsynced-items'),
    markAsSynced: (syncIds) => ipcRenderer.invoke('db-mark-as-synced', syncIds),
    addToSyncQueue: (entityType, entityId, action, data) => 
      ipcRenderer.invoke('db-add-to-sync-queue', { entityType, entityId, action, data }),
    
    // Utils
    getExpiredCourses: () => ipcRenderer.invoke('db-get-expired-courses'),
    cleanupExpiredData: () => ipcRenderer.invoke('db-cleanup-expired-data'),
    getStats: () => ipcRenderer.invoke('db-get-stats')
  },
  
  // File operations
  file: {
    readFile: (filePath) => ipcRenderer.invoke('file-read', filePath),
    writeFile: (filePath, data) => ipcRenderer.invoke('file-write', { filePath, data }),
    exists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    createDirectory: (dirPath) => ipcRenderer.invoke('file-create-directory', dirPath),
    deleteFile: (filePath) => ipcRenderer.invoke('file-delete', filePath),
    getMediaPath: (filename) => ipcRenderer.invoke('file-get-media-path', filename)
  },
  
  // Dialogues
  dialog: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog-save', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog-open', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog-message', options),
    showErrorBox: (title, content) => ipcRenderer.invoke('dialog-error', { title, content })
  },
  
  // Utils
  checkInternet: () => ipcRenderer.invoke('check-internet'),
  logError: (error) => ipcRenderer.invoke('log-error', error),
  reportError: (error) => ipcRenderer.invoke('report-error', error),
  saveLog: (logEntry) => ipcRenderer.invoke('save-log', logEntry),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Membership & Features
  getMembershipRestrictions: () => ipcRenderer.invoke('get-membership-restrictions'),
  checkFeatureAccess: (feature) => ipcRenderer.invoke('check-feature-access', feature),
  
  // Notifications
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  
  // Certificate export
  exportCertificatePdf: (certificateData) => ipcRenderer.invoke('export-certificate-pdf', certificateData),
  
  // Events listeners - Système d'événements amélioré
  on: (channel, callback) => {
    const validChannels = [
      // Auth events
      'auto-login-success',
      'membership-status-changed',
      'membership-expiring-soon',
      
      // Sync events
      'sync-courses',
      'sync-completed',
      'sync-error',
      
      // Download events
     // Download events
     'download-progress',
     'download-completed',
     'download-error',
     'download-cancelled',
     'course-downloaded',

      
      // Navigation events
      'logout',
      'open-settings',
      
      // System events
      'update-progress',
      'low-disk-space',
      'switch-to-offline-mode',
      'apply-restrictions',
      'remove-restrictions',
      
      // Deep linking
      'deep-link'
    ];
    
    if (validChannels.includes(channel)) {
      // Remove any existing listeners to prevent memory leaks
      ipcRenderer.removeAllListeners(channel);
      // Add the new listener
      ipcRenderer.on(channel, (event, ...args) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in event handler for ${channel}:`, error);
        }
      });
      
      return true;
    } else {
      console.warn(`Invalid channel: ${channel}`);
      return false;
    }
  },
  
  off: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // Send events to main process
  send: (channel, ...args) => {
    const validOutgoingChannels = [
      'window-ready',
      'request-sync',
      'cancel-download'
    ];
    
    if (validOutgoingChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      console.warn(`Invalid outgoing channel: ${channel}`);
    }
  }
});

// Exposer des utilitaires crypto basiques
contextBridge.exposeInMainWorld('cryptoUtils', {
  // Générer un ID unique
  generateId: () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },
  
  // Hash simple pour vérifications
  hash: async (text) => {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      console.error('Error generating hash:', error);
      return null;
    }
  },
  
  // Générer un UUID simple
  uuid: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
});

// Exposer des informations sur la plateforme
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  arch: process.arch,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  
  // Helpers pour le comportement spécifique à la plateforme
  getKeyboardShortcut: (action) => {
    const shortcuts = {
      copy: process.platform === 'darwin' ? 'Cmd+C' : 'Ctrl+C',
      paste: process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V',
      save: process.platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S',
      quit: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      settings: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,'
    };
    return shortcuts[action] || '';
  }
});

// Exposer un logger sécurisé
contextBridge.exposeInMainWorld('Logger', {
  log: (message, data) => {
    console.log(`[Renderer] ${message}`, data || '');
    ipcRenderer.invoke('save-log', {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `${message} ${data ? JSON.stringify(data) : ''}`
    });
  },
  
  warn: (message, data) => {
    console.warn(`[Renderer] ${message}`, data || '');
    ipcRenderer.invoke('save-log', {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message: `${message} ${data ? JSON.stringify(data) : ''}`
    });
  },
  
  error: (message, error) => {
    console.error(`[Renderer] ${message}`, error || '');
    ipcRenderer.invoke('report-error', {
      message,
      error: error?.toString(),
      timestamp: new Date().toISOString(),
      stack: error?.stack
    });
  },
  
  debug: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[Renderer Debug] ${message}`, data || '');
    }
  }
});

// Debug mode helpers (development only)
if (process.env.NODE_ENV === 'development') {
  contextBridge.exposeInMainWorld('DevTools', {
    // Reload app
    reload: () => {
      window.location.reload();
    },
    
    // Clear all data
    clearData: async () => {
      await ipcRenderer.invoke('store-clear');
      await ipcRenderer.invoke('db-cleanup-expired-data');
      console.log('All data cleared');
    },
    
    // Get app state
    getState: async () => {
      return {
        store: await Promise.all([
          'token', 'apiUrl', 'username', 'lastSync'
        ].map(async key => [key, await ipcRenderer.invoke('store-get', key)])),
        db: await ipcRenderer.invoke('db-get-stats')
      };
    }
  });
}

// Preload initialization
console.log('Preload script loaded successfully');

// Send ready signal to main process
ipcRenderer.send('window-ready');
