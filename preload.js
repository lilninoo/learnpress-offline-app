const { contextBridge, ipcRenderer } = require('electron');

// API sécurisée exposée au renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Device & App Info
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
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
    
    // Utils
    getExpiredCourses: () => ipcRenderer.invoke('db-get-expired-courses'),
    cleanupExpiredData: () => ipcRenderer.invoke('db-cleanup-expired-data')
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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Events listeners
  on: (channel, callback) => {
    const validChannels = [
      'sync-courses',
      'logout',
      'update-progress',
      'download-progress',
      'course-downloaded',
      'sync-completed',
      'sync-error'
    ];
    
    if (validChannels.includes(channel)) {
      // Remove any existing listeners to prevent memory leaks
      ipcRenderer.removeAllListeners(channel);
      // Add the new listener
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  
  off: (channel) => {
    ipcRenderer.removeAllListeners(channel);
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
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  }
});
