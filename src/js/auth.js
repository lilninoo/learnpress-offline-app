// database.js - Version corrigée pour better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
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
            // better-sqlite3 est synchrone
            this.db = new Database(this.dbPath, {
                verbose: process.env.NODE_ENV === 'development' ? console.log : null,
                fileMustExist: false,
                timeout: 5000
            });
            
            console.log('Base de données connectée');
            
            // Activer les foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // Créer les tables
            this.createTables();
            
        } catch (err) {
            console.error('Erreur lors de l\'ouverture de la base de données:', err);
            throw err;
        }
    }
    
    createTables() {
        try {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
            
            if (!fs.existsSync(schemaPath)) {
                // Créer un schéma de base si le fichier n'existe pas
                this.createBasicSchema();
                return;
            }
            
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            // Exécuter le schéma (better-sqlite3 supporte les scripts multi-requêtes avec exec)
            this.db.exec(schema);
            
        } catch (error) {
            console.error('Erreur lors de la création des tables:', error);
            throw error;
        }
    }
    
    createBasicSchema() {
        const schema = `
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id INTEGER UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                thumbnail_encrypted TEXT,
                instructor_name TEXT,
                instructor_id INTEGER,
                lessons_count INTEGER DEFAULT 0,
                sections_count INTEGER DEFAULT 0,
                duration TEXT,
                difficulty_level TEXT,
                category TEXT,
                tags TEXT,
                price REAL DEFAULT 0,
                currency TEXT DEFAULT 'EUR',
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME,
                expires_at DATETIME,
                version INTEGER DEFAULT 1,
                checksum TEXT,
                metadata TEXT
            );
            
            CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                order_index INTEGER DEFAULT 0,
                lessons_count INTEGER DEFAULT 0,
                duration TEXT,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER UNIQUE NOT NULL,
                section_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                content_encrypted TEXT,
                duration TEXT,
                order_index INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                completed_at DATETIME,
                progress INTEGER DEFAULT 0,
                last_position INTEGER DEFAULT 0,
                preview BOOLEAN DEFAULT 0,
                points INTEGER DEFAULT 0,
                attachments TEXT,
                FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                data TEXT,
                synced BOOLEAN DEFAULT 0,
                sync_attempts INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                synced_at DATETIME,
                error_message TEXT
            );
            
            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id TEXT UNIQUE NOT NULL,
                lesson_id INTEGER,
                course_id INTEGER,
                type TEXT NOT NULL,
                filename TEXT NOT NULL,
                original_filename TEXT,
                path_encrypted TEXT NOT NULL,
                url_encrypted TEXT,
                size INTEGER,
                mime_type TEXT,
                duration INTEGER,
                resolution TEXT,
                checksum TEXT,
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                questions_encrypted TEXT NOT NULL,
                settings TEXT,
                duration INTEGER,
                passing_grade INTEGER DEFAULT 70,
                max_attempts INTEGER DEFAULT 0,
                user_answers TEXT,
                score REAL,
                passed BOOLEAN DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                content_encrypted TEXT NOT NULL,
                position INTEGER,
                color TEXT DEFAULT '#ffeb3b',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            );
        `;
        
        this.db.exec(schema);
    }
    
    // Méthodes avec better-sqlite3 (synchrones)
    run(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.run(params);
        } catch (error) {
            console.error('Erreur SQL run:', error);
            throw error;
        }
    }
    
    get(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.get(params);
        } catch (error) {
            console.error('Erreur SQL get:', error);
            throw error;
        }
    }
    
    all(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(params);
        } catch (error) {
            console.error('Erreur SQL all:', error);
            throw error;
        }
    }
    
    // ==================== COURS ====================
    
    saveCourse(courseData) {
        const sql = `
            INSERT OR REPLACE INTO courses (
                course_id, title, description, thumbnail_encrypted,
                instructor_name, instructor_id, lessons_count, sections_count,
                duration, difficulty_level, category, tags,
                price, currency, downloaded_at, expires_at,
                version, checksum, metadata
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        `;
        
        // Chiffrer les données sensibles
        const encryptedDescription = courseData.description ? 
            this.encryption.encrypt(courseData.description, this.encryptionKey) : null;
        const encryptedThumbnail = courseData.thumbnail ? 
            this.encryption.encrypt(courseData.thumbnail, this.encryptionKey) : null;
        
        const params = [
            courseData.course_id,
            courseData.title,
            encryptedDescription,
            encryptedThumbnail,
            courseData.instructor_name,
            courseData.instructor_id,
            courseData.lessons_count || 0,
            courseData.sections_count || 0,
            courseData.duration,
            courseData.difficulty_level,
            courseData.category,
            JSON.stringify(courseData.tags || []),
            courseData.price || 0,
            courseData.currency || 'EUR',
            new Date().toISOString(),
            courseData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            courseData.version || 1,
            courseData.checksum,
            JSON.stringify(courseData.metadata || {})
        ];
        
        return this.run(sql, params);
    }
    
    getCourse(courseId) {
        const sql = 'SELECT * FROM courses WHERE course_id = ?';
        const course = this.get(sql, [courseId]);
        
        if (!course) return null;
        
        // Déchiffrer les données
        return {
            ...course,
            description: course.description ? 
                this.encryption.decrypt(course.description, this.encryptionKey) : null,
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        };
    }
    
    getAllCourses() {
        const sql = 'SELECT * FROM courses ORDER BY last_accessed DESC';
        const courses = this.all(sql);
        
        return courses.map(course => ({
            ...course,
            description: course.description ? 
                this.encryption.decrypt(course.description, this.encryptionKey) : null,
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        }));
    }
    
    updateCourseAccess(courseId) {
        const sql = 'UPDATE courses SET last_accessed = CURRENT_TIMESTAMP WHERE course_id = ?';
        return this.run(sql, [courseId]);
    }
    
    deleteCourse(courseId) {
        const sql = 'DELETE FROM courses WHERE course_id = ?';
        return this.run(sql, [courseId]);
    }
    
    searchCourses(query) {
        const sql = `
            SELECT * FROM courses 
            WHERE title LIKE ? 
            OR instructor_name LIKE ? 
            OR category LIKE ?
            ORDER BY last_accessed DESC
        `;
        const searchTerm = `%${query}%`;
        const courses = this.all(sql, [searchTerm, searchTerm, searchTerm]);
        
        return courses.map(course => ({
            ...course,
            description: course.description ? 
                this.encryption.decrypt(course.description, this.encryptionKey) : null,
            thumbnail: course.thumbnail_encrypted ? 
                this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
            tags: JSON.parse(course.tags || '[]'),
            metadata: JSON.parse(course.metadata || '{}')
        }));
    }
    
    getCourseProgress(courseId) {
        const sql = `
            SELECT 
                COUNT(l.lesson_id) as total_lessons,
                COUNT(CASE WHEN l.completed = 1 THEN 1 END) as completed_lessons,
                AVG(l.progress) as average_progress
            FROM courses c
            LEFT JOIN sections s ON c.course_id = s.course_id
            LEFT JOIN lessons l ON s.section_id = l.section_id
            WHERE c.course_id = ?
        `;
        
        return this.get(sql, [courseId]);
    }
    
    // ==================== SECTIONS ====================
    
    saveSection(sectionData) {
        const sql = `
            INSERT OR REPLACE INTO sections (
                section_id, course_id, title, description, 
                order_index, lessons_count
            ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedDescription = sectionData.description ? 
            this.encryption.encrypt(sectionData.description, this.encryptionKey) : null;
        
        return this.run(sql, [
            sectionData.section_id,
            sectionData.course_id,
            sectionData.title,
            encryptedDescription,
            sectionData.order_index || 0,
            sectionData.lessons_count || 0
        ]);
    }
    
    getSections(courseId) {
        const sql = 'SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC';
        const sections = this.all(sql, [courseId]);
        
        return sections.map(section => ({
            ...section,
            description: section.description ? 
                this.encryption.decrypt(section.description, this.encryptionKey) : null
        }));
    }
    
    // ==================== LEÇONS ====================
    
    saveLesson(lessonData) {
        const sql = `
            INSERT OR REPLACE INTO lessons (
                lesson_id, section_id, title, type,
                content_encrypted, duration, order_index,
                completed, progress, preview, points, attachments
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedContent = lessonData.content ? 
            this.encryption.encrypt(lessonData.content, this.encryptionKey) : null;
        
        return this.run(sql, [
            lessonData.lesson_id,
            lessonData.section_id,
            lessonData.title,
            lessonData.type,
            encryptedContent,
            lessonData.duration,
            lessonData.order_index || 0,
            lessonData.completed ? 1 : 0,
            lessonData.progress || 0,
            lessonData.preview ? 1 : 0,
            lessonData.points || 0,
            JSON.stringify(lessonData.attachments || [])
        ]);
    }
    
    getLesson(lessonId) {
        const sql = 'SELECT * FROM lessons WHERE lesson_id = ?';
        const lesson = this.get(sql, [lessonId]);
        
        if (!lesson) return null;
        
        return {
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]'),
            completed: lesson.completed === 1
        };
    }
    
    getLessons(sectionId) {
        const sql = 'SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC';
        const lessons = this.all(sql, [sectionId]);
        
        return lessons.map(lesson => ({
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]'),
            completed: lesson.completed === 1
        }));
    }
    
    updateLessonProgress(lessonId, progress, completed) {
        const sql = `
            UPDATE lessons 
            SET progress = ?, 
                completed = ?, 
                completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE lesson_id = ?
        `;
        
        const result = this.run(sql, [progress, completed ? 1 : 0, completed ? 1 : 0, lessonId]);
        
        // Ajouter à la file de synchronisation
        if (result.changes > 0) {
            this.addToSyncQueue('lesson', lessonId, 'progress', { progress, completed });
        }
        
        return result;
    }
    
    // ==================== MÉDIAS ====================
    
    saveMedia(mediaData) {
        const sql = `
            INSERT OR REPLACE INTO media (
                media_id, lesson_id, course_id, type, filename,
                original_filename, path_encrypted, url_encrypted,
                size, mime_type, duration, resolution, checksum
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedPath = mediaData.path ? 
            this.encryption.encrypt(mediaData.path, this.encryptionKey) : null;
        const encryptedUrl = mediaData.url ? 
            this.encryption.encrypt(mediaData.url, this.encryptionKey) : null;
        
        return this.run(sql, [
            mediaData.media_id,
            mediaData.lesson_id,
            mediaData.course_id,
            mediaData.type,
            mediaData.filename,
            mediaData.original_filename,
            encryptedPath,
            encryptedUrl,
            mediaData.size,
            mediaData.mime_type,
            mediaData.duration,
            mediaData.resolution,
            mediaData.checksum
        ]);
    }
    
    getMedia(mediaId) {
        const sql = 'SELECT * FROM media WHERE media_id = ?';
        const media = this.get(sql, [mediaId]);
        
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
        const sql = 'SELECT * FROM media WHERE lesson_id = ?';
        const mediaList = this.all(sql, [lessonId]);
        
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
        const sql = `
            INSERT OR REPLACE INTO quizzes (
                quiz_id, lesson_id, title, description,
                questions_encrypted, settings, duration,
                passing_grade, max_attempts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedQuestions = this.encryption.encrypt(
            JSON.stringify(quizData.questions), 
            this.encryptionKey
        );
        
        return this.run(sql, [
            quizData.quiz_id,
            quizData.lesson_id,
            quizData.title,
            quizData.description,
            encryptedQuestions,
            JSON.stringify(quizData.settings || {}),
            quizData.duration,
            quizData.passing_grade || 70,
            quizData.max_attempts || 0
        ]);
    }
    
    getQuiz(lessonId) {
        const sql = 'SELECT * FROM quizzes WHERE lesson_id = ?';
        const quizzes = this.all(sql, [lessonId]);
        
        return quizzes.map(quiz => ({
            ...quiz,
            questions: JSON.parse(this.encryption.decrypt(quiz.questions_encrypted, this.encryptionKey)),
            settings: JSON.parse(quiz.settings || '{}'),
            user_answers: quiz.user_answers ? JSON.parse(quiz.user_answers) : null
        }));
    }
    
    saveQuizAttempt(quizId, answers, score) {
        const sql = `
            UPDATE quizzes 
            SET user_answers = ?, score = ?, 
                passed = ?, attempts = attempts + 1,
                last_attempt = CURRENT_TIMESTAMP
            WHERE quiz_id = ?
        `;
        
        const passed = score >= 70 ? 1 : 0;
        
        return this.run(sql, [
            JSON.stringify(answers),
            score,
            passed,
            quizId
        ]);
    }
    
    // ==================== SYNCHRONISATION ====================
    
    addToSyncQueue(entityType, entityId, action, data = null) {
        const sql = `
            INSERT INTO sync_log (
                entity_type, entity_id, action, data
            ) VALUES (?, ?, ?, ?)
        `;
        
        return this.run(sql, [
            entityType,
            entityId,
            action,
            data ? JSON.stringify(data) : null
        ]);
    }
    
    getUnsyncedItems() {
        const sql = `
            SELECT * FROM sync_log 
            WHERE synced = 0 
            ORDER BY created_at ASC
            LIMIT 100
        `;
        
        const items = this.all(sql);
        return items.map(item => ({
            ...item,
            data: item.data ? JSON.parse(item.data) : null
        }));
    }
    
    markAsSynced(syncIds) {
        if (!Array.isArray(syncIds) || syncIds.length === 0) return;
        
        const placeholders = syncIds.map(() => '?').join(',');
        const sql = `
            UPDATE sync_log 
            SET synced = 1, synced_at = CURRENT_TIMESTAMP 
            WHERE id IN (${placeholders})
        `;
        
        return this.run(sql, syncIds);
    }
    
    getExpiredCourses() {
        const sql = `
            SELECT * FROM courses 
            WHERE expires_at < CURRENT_TIMESTAMP
        `;
        
        return this.all(sql);
    }
    
    cleanupExpiredData() {
        // Supprimer les entrées de sync anciennes (> 30 jours)
        const sql = `
            DELETE FROM sync_log 
            WHERE synced = 1 
            AND datetime(synced_at) < datetime('now', '-30 days')
        `;
        
        return this.run(sql);
    }
    
    // ==================== UTILITAIRES ====================
    
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    
    getStats() {
        const queries = [
            'SELECT COUNT(*) as count FROM courses',
            'SELECT COUNT(*) as count FROM lessons',
            'SELECT COUNT(*) as count FROM sync_log WHERE synced = 0'
        ];
        
        const [courses, lessons, unsynced] = queries.map(q => this.get(q));
        
        return {
            courses: courses.count,
            lessons: lessons.count,
            unsyncedItems: unsynced.count,
            dbSize: this.getFileSize()
        };
    }
    
    getFileSize() {
        try {
            return fs.statSync(this.dbPath).size;
        } catch {
            return 0;
        }
    }
}

module.exports = SecureDatabase;
