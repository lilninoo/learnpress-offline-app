// Ajouts nécessaires dans lib/ipc-handlers.js

// Dans la fonction setupIpcHandlers, ajouter ces handlers manquants :

// ==================== MEDIA PLAYER ====================

ipcMain.handle('create-stream-url', async (event, { filePath, mimeType }) => {
    try {
        const mediaPlayer = context.getMediaPlayer();
        
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

// ==================== DOWNLOAD MANAGER ====================

ipcMain.handle('download-course', async (event, { courseId, options }) => {
    try {
        const downloadManager = context.getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        
        const result = await downloadManager.queueCourseDownload(courseId, options);
        
        // Écouter les événements de progression
        if (result.success && result.downloadId) {
            const download = downloadManager.getDownloadStatus(result.downloadId);
            if (download) {
                // Envoyer les mises à jour de progression
                const progressInterval = setInterval(() => {
                    const status = downloadManager.getDownloadStatus(result.downloadId);
                    if (!status) {
                        clearInterval(progressInterval);
                        return;
                    }
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('download-progress', {
                            courseId,
                            downloadId: result.downloadId,
                            status: status.status,
                            progress: status.progress,
                            currentFile: status.currentFile,
                            error: status.error
                        });
                    }
                    
                    if (status.status === 'completed' || status.status === 'error' || status.status === 'cancelled') {
                        clearInterval(progressInterval);
                    }
                }, 1000);
            }
        }
        
        return result;
    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('cancel-download', async (event, downloadId) => {
    try {
        const downloadManager = context.getDownloadManager();
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

ipcMain.handle('get-download-status', async (event, downloadId) => {
    try {
        const downloadManager = context.getDownloadManager();
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

ipcMain.handle('get-all-downloads', async () => {
    try {
        const downloadManager = context.getDownloadManager();
        if (!downloadManager) {
            throw new Error('Download manager non initialisé');
        }
        
        const downloads = downloadManager.getAllDownloads();
        return { success: true, downloads };
    } catch (error) {
        console.error('Erreur lors de la récupération des téléchargements:', error);
        return { success: false, error: error.message, downloads: [] };
    }
});

// ==================== DATABASE STATS ====================

ipcMain.handle('db-optimize', async () => {
    const db = context.getDatabase();
    try {
        if (!db || !db.isInitialized) {
            throw new Error('Base de données non initialisée');
        }
        
        // Optimiser la base de données
        db.db.pragma('optimize');
        db.db.pragma('vacuum');
        
        return { success: true };
    } catch (error) {
        console.error('Erreur lors de l\'optimisation:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db-backup', async () => {
    const db = context.getDatabase();
    try {
        if (!db || !db.isInitialized) {
            throw new Error('Base de données non initialisée');
        }
        
        const backupPath = path.join(
            app.getPath('userData'),
            'backups',
            `backup-${Date.now()}.db`
        );
        
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        
        // Utiliser la méthode backup de better-sqlite3
        await db.db.backup(backupPath);
        
        return { success: true, path: backupPath };
    } catch (error) {
        console.error('Erreur lors du backup:', error);
        return { success: false, error: error.message };
    }
});

// ==================== SYSTEM INFO ====================

ipcMain.handle('get-system-info', async () => {
    const os = require('os');
    
    try {
        return {
            success: true,
            info: {
                platform: process.platform,
                arch: process.arch,
                version: os.release(),
                totalMemory: os.totalmem(),
                freeMemory: os.freemem(),
                cpus: os.cpus().length,
                uptime: os.uptime(),
                appVersion: app.getVersion(),
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node,
                chromeVersion: process.versions.chrome
            }
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des infos système:', error);
        return { success: false, error: error.message };
    }
});

// ==================== CLEANUP ====================

ipcMain.handle('cleanup-temp-files', async () => {
    try {
        const tempPath = path.join(app.getPath('userData'), 'temp');
        
        if (fs.existsSync(tempPath)) {
            const files = await fs.readdir(tempPath);
            
            for (const file of files) {
                try {
                    await fs.unlink(path.join(tempPath, file));
                } catch (err) {
                    console.warn('Impossible de supprimer:', file);
                }
            }
        }
        
        return { success: true };
    } catch (error) {
        console.error('Erreur lors du nettoyage:', error);
        return { success: false, error: error.message };
    }
});
