// ipc-handlers.js - Gestionnaires IPC complets pour LearnPress Offline

const path = require('path');
const fs = require('fs').promises;

function setupIpcHandlers(ipcMain, context) {
  const {
    store,
    deviceId,
    app,
    dialog,
    mainWindow,
    getApiClient,
    setApiClient,
    getDatabase,
    getDownloadManager,
    errorHandler,
    config
  } = context;

  // ==================== SYSTÈME ====================
  
  ipcMain.handle('get-device-id', () => {
    return deviceId;
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('get-app-path', () => {
    return app.getPath('userData');
  });
  
  // ==================== AUTO-LOGIN ====================
  
// Remplacer la méthode check-auto-login dans lib/ipc-handlers.js

ipcMain.handle('check-auto-login', async () => {
    try {
        const token = store.get('token');
        const refreshToken = store.get('refreshToken');
        const apiUrl = store.get('apiUrl');
        const username = store.get('username');
        
        console.log('[IPC] Check auto-login:', { 
            hasToken: !!token, 
            hasRefreshToken: !!refreshToken, 
            apiUrl,
            username 
        });
        
        if (!apiUrl) {
            console.log('[IPC] Pas d\'URL API configurée');
            return { success: false, reason: 'no_api_url' };
        }
        
        // Si pas de tokens du tout, pas d'auto-login
        if (!token && !refreshToken) {
            console.log('[IPC] Pas de tokens disponibles');
            return { success: false, reason: 'no_tokens' };
        }
        
        // Créer un client API temporaire
        const LearnPressAPIClient = require('./api-client');
        const apiClient = new LearnPressAPIClient(apiUrl, deviceId);
        
        // Si on a un refresh token, essayer directement le refresh
        if (refreshToken) {
            apiClient.refreshToken = refreshToken;
            apiClient.token = token; // Même si expiré, on le met pour info
            
            try {
                console.log('[IPC] Tentative de refresh direct...');
                const refreshResult = await apiClient.refreshAccessToken();
                
                if (refreshResult.success) {
                    console.log('[IPC] Refresh réussi');
                    
                    // Sauvegarder les nouveaux tokens
                    store.set('token', apiClient.token);
                    if (apiClient.refreshToken !== refreshToken) {
                        store.set('refreshToken', apiClient.refreshToken);
                    }
                    
                    // Vérifier l'abonnement avec le nouveau token
                    const verifyResult = await apiClient.verifySubscription();
                    
                    if (verifyResult.success) {
                        setApiClient(apiClient);
                        
                        return {
                            success: true,
                            username: username,
                            apiUrl: apiUrl,
                            isActive: verifyResult.isActive,
                            subscription: verifyResult.subscription
                        };
                    }
                }
            } catch (refreshError) {
                console.error('[IPC] Échec du refresh:', refreshError.message);
                
                // Si c'est une erreur de token expiré, nettoyer
                if (refreshError.message === 'refresh_token_expired') {
                    console.log('[IPC] Refresh token expiré, nettoyage...');
                    store.delete('token');
                    store.delete('refreshToken');
                    
                    return {
                        success: false,
                        error: 'refresh_token_expired',
                        message: 'Votre session a expiré. Veuillez vous reconnecter.',
                        requiresLogin: true
                    };
                }
            }
        }
        
        // Si on a seulement un token valide, essayer de l'utiliser
        if (token && !refreshToken) {
            apiClient.token = token;
            
            try {
                console.log('[IPC] Vérification avec token existant...');
                const result = await apiClient.verifySubscription();
                
                if (result.success) {
                    console.log('[IPC] Token encore valide');
                    setApiClient(apiClient);
                    
                    return {
                        success: true,
                        username: username,
                        apiUrl: apiUrl,
                        isActive: result.isActive,
                        subscription: result.subscription
                    };
                }
            } catch (error) {
                console.log('[IPC] Token invalide:', error.message);
            }
        }
        
        // Si on arrive ici, échec de l'auto-login
        console.log('[IPC] Auto-login échoué, nettoyage des tokens');
        store.delete('token');
        store.delete('refreshToken');
        
        return {
            success: false,
            error: 'authentication_failed',
            message: 'Impossible de restaurer votre session',
            requiresLogin: true
        };
        
    } catch (error) {
        console.error('[IPC] Erreur auto-login:', error);
        
        // En cas d'erreur inattendue, nettoyer par sécurité
        store.delete('token');
        store.delete('refreshToken');
        
        return { 
            success: false, 
            error: error.message,
            requiresLogin: true
        };
    }
});

  // ==================== STORE ====================
  
  ipcMain.handle('store-get', (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('store-set', (event, key, value) => {
    store.set(key, value);
    return { success: true };
  });

  ipcMain.handle('store-delete', (event, key) => {
    store.delete(key);
    return { success: true };
  });

  ipcMain.handle('store-clear', () => {
    store.clear();
    return { success: true };
  });

  // ==================== API CLIENT ====================
  
ipcMain.handle('api-login', async (event, { apiUrl, username, password }) => {
    try {
        console.log('[IPC] Tentative de connexion...');
        
        // Nettoyer les anciens tokens avant la nouvelle connexion
        store.delete('token');
        store.delete('refreshToken');
        
        // Créer un nouveau client API
        const LearnPressAPIClient = require('./api-client');
        const apiClient = new LearnPressAPIClient(apiUrl, deviceId);
        
        const result = await apiClient.login(username, password);
        
        if (result.success) {
            console.log('[IPC] Connexion réussie !');
            
            // Sauvegarder le client API AVANT de sauvegarder les tokens
            setApiClient(apiClient);
            
            // Sauvegarder les informations de connexion
            store.set('apiUrl', apiUrl);
            store.set('token', apiClient.token);
            store.set('refreshToken', apiClient.refreshToken);
            store.set('userId', apiClient.userId);
            store.set('username', username);
            
            // IMPORTANT : Envoyer l'événement de succès au renderer
            // Utiliser BrowserWindow.getAllWindows() pour s'assurer d'avoir accès à la fenêtre
            const { BrowserWindow } = require('electron');
            const windows = BrowserWindow.getAllWindows();
            
            if (windows.length > 0) {
                console.log('[IPC] Envoi de l\'événement login-success à toutes les fenêtres');
                windows.forEach(window => {
                    if (!window.isDestroyed()) {
                        window.webContents.send('login-success', result.user);
                    }
                });
            } else {
                console.error('[IPC] Aucune fenêtre disponible pour envoyer login-success');
            }
            
            return {
                success: true,
                user: result.user,
                token: apiClient.token
            };
        }
        
        return result;
    } catch (error) {
        console.error('[IPC] Erreur de connexion:', error);
        return { 
            success: false, 
            error: error.message || 'Erreur de connexion'
        };
    }
});

  ipcMain.handle('api-logout', async () => {
    try {
      const apiClient = getApiClient();
      if (apiClient) {
        await apiClient.logout();
      }
      
      // Nettoyer toutes les données
      store.delete('token');
      store.delete('refreshToken');
      store.delete('userId');
      store.delete('username');
      
      setApiClient(null);
      
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-refresh-token', async () => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const result = await apiClient.refreshAccessToken();
      
      if (result.success) {
        store.set('token', apiClient.token);
        if (apiClient.refreshToken) {
          store.set('refreshToken', apiClient.refreshToken);
        }
      }
      
      return result;
    } catch (error) {
      console.error('Erreur de rafraîchissement du token:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-verify-subscription', async () => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.verifySubscription();
    } catch (error) {
      console.error('Erreur de vérification:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-get-courses', async (event, { page, perPage }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getCourses(page, perPage);
    } catch (error) {
      console.error('Erreur lors de la récupération des cours:', error);
      return { success: false, error: error.message, courses: [] };
    }
  });

  ipcMain.handle('api-get-user-courses', async (event, filters) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getUserCourses(filters);
    } catch (error) {
      console.error('Erreur lors de la récupération des cours de l\'utilisateur:', error);
      return { success: false, error: error.message, courses: [] };
    }
  });

  ipcMain.handle('api-get-course-details', async (event, courseId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getCourseDetails(courseId);
    } catch (error) {
      console.error('Erreur lors de la récupération du cours:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-download-course', async (event, { courseId, options }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const downloadPath = path.join(app.getPath('userData'), 'courses', `course-${courseId}`);
      
      const result = await apiClient.downloadCourse(courseId, downloadPath, (progress) => {
        // Envoyer la progression au renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            courseId,
            ...progress
          });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-get-lesson-content', async (event, lessonId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getLessonContent(lessonId);
    } catch (error) {
      console.error('Erreur lors de la récupération de la leçon:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-sync-progress', async (event, progressData) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.syncProgress(progressData);
    } catch (error) {
      console.error('Erreur lors de la synchronisation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-get-media-info', async (event, courseId) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      return await apiClient.getMediaInfo(courseId);
    } catch (error) {
      console.error('Erreur lors de la récupération des médias:', error);
      return { success: false, error: error.message, media: [] };
    }
  });

  ipcMain.handle('api-download-media', async (event, { mediaUrl, lessonId }) => {
    try {
      const apiClient = getApiClient();
      if (!apiClient) {
        throw new Error('Client API non initialisé');
      }
      
      const mediaPath = path.join(app.getPath('userData'), 'media', `lesson-${lessonId}`);
      const filename = path.basename(mediaUrl);
      const savePath = path.join(mediaPath, filename);
      
      const result = await apiClient.downloadMedia(mediaUrl, savePath, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            type: 'media',
            lessonId,
            progress
          });
        }
      });
      
      return result;
    } catch (error) {
      console.error('Erreur lors du téléchargement du média:', error);
      return { success: false, error: error.message };
    }
  });

// ==================== DOWNLOAD MANAGER ====================
  
  ipcMain.handle('download-course', async (event, { courseId, options }) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        throw new Error('Download manager non initialisé');
      }
      
      return await downloadManager.queueCourseDownload(courseId, options);
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('cancel-download', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        throw new Error('Download manager non initialisé');
      }
      
      await downloadManager.cancelDownload(downloadId);
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de l\'annulation:', error);
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('get-all-downloads', async () => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        return { success: true, downloads: [] };
      }
      
      const downloads = downloadManager.getAllDownloads();
      return { success: true, downloads };
    } catch (error) {
      console.error('Erreur lors de la récupération des téléchargements:', error);
      return { success: false, error: error.message, downloads: [] };
    }
  });
  
  ipcMain.handle('get-download-status', async (event, downloadId) => {
    try {
      const downloadManager = getDownloadManager();
      if (!downloadManager) {
        throw new Error('Download manager non initialisé');
      }
      
      const status = downloadManager.getDownloadStatus(downloadId);
      return { success: true, status };
    } catch (error) {
      console.error('Erreur lors de la récupération du statut:', error);
      return { success: false, error: error.message };
    }
  });


  // ==================== DATABASE ====================
  
  ipcMain.handle('db-save-course', async (event, courseData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveCourse(courseData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-course', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getCourse(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-all-courses', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getAllCourses() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-update-course-access', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.updateCourseAccess(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-delete-course', async (event, courseId) => {
    const db = getDatabase();
    
    // Supprimer aussi les fichiers
    const coursePath = path.join(app.getPath('userData'), 'courses', `course-${courseId}`);
    try {
      await fs.rmdir(coursePath, { recursive: true });
    } catch (error) {
      console.error('Erreur lors de la suppression des fichiers:', error);
    }
    
    try {
      return { success: true, result: db.deleteCourse(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-search-courses', async (event, query) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.searchCourses(query) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-course-progress', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getCourseProgress(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-section', async (event, sectionData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveSection(sectionData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-sections', async (event, courseId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getSections(courseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-lesson', async (event, lessonData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveLesson(lessonData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-lesson', async (event, lessonId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getLesson(lessonId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-lessons', async (event, sectionId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getLessons(sectionId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-update-lesson-progress', async (event, { lessonId, progress, completed }) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.updateLessonProgress(lessonId, progress, completed) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-media', async (event, mediaData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveMedia(mediaData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-media', async (event, mediaId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getMedia(mediaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-media-by-lesson', async (event, lessonId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getMediaByLesson(lessonId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-quiz', async (event, quizData) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveQuiz(quizData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-quiz', async (event, quizId) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getQuiz(quizId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-save-quiz-attempt', async (event, { quizId, answers, score }) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.saveQuizAttempt(quizId, answers, score) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-unsynced-items', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getUnsyncedItems() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-mark-as-synced', async (event, syncIds) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.markAsSynced(syncIds) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-expired-courses', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getExpiredCourses() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-cleanup-expired-data', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.cleanupExpiredData() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-add-to-sync-queue', async (event, { entityType, entityId, action, data }) => {
    const db = getDatabase();
    try {
      return { success: true, result: db.addToSyncQueue(entityType, entityId, action, data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db-get-stats', async () => {
    const db = getDatabase();
    try {
      return { success: true, result: db.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ==================== FICHIERS ====================
  
  ipcMain.handle('file-read', async (event, filePath) => {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-write', async (event, { filePath, data }) => {
    try {
      await fs.writeFile(filePath, data, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-exists', async (event, filePath) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file-create-directory', async (event, dirPath) => {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-delete', async (event, filePath) => {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('file-get-media-path', (event, filename) => {
    return path.join(app.getPath('userData'), 'media', filename);
  });

  // ==================== DIALOGUES ====================
  
  ipcMain.handle('dialog-save', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-open', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-message', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog-error', (event, { title, content }) => {
    dialog.showErrorBox(title, content);
    return { success: true };
  });

  // ==================== UTILITAIRES ====================
  
  ipcMain.handle('check-internet', async () => {
    const { net } = require('electron');
    return net.isOnline();
  });

  ipcMain.handle('log-error', async (event, error) => {
    await errorHandler.handleError(error, { source: 'renderer' });
    return { success: true };
  });

  ipcMain.handle('report-error', async (event, error) => {
    await errorHandler.handleError(error, { source: 'renderer' });
    return { success: true };
  });

  ipcMain.handle('save-log', async (event, logEntry) => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      const { existsSync, mkdirSync, appendFileSync } = require('fs');
      
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      
      const logFile = path.join(logsDir, `renderer-${new Date().toISOString().split('T')[0]}.log`);
      const logLine = `${logEntry.timestamp} [${logEntry.level}] ${logEntry.message}\n`;
      
      appendFileSync(logFile, logLine);
      return { success: true };
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du log:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  });

  // ==================== MEDIA PLAYER ====================
  
  ipcMain.handle('create-stream-url', async (event, { filePath, mimeType }) => {
    try {
      const { getMediaPlayer } = context;
      const mediaPlayer = getMediaPlayer();
      
      if (!mediaPlayer) {
        throw new Error('Media player non initialisé');
      }
      
      const streamUrl = await mediaPlayer.createStreamUrl(filePath, mimeType);
      return { success: true, url: streamUrl };
    } catch (error) {
      console.error('Erreur lors de la création du stream:', error);
      return { success: false, error: error.message };
    }
  });




  // ==================== MEMBERSHIP & NOTIFICATIONS ====================

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

  ipcMain.handle('show-notification', (event, options) => {
    const { Notification } = require('electron');
    
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title || 'LearnPress Offline',
        body: options.body,
        icon: path.join(__dirname, '..', 'assets/icons/icon.png'),
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
    
    return { success: true };
  });

  ipcMain.handle('export-certificate-pdf', async (event, certificateData) => {
    try {
      // Fonctionnalité à implémenter avec une librairie PDF
      return { 
        success: false, 
        error: 'Fonctionnalité en cours de développement' 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { setupIpcHandlers };
