const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const LearnPressAPIClient = require('./api-client');

function setupIpcHandlers(ipcMain, context) {
  const { 
    store, 
    deviceId, 
    app, 
    dialog, 
    mainWindow,
    getApiClient,
    setApiClient,
    getDatabase
  } = context;

  // ==================== STORE ====================
  ipcMain.handle('store-get', async (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('store-set', async (event, key, value) => {
    store.set(key, value);
    return true;
  });

  ipcMain.handle('store-delete', async (event, key) => {
    store.delete(key);
    return true;
  });

  ipcMain.handle('store-clear', async () => {
    store.clear();
    return true;
  });

  // ==================== APP INFO ====================
  ipcMain.handle('get-device-id', () => deviceId);
  ipcMain.handle('get-app-path', () => app.getPath('userData'));
  ipcMain.handle('get-app-version', () => app.getVersion());

  // ==================== API CLIENT ====================
  ipcMain.handle('api-login', async (event, { apiUrl, username, password }) => {
    try {
      // Créer un nouveau client API
      const client = new LearnPressAPIClient(apiUrl, deviceId);
      const result = await client.login(username, password);
      
      if (result.success) {
        // Sauvegarder le client
        setApiClient(client);
        
        // Sauvegarder les tokens
        store.set('token', client.token);
        store.set('refreshToken', client.refreshToken);
        store.set('apiUrl', apiUrl);
        store.set('userId', result.user.id);
        store.set('username', username);
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Erreur de connexion'
      };
    }
  });

  ipcMain.handle('api-logout', async () => {
    const client = getApiClient();
    if (client) {
      client.logout();
      setApiClient(null);
    }
    
    // Nettoyer le store
    store.delete('token');
    store.delete('refreshToken');
    store.delete('userId');
    
    return { success: true };
  });

  ipcMain.handle('api-refresh-token', async () => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    try {
      const result = await client.refreshAccessToken();
      if (result.success) {
        store.set('token', client.token);
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('api-verify-subscription', async () => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.verifySubscription();
  });

  ipcMain.handle('api-get-courses', async (event, { page, perPage }) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.getCourses(page, perPage);
  });

  ipcMain.handle('api-get-course-details', async (event, courseId) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.getCourseDetails(courseId);
  });

  ipcMain.handle('api-download-course', async (event, { courseId, options }) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    const downloadPath = path.join(app.getPath('userData'), 'courses', `course-${courseId}`);
    
    // Callback pour la progression
    const onProgress = (progress) => {
      mainWindow.webContents.send('download-progress', {
        courseId,
        ...progress
      });
    };
    
    const result = await client.downloadCourse(courseId, downloadPath, onProgress);
    
    if (result.success) {
      mainWindow.webContents.send('course-downloaded', { courseId });
    }
    
    return result;
  });

  ipcMain.handle('api-get-lesson-content', async (event, lessonId) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.getLessonContent(lessonId);
  });

  ipcMain.handle('api-sync-progress', async (event, progressData) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.syncProgress(progressData);
  });

  ipcMain.handle('api-get-media-info', async (event, courseId) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    return await client.getMediaInfo(courseId);
  });

  ipcMain.handle('api-download-media', async (event, { mediaUrl, lessonId }) => {
    const client = getApiClient();
    if (!client) {
      return { success: false, error: 'Non connecté' };
    }
    
    const filename = path.basename(mediaUrl);
    const savePath = path.join(
      app.getPath('userData'), 
      'media', 
      `lesson-${lessonId}`,
      filename
    );
    
    const onProgress = (progress) => {
      mainWindow.webContents.send('download-progress', {
        lessonId,
        mediaUrl,
        progress
      });
    };
    
    return await client.downloadMedia(mediaUrl, savePath, onProgress);
  });

  // ==================== DATABASE ====================
  ipcMain.handle('db-save-course', async (event, courseData) => {
    const db = getDatabase();
    return db.saveCourse(courseData);
  });

  ipcMain.handle('db-get-course', async (event, courseId) => {
    const db = getDatabase();
    return db.getCourse(courseId);
  });

  ipcMain.handle('db-get-all-courses', async () => {
    const db = getDatabase();
    return db.getAllCourses();
  });

  ipcMain.handle('db-update-course-access', async (event, courseId) => {
    const db = getDatabase();
    return db.updateCourseAccess(courseId);
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
    
    return db.deleteCourse(courseId);
  });

  ipcMain.handle('db-search-courses', async (event, query) => {
    const db = getDatabase();
    return db.searchCourses(query);
  });

  ipcMain.handle('db-get-course-progress', async (event, courseId) => {
    const db = getDatabase();
    return db.getCourseProgress(courseId);
  });

  ipcMain.handle('db-save-section', async (event, sectionData) => {
    const db = getDatabase();
    return db.saveSection(sectionData);
  });

  ipcMain.handle('db-get-sections', async (event, courseId) => {
    const db = getDatabase();
    return db.getSections(courseId);
  });

  ipcMain.handle('db-save-lesson', async (event, lessonData) => {
    const db = getDatabase();
    return db.saveLesson(lessonData);
  });

  ipcMain.handle('db-get-lesson', async (event, lessonId) => {
    const db = getDatabase();
    return db.getLesson(lessonId);
  });

  ipcMain.handle('db-get-lessons', async (event, sectionId) => {
    const db = getDatabase();
    return db.getLessons(sectionId);
  });

  ipcMain.handle('db-update-lesson-progress', async (event, { lessonId, progress, completed }) => {
    const db = getDatabase();
    return db.updateLessonProgress(lessonId, progress, completed);
  });

  ipcMain.handle('db-save-media', async (event, mediaData) => {
    const db = getDatabase();
    return db.saveMedia(mediaData);
  });

  ipcMain.handle('db-get-media', async (event, mediaId) => {
    const db = getDatabase();
    return db.getMedia(mediaId);
  });

  ipcMain.handle('db-get-media-by-lesson', async (event, lessonId) => {
    const db = getDatabase();
    return db.getMediaByLesson(lessonId);
  });

  ipcMain.handle('db-save-quiz', async (event, quizData) => {
    const db = getDatabase();
    return db.saveQuiz(quizData);
  });

  ipcMain.handle('db-get-quiz', async (event, quizId) => {
    const db = getDatabase();
    return db.getQuiz(quizId);
  });

  ipcMain.handle('db-save-quiz-attempt', async (event, { quizId, answers, score }) => {
    const db = getDatabase();
    return db.saveQuizAttempt(quizId, answers, score);
  });

  ipcMain.handle('db-get-unsynced-items', async () => {
    const db = getDatabase();
    return db.getUnsyncedItems();
  });

  ipcMain.handle('db-mark-as-synced', async (event, syncIds) => {
    const db = getDatabase();
    return db.markAsSynced(syncIds);
  });

  ipcMain.handle('db-get-expired-courses', async () => {
    const db = getDatabase();
    return db.getExpiredCourses();
  });

  ipcMain.handle('db-cleanup-expired-data', async () => {
    const db = getDatabase();
    return db.cleanupExpiredData();
  });

  // ==================== FILE OPERATIONS ====================
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

  ipcMain.handle('file-get-media-path', async (event, filename) => {
    return path.join(app.getPath('userData'), 'media', filename);
  });

  // ==================== DIALOGS ====================
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

  ipcMain.handle('dialog-error', async (event, { title, content }) => {
    dialog.showErrorBox(title, content);
    return true;
  });

  // ==================== UTILS ====================
  ipcMain.handle('check-internet', async () => {
    try {
      await axios.get('https://www.google.com', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('log-error', (event, error) => {
    console.error('[Renderer Error]:', error);
    return true;
  });

  ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return true;
  });
}

module.exports = { setupIpcHandlers };
