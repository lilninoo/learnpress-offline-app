// download-manager.js - Gestionnaire de téléchargement avec chiffrement
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { createWriteStream, createReadStream } = require('fs');

class DownloadManager {
    constructor(database, encryption, apiClient) {
        this.db = database;
        this.encryption = encryption;
        this.apiClient = apiClient;
        this.downloads = new Map();
        this.maxConcurrent = 2;
        this.activeDownloads = 0;
        this.queue = [];
    }
    
    // Ajouter un cours à la file de téléchargement
    async queueCourseDownload(courseId, options = {}) {
        try {
            // Vérifier si le cours n'est pas déjà téléchargé
            const existingCourse = await this.db.getCourse(courseId);
            if (existingCourse && !options.forceUpdate) {
                return {
                    success: false,
                    error: 'Le cours est déjà téléchargé'
                };
            }
            
            // Récupérer les détails du cours
            const courseDetails = await this.apiClient.getCourseDetails(courseId);
            if (!courseDetails.success) {
                throw new Error(courseDetails.error);
            }
            
            const course = courseDetails.course;
            
            // Créer une entrée de téléchargement
            const downloadId = `download-${courseId}-${Date.now()}`;
            const download = {
                id: downloadId,
                courseId,
                course,
                options: {
                    includeVideos: options.includeVideos !== false,
                    includeDocuments: options.includeDocuments !== false,
                    videoQuality: options.videoQuality || 'high',
                    compress: options.compress || false
                },
                status: 'pending',
                progress: 0,
                totalSize: 0,
                downloadedSize: 0,
                files: [],
                startTime: null,
                error: null
            };
            
            this.downloads.set(downloadId, download);
            this.queue.push(download);
            
            // Démarrer le téléchargement si possible
            this.processQueue();
            
            return {
                success: true,
                downloadId,
                message: 'Téléchargement ajouté à la file d\'attente'
            };
            
        } catch (error) {
            console.error('[DownloadManager] Erreur lors de l\'ajout à la file:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Traiter la file de téléchargement
    async processQueue() {
        if (this.activeDownloads >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }
        
        const download = this.queue.shift();
        if (!download) return;
        
        this.activeDownloads++;
        download.status = 'preparing';
        download.startTime = Date.now();
        
        try {
            await this.downloadCourse(download);
        } catch (error) {
            console.error('[DownloadManager] Erreur lors du téléchargement:', error);
            download.status = 'error';
            download.error = error.message;
            this.emit('download-error', download);
        } finally {
            this.activeDownloads--;
            this.processQueue(); // Traiter le suivant
        }
    }
    
    // Télécharger un cours complet
    async downloadCourse(download) {
        try {
            const { course, options } = download;
            
            // Créer le dossier du cours
            const coursePath = path.join(
                this.db.dbPath.replace('courses.db', ''), // Utiliser le chemin de la DB
                'courses',
                `course-${course.id}`
            );

            await fs.mkdir(coursePath, { recursive: true });
            
            // 1. Créer le package de téléchargement côté serveur
            download.status = 'creating-package';
            this.emit('download-progress', download);
            
            const packageResult = await this.apiClient.createCoursePackage(course.id, options);
            if (!packageResult.success) {
                throw new Error(packageResult.error);
            }
            
            download.totalSize = packageResult.totalSize;
            download.files = packageResult.files;
            
            // 2. Sauvegarder les métadonnées du cours
            await this.saveCourseMetadata(course, coursePath);
            
            // 3. Télécharger et chiffrer chaque fichier
            download.status = 'downloading';
            
            for (let i = 0; i < packageResult.files.length; i++) {
                const file = packageResult.files[i];
                
                try {
                    await this.downloadAndEncryptFile(
                        file,
                        coursePath,
                        (progress) => {
                            // Calculer la progression globale
                            const fileProgress = (i / packageResult.files.length) * 100;
                            const currentFileProgress = (progress.percent / packageResult.files.length);
                            download.progress = Math.round(fileProgress + currentFileProgress);
                            download.currentFile = file.name;
                            this.emit('download-progress', download);
                        }
                    );
                    
                    download.downloadedSize += file.size;
                    
                } catch (error) {
                    console.error(`[DownloadManager] Erreur fichier ${file.name}:`, error);
                    // Continuer avec les autres fichiers
                }
            }
            
            // 4. Sauvegarder dans la base de données
            await this.saveCourseToDatabase(course, coursePath, download);
            
            // 5. Marquer comme terminé
            download.status = 'completed';
            download.progress = 100;
            this.emit('download-completed', download);
            
            // Nettoyer après un délai
            setTimeout(() => {
                this.downloads.delete(download.id);
            }, 5000);
            
        } catch (error) {
            download.status = 'error';
            download.error = error.message;
            throw error;
        }
    }
    
    // Télécharger et chiffrer un fichier
    async downloadAndEncryptFile(file, coursePath, onProgress) {
        const tempPath = path.join(coursePath, 'temp', file.name);
        const finalPath = path.join(coursePath, file.path || file.name);
        
        try {
            // Créer les dossiers nécessaires
            await fs.mkdir(path.dirname(tempPath), { recursive: true });
            await fs.mkdir(path.dirname(finalPath), { recursive: true });
            
            // 1. Télécharger le fichier
            console.log(`[DownloadManager] Téléchargement: ${file.name}`);
            
            const downloadResult = await this.apiClient.downloadFile(
                file.url,
                tempPath,
                onProgress
            );
            
            if (!downloadResult.success) {
                throw new Error('Échec du téléchargement');
            }
            
            // 2. Chiffrer le fichier
            console.log(`[DownloadManager] Chiffrement: ${file.name}`);
            
            const encryptionKey = this.db.encryptionKey;
            await this.encryptFile(tempPath, finalPath, encryptionKey);
            
            // 3. Supprimer le fichier temporaire
            await fs.unlink(tempPath);
            
            // 4. Sauvegarder les métadonnées du fichier
            await this.saveFileMetadata(file, finalPath, coursePath);
            
            return {
                success: true,
                path: finalPath,
                encrypted: true
            };
            
        } catch (error) {
            // Nettoyer en cas d'erreur
            try {
                await fs.unlink(tempPath);
            } catch (e) {
                // Ignorer
            }
            
            throw error;
        }
    }
    
    // Chiffrer un fichier
    async encryptFile(inputPath, outputPath, key) {
        const algorithm = 'aes-256-gcm';
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);
        
        const input = createReadStream(inputPath);
        const output = createWriteStream(outputPath);
        
        // Écrire l'IV au début du fichier
        output.write(iv);
        
        // Chiffrer le fichier
        await pipeline(input, cipher, output);
        
        // Ajouter le tag d'authentification
        const authTag = cipher.getAuthTag();
        await fs.appendFile(outputPath, authTag);
        
        return {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }
    
    // Sauvegarder les métadonnées du cours
    async saveCourseMetadata(course, coursePath) {
        const metadata = {
            id: course.id,
            title: course.title,
            description: course.description,
            instructor: course.instructor,
            thumbnail: course.thumbnail,
            sections: course.sections?.map(section => ({
                id: section.id,
                title: section.title,
                order: section.order,
                lessons: section.lessons?.map(lesson => ({
                    id: lesson.id,
                    title: lesson.title,
                    type: lesson.type,
                    duration: lesson.duration,
                    order: lesson.order
                }))
            })),
            downloadedAt: new Date().toISOString(),
            version: course.version || 1
        };
        
        const metadataPath = path.join(coursePath, 'course.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        
        // Chiffrer le fichier de métadonnées
        const encryptedPath = metadataPath + '.enc';
        await this.encryptFile(metadataPath, encryptedPath, this.db.encryptionKey);
        await fs.unlink(metadataPath);
    }
    
    // Sauvegarder les métadonnées d'un fichier
    async saveFileMetadata(file, encryptedPath, coursePath) {
        const metadata = {
            originalName: file.name,
            encryptedPath: path.relative(coursePath, encryptedPath),
            size: file.size,
            mimeType: file.mimeType || 'application/octet-stream',
            checksum: file.checksum,
            encryptedAt: new Date().toISOString()
        };
        
        // Ajouter au manifest
        const manifestPath = path.join(coursePath, 'manifest.json');
        let manifest = { files: [] };
        
        try {
            const existing = await fs.readFile(manifestPath, 'utf8');
            manifest = JSON.parse(existing);
        } catch (e) {
            // Le fichier n'existe pas encore
        }
        
        manifest.files.push(metadata);
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    
    // Sauvegarder le cours dans la base de données
    async saveCourseToDatabase(course, coursePath, download) {
        try {
            // Sauvegarder le cours principal
            await this.db.saveCourse({
                course_id: course.id,
                title: course.title,
                description: course.description,
                thumbnail_encrypted: course.thumbnail ? 
                    this.encryption.encrypt(course.thumbnail, this.db.encryptionKey) : null,
                instructor_name: course.instructor?.name,
                instructor_id: course.instructor?.id,
                sections_count: course.sections?.length || 0,
                lessons_count: course.lessons_count,
                duration: course.duration,
                difficulty_level: course.difficulty,
                category: course.category,
                tags: course.tags,
                downloaded_at: new Date().toISOString(),
                local_path: coursePath,
                version: course.version || 1
            });
            
            // Sauvegarder les sections et leçons
            if (course.sections) {
                for (const section of course.sections) {
                    await this.db.saveSection({
                        section_id: section.id,
                        course_id: course.id,
                        title: section.title,
                        description: section.description,
                        order_index: section.order,
                        lessons_count: section.lessons?.length || 0
                    });
                    
                    if (section.lessons) {
                        for (const lesson of section.lessons) {
                            await this.db.saveLesson({
                                lesson_id: lesson.id,
                                section_id: section.id,
                                title: lesson.title,
                                type: lesson.type,
                                content_encrypted: lesson.content ? 
                                    this.encryption.encrypt(lesson.content, this.db.encryptionKey) : null,
                                duration: lesson.duration,
                                order_index: lesson.order,
                                preview: lesson.preview || false,
                                attachments: lesson.attachments
                            });
                        }
                    }
                }
            }
            
            // Sauvegarder les informations des fichiers
            for (const file of download.files) {
                const encryptedPath = path.join(coursePath, file.path || file.name);
                
                await this.db.saveMedia({
                    media_id: crypto.randomBytes(16).toString('hex'),
                    course_id: course.id,
                    lesson_id: file.lessonId,
                    type: this.getMediaType(file.name),
                    filename: file.name,
                    original_filename: file.originalName || file.name,
                    path_encrypted: this.encryption.encrypt(encryptedPath, this.db.encryptionKey),
                    size: file.size,
                    mime_type: file.mimeType,
                    checksum: file.checksum
                });
            }
            
            console.log(`[DownloadManager] Cours ${course.id} sauvegardé dans la base de données`);
            
        } catch (error) {
            console.error('[DownloadManager] Erreur lors de la sauvegarde dans la DB:', error);
            throw error;
        }
    }
    
    // Déterminer le type de média
    getMediaType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
        const audioExts = ['.mp3', '.wav', '.ogg', '.m4a'];
        const docExts = ['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx'];
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
        
        if (videoExts.includes(ext)) return 'video';
        if (audioExts.includes(ext)) return 'audio';
        if (docExts.includes(ext)) return 'document';
        if (imageExts.includes(ext)) return 'image';
        
        return 'other';
    }
    
    // Annuler un téléchargement
    async cancelDownload(downloadId) {
        const download = this.downloads.get(downloadId);
        if (!download) return;
        
        download.status = 'cancelled';
        
        // Retirer de la file d'attente
        const index = this.queue.indexOf(download);
        if (index > -1) {
            this.queue.splice(index, 1);
        }
        
        // TODO: Implémenter l'annulation du téléchargement en cours
        
        this.emit('download-cancelled', download);
    }
    
    // Reprendre un téléchargement échoué
    async resumeDownload(downloadId) {
        const download = this.downloads.get(downloadId);
        if (!download || download.status !== 'error') return;
        
        download.status = 'pending';
        download.error = null;
        this.queue.push(download);
        
        this.processQueue();
    }
    
    // Obtenir l'état d'un téléchargement
    getDownloadStatus(downloadId) {
        return this.downloads.get(downloadId);
    }
    
    // Obtenir tous les téléchargements
    getAllDownloads() {
        return Array.from(this.downloads.values());
    }
    
    // Émettre des événements
    emit(event, data) {
        // Utiliser IPC pour envoyer au renderer
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        
        windows.forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send(event, data);
            }
        });
    }
}

module.exports = DownloadManager;
