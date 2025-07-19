// database.js - Gestion de la base de données SQLite avec chiffrement
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const encryption = require('./encryption');

class SecureDatabase {
    constructor(dbPath, encryptionKey) {
        this.dbPath = dbPath;
        this.encryptionKey = encryptionKey;
        this.db = null;
        this.encryption = encryption;
        
        // Créer le dossier si nécessaire
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Initialiser la base de données
        this.init();
    }
    
    init() {
        try {
            // Ouvrir la base de données
            this.db = new Database(this.dbPath, {
                verbose: process.env.NODE_ENV === 'development' ? console.log : null
            });
            
            // Activer les foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // Optimisations
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            
            // Créer les tables si elles n'existent pas
            this.createTables();
            
        } catch (error) {
            console.error('Erreur lors de l\'initialisation de la base de données:', error);
            throw error;
        }
    }
    
    createTables() {
        // Lire le schéma SQL
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Exécuter le schéma
        try {
            this.db.exec(schema);
        } catch (error) {
            console.error('Erreur lors de la création des tables:', error);
            throw error;
        }
    }
    
    // ==================== COURS ====================
    
    saveCourse(courseData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO courses (
                course_id, title, description, thumbnail_encrypted,
                instructor_name, instructor_id, lessons_count, sections_count,
                duration, difficulty_level, category, tags,
                price, currency, downloaded_at, expires_at,
                version, checksum, metadata
            ) VALUES (
                @course_id, @title, @description, @thumbnail_encrypted,
                @instructor_name, @instructor_id, @lessons_count, @sections_count,
                @duration, @difficulty_level, @category, @tags,
                @price, @currency, @downloaded_at, @expires_at,
                @version, @checksum, @metadata
            )
        `);
        
        // Chiffrer les données sensibles
        const encryptedData = {
            ...courseData,
            description: this.encryption.encrypt(courseData.description || '', this.encryptionKey),
            thumbnail_encrypted: courseData.thumbnail ? 
                this.encryption.encrypt(courseData.thumbnail, this.encryptionKey) : null,
            tags: JSON.stringify(courseData.tags || []),
            metadata: JSON.stringify(courseData.metadata || {}),
            downloaded_at: new Date().toISOString(),
            expires_at: courseData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };
        
        return stmt.run(encryptedData);
    }
    
    getCourse(courseId) {
        const stmt = this.db.prepare('SELECT * FROM courses WHERE course_id = ?');
        const course = stmt.get(courseId);
        
        if (!course) return null;
        
        // Déchiffrer les données
        return {
            ...course,
            description: this.encryption.decrypt(course.description, this.encryptionKey),
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        };
    }
    
    getAllCourses() {
        const stmt = this.db.prepare('SELECT * FROM courses ORDER BY last_accessed DESC');
        const courses = stmt.all();
        
        return courses.map(course => ({
            ...course,
            description: this.encryption.decrypt(course.description, this.encryptionKey),
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        }));
    }
    
    updateCourseAccess(courseId) {
        const stmt = this.db.prepare('UPDATE courses SET last_accessed = CURRENT_TIMESTAMP WHERE course_id = ?');
        return stmt.run(courseId);
    }
    
    deleteCourse(courseId) {
        // Supprimer en cascade grâce aux foreign keys
        const stmt = this.db.prepare('DELETE FROM courses WHERE course_id = ?');
        return stmt.run(courseId);
    }
    
    searchCourses(query) {
        const stmt = this.db.prepare(`
            SELECT * FROM courses 
            WHERE title LIKE @query 
            OR instructor_name LIKE @query 
            OR category LIKE @query
            ORDER BY last_accessed DESC
        `);
        
        const courses = stmt.all({ query: `%${query}%` });
        
        return courses.map(course => ({
            ...course,
            description: this.encryption.decrypt(course.description, this.encryptionKey),
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        }));
    }
    
    getCourseProgress(courseId) {
        const stmt = this.db.prepare(`
            SELECT * FROM course_progress_view WHERE course_id = ?
        `);
        return stmt.get(courseId);
    }
    
    getExpiredCourses() {
        const stmt = this.db.prepare(`
            SELECT * FROM courses 
            WHERE expires_at < datetime('now')
            ORDER BY expires_at ASC
        `);
        
        return stmt.all().map(course => ({
            ...course,
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null
        }));
    }
    
    // ==================== SECTIONS ====================
    
    saveSection(sectionData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sections (
                section_id, course_id, title, description, 
                order_index, lessons_count
            ) VALUES (
                @section_id, @course_id, @title, @description,
                @order_index, @lessons_count
            )
        `);
        
        const encryptedData = {
            ...sectionData,
            description: sectionData.description ? 
                this.encryption.encrypt(sectionData.description, this.encryptionKey) : null
        };
        
        return stmt.run(encryptedData);
    }
    
    getSections(courseId) {
        const stmt = this.db.prepare(`
            SELECT * FROM sections 
            WHERE course_id = ? 
            ORDER BY order_index ASC
        `);
        
        const sections = stmt.all(courseId);
        
        return sections.map(section => ({
            ...section,
            description: section.description ? 
                this.encryption.decrypt(section.description, this.encryptionKey) : null
        }));
    }
    
    // ==================== LEÇONS ====================
    
    saveLesson(lessonData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO lessons (
                lesson_id, section_id, title, type,
                content_encrypted, duration, order_index,
                completed, progress, preview, points, attachments
            ) VALUES (
                @lesson_id, @section_id, @title, @type,
                @content_encrypted, @duration, @order_index,
                @completed, @progress, @preview, @points, @attachments
            )
        `);
        
        const encryptedData = {
            ...lessonData,
            content_encrypted: lessonData.content ? 
                this.encryption.encrypt(lessonData.content, this.encryptionKey) : null,
            attachments: JSON.stringify(lessonData.attachments || []),
            completed: lessonData.completed || 0,
            progress: lessonData.progress || 0
        };
        
        return stmt.run(encryptedData);
    }
    
    getLesson(lessonId) {
        const stmt = this.db.prepare('SELECT * FROM lessons WHERE lesson_id = ?');
        const lesson = stmt.get(lessonId);
        
        if (!lesson) return null;
        
        return {
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]')
        };
    }
    
    getLessons(sectionId) {
        const stmt = this.db.prepare(`
            SELECT * FROM lessons 
            WHERE section_id = ? 
            ORDER BY order_index ASC
        `);
        
        const lessons = stmt.all(sectionId);
        
        return lessons.map(lesson => ({
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]')
        }));
    }
    
    updateLessonProgress(lessonId, progress, completed) {
        const stmt = this.db.prepare(`
            UPDATE lessons 
            SET progress = ?, 
                completed = ?, 
                completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE lesson_id = ?
        `);
        
        const result = stmt.run(progress, completed ? 1 : 0, completed ? 1 : 0, lessonId);
        
        // Ajouter à la file de synchronisation
        if (result.changes > 0) {
            this.addToSyncQueue('lesson', lessonId, 'progress', { progress, completed });
        }
        
        return result;
    }
    
    // ==================== MÉDIAS ====================
    
    saveMedia(mediaData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO media (
                media_id, lesson_id, course_id, type,
                filename, original_filename, path_encrypted,
                url_encrypted, size, mime_type, duration,
                resolution, checksum
            ) VALUES (
                @media_id, @lesson_id, @course_id, @type,
                @filename, @original_filename, @path_encrypted,
                @url_encrypted, @size, @mime_type, @duration,
                @resolution, @checksum
            )
        `);
        
        const encryptedData = {
            ...mediaData,
            path_encrypted: mediaData.path ? 
                this.encryption.encrypt(mediaData.path, this.encryptionKey) : null,
            url_encrypted: mediaData.url ? 
                this.encryption.encrypt(mediaData.url, this.encryptionKey) : null,
            original_filename: mediaData.original_filename || mediaData.filename
        };
        
        return stmt.run(encryptedData);
    }
    
    getMedia(mediaId) {
        const stmt = this.db.prepare('SELECT * FROM media WHERE media_id = ?');
        const media = stmt.get(mediaId);
        
        if (!media) return null;
        
        return {
            ...media,
            path: media.path_encrypted ? 
                this.encryption.decrypt(media.path_encrypted, this.encryptionKey) : null,
            url: media.url_encrypted ? 
                this.encryption.decrypt(media.url_encrypted, this.encryptionKey) : null
        };
    }
    
    getMediaByLesson(lessonId) {
        const stmt = this.db.prepare(`
            SELECT * FROM media 
            WHERE lesson_id = ? 
            ORDER BY type, filename
        `);
        
        const mediaList = stmt.all(lessonId);
        
        return mediaList.map(media => ({
            ...media,
            path: media.path_encrypted ? 
                this.encryption.decrypt(media.path_encrypted, this.encryptionKey) : null,
            url: media.url_encrypted ? 
                this.encryption.decrypt(media.url_encrypted, this.encryptionKey) : null
        }));
    }
    
    // ==================== QUIZ ====================
    
    saveQuiz(quizData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO quizzes (
                quiz_id, lesson_id, title, description,
                questions_encrypted, settings, duration,
                passing_grade, max_attempts
            ) VALUES (
                @quiz_id, @lesson_id, @title, @description,
                @questions_encrypted, @settings, @duration,
                @passing_grade, @max_attempts
            )
        `);
        
        const encryptedData = {
            ...quizData,
            questions_encrypted: this.encryption.encrypt(
                JSON.stringify(quizData.questions || []), 
                this.encryptionKey
            ),
            settings: JSON.stringify(quizData.settings || {}),
            description: quizData.description ? 
                this.encryption.encrypt(quizData.description, this.encryptionKey) : null
        };
        
        return stmt.run(encryptedData);
    }
    
    getQuiz(lessonId) {
        const stmt = this.db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?');
        const quiz = stmt.get(lessonId);
        
        if (!quiz) return null;
        
        return {
            ...quiz,
            questions: JSON.parse(
                this.encryption.decrypt(quiz.questions_encrypted, this.encryptionKey)
            ),
            settings: JSON.parse(quiz.settings || '{}'),
            description: quiz.description ? 
                this.encryption.decrypt(quiz.description, this.encryptionKey) : null
        };
    }
    
    saveQuizAttempt(quizId, answers, score) {
        const updateStmt = this.db.prepare(`
            UPDATE quizzes 
            SET user_answers = ?,
                score = ?,
                passed = ?,
                attempts = attempts + 1,
                last_attempt = CURRENT_TIMESTAMP
            WHERE quiz_id = ?
        `);
        
        const quiz = this.db.prepare('SELECT passing_grade FROM quizzes WHERE quiz_id = ?').get(quizId);
        const passed = score >= (quiz?.passing_grade || 70);
        
        const result = updateStmt.run(
            this.encryption.encrypt(JSON.stringify(answers), this.encryptionKey),
            score,
            passed ? 1 : 0,
            quizId
        );
        
        // Ajouter à la file de synchronisation
        if (result.changes > 0) {
            this.addToSyncQueue('quiz', quizId, 'attempt', { answers, score, passed });
        }
        
        return result;
    }
    
    // ==================== SYNCHRONISATION ====================
    
    addToSyncQueue(entityType, entityId, action, data = null) {
        const stmt = this.db.prepare(`
            INSERT INTO sync_log (
                entity_type, entity_id, action, data
            ) VALUES (?, ?, ?, ?)
        `);
        
        return stmt.run(
            entityType,
            entityId,
            action,
            data ? JSON.stringify(data) : null
        );
    }
    
    getUnsyncedItems() {
        const stmt = this.db.prepare(`
            SELECT * FROM sync_log 
            WHERE synced = 0 
            ORDER BY created_at ASC
            LIMIT 100
        `);
        
        return stmt.all().map(item => ({
            ...item,
            data: item.data ? JSON.parse(item.data) : null
        }));
    }
    
    markAsSynced(syncIds) {
        const stmt = this.db.prepare(`
            UPDATE sync_log 
            SET synced = 1, synced_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        
        const updateMany = this.db.transaction((ids) => {
            for (const id of ids) {
                stmt.run(id);
            }
        });
        
        updateMany(syncIds);
    }
    
    // ==================== NETTOYAGE ====================
    
    cleanupExpiredData() {
        const transaction = this.db.transaction(() => {
            // Supprimer les entrées de synchronisation anciennes (plus de 30 jours)
            this.db.prepare(`
                DELETE FROM sync_log 
                WHERE synced = 1 
                AND synced_at < datetime('now', '-30 days')
            `).run();
            
            // Nettoyer le cache expiré
            this.db.prepare(`
                DELETE FROM cache 
                WHERE expires_at < datetime('now')
            `).run();
        });
        
        transaction();
    }
    
    // ==================== UTILITAIRES ====================
    
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    
    backup(backupPath) {
        return new Promise((resolve, reject) => {
            this.db.backup(backupPath)
                .then(() => resolve({ success: true }))
                .catch(error => reject(error));
        });
    }
    
    vacuum() {
        this.db.prepare('VACUUM').run();
    }
    
    getStats() {
        return {
            courses: this.db.prepare('SELECT COUNT(*) as count FROM courses').get().count,
            lessons: this.db.prepare('SELECT COUNT(*) as count FROM lessons').get().count,
            media: this.db.prepare('SELECT COUNT(*) as count FROM media').get().count,
            quizzes: this.db.prepare('SELECT COUNT(*) as count FROM quizzes').get().count,
            unsyncedItems: this.db.prepare('SELECT COUNT(*) as count FROM sync_log WHERE synced = 0').get().count,
            dbSize: fs.statSync(this.dbPath).size
        };
    }
}

module.exports = SecureDatabase;
