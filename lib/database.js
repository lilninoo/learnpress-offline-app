// database.js - Version corrigée avec better-sqlite3
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
        
        this.init();
    }
    
    init() {
        try {
            console.log('Initialisation de la base de données:', this.dbPath);
            
            // Utiliser better-sqlite3 en mode synchrone
            this.db = new Database(this.dbPath);
            
            // Activer les foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // Créer les tables
            this.createTables();
            
            console.log('Base de données initialisée avec succès');
        } catch (error) {
            console.error('Erreur lors de l\'initialisation de la DB:', error);
            throw error;
        }
    }
    
    createTables() {
        try {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
            
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf8');
                
                // Diviser et exécuter les statements
                const statements = schema.split(';').filter(stmt => stmt.trim());
                
                statements.forEach(stmt => {
                    if (stmt.trim()) {
                        try {
                            this.db.exec(stmt);
                        } catch (err) {
                            // Ignorer les erreurs "table already exists"
                            if (!err.message.includes('already exists')) {
                                console.warn('Erreur SQL ignorée:', err.message);
                            }
                        }
                    }
                });
            } else {
                // Créer un schéma de base
                this.createBasicSchema();
            }
        } catch (error) {
            console.error('Erreur lors de la création des tables:', error);
            throw error;
        }
    }
    
    createBasicSchema() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS courses (
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
            )`,
            
            `CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                order_index INTEGER DEFAULT 0,
                lessons_count INTEGER DEFAULT 0,
                duration TEXT,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            `CREATE TABLE IF NOT EXISTS lessons (
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
            )`,
            
            `CREATE TABLE IF NOT EXISTS media (
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
            )`,
            
            `CREATE TABLE IF NOT EXISTS quizzes (
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
            )`,
            
            `CREATE TABLE IF NOT EXISTS sync_log (
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
            )`
        ];
        
        tables.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (err) {
                console.warn('Erreur lors de la création de table:', err.message);
            }
        });
        
        // Créer les index
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_lessons_section ON lessons(section_id)',
            'CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_lesson ON media(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced)'
        ];
        
        indexes.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (err) {
                console.warn('Erreur lors de la création d\'index:', err.message);
            }
        });
    }
    
    // ==================== COURS ====================
    
    saveCourse(courseData) {
        try {
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
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                courseData.course_id || courseData.id,
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
            );
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du cours:', error);
            throw error;
        }
    }
    
    getCourse(courseId) {
        try {
            const sql = 'SELECT * FROM courses WHERE course_id = ?';
            const stmt = this.db.prepare(sql);
            const course = stmt.get(courseId);
            
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
        } catch (error) {
            console.error('Erreur lors de la récupération du cours:', error);
            throw error;
        }
    }
    
    getAllCourses() {
        try {
            const sql = 'SELECT * FROM courses ORDER BY last_accessed DESC';
            const stmt = this.db.prepare(sql);
            const courses = stmt.all();
            
            return courses.map(course => ({
                ...course,
                description: course.description ? 
                    this.encryption.decrypt(course.description, this.encryptionKey) : null,
                thumbnail: course.thumbnail_encrypted ? 
                    this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
                tags: JSON.parse(course.tags || '[]'),
                metadata: JSON.parse(course.metadata || '{}')
            }));
        } catch (error) {
            console.error('Erreur lors de la récupération des cours:', error);
            throw error;
        }
    }
    
    updateCourseAccess(courseId) {
        try {
            const sql = 'UPDATE courses SET last_accessed = CURRENT_TIMESTAMP WHERE course_id = ?';
            const stmt = this.db.prepare(sql);
            return stmt.run(courseId);
        } catch (error) {
            console.error('Erreur lors de la mise à jour de l\'accès:', error);
            throw error;
        }
    }
    
    deleteCourse(courseId) {
        try {
            const sql = 'DELETE FROM courses WHERE course_id = ?';
            const stmt = this.db.prepare(sql);
            return stmt.run(courseId);
        } catch (error) {
            console.error('Erreur lors de la suppression du cours:', error);
            throw error;
        }
    }
    
    searchCourses(query) {
        try {
            const sql = `
                SELECT * FROM courses 
                WHERE title LIKE ? 
                OR instructor_name LIKE ? 
                OR category LIKE ?
                ORDER BY last_accessed DESC
            `;
            const searchTerm = `%${query}%`;
            const stmt = this.db.prepare(sql);
            const courses = stmt.all(searchTerm, searchTerm, searchTerm);
            
            return courses.map(course => ({
                ...course,
                description: course.description ? 
                    this.encryption.decrypt(course.description, this.encryptionKey) : null,
                thumbnail: course.thumbnail_encrypted ? 
                    this.encryption.decrypt(course.thumbnail_encrypted, this.encryptionKey) : null,
                tags: JSON.parse(course.tags || '[]'),
                metadata: JSON.parse(course.metadata || '{}')
            }));
        } catch (error) {
            console.error('Erreur lors de la recherche:', error);
            throw error;
        }
    }
    
    // ==================== SECTIONS ====================
    
    saveSection(sectionData) {
        try {
            const sql = `
                INSERT OR REPLACE INTO sections (
                    section_id, course_id, title, description, 
                    order_index, lessons_count
                ) VALUES (?, ?, ?, ?, ?, ?)
            `;
            
            const encryptedDescription = sectionData.description ? 
                this.encryption.encrypt(sectionData.description, this.encryptionKey) : null;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                sectionData.section_id || sectionData.id,
                sectionData.course_id,
                sectionData.title,
                encryptedDescription,
                sectionData.order_index || 0,
                sectionData.lessons_count || 0
            );
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la section:', error);
            throw error;
        }
    }
    
    getSections(courseId) {
        try {
            const sql = 'SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC';
            const stmt = this.db.prepare(sql);
            const sections = stmt.all(courseId);
            
            return sections.map(section => ({
                ...section,
                description: section.description ? 
                    this.encryption.decrypt(section.description, this.encryptionKey) : null
            }));
        } catch (error) {
            console.error('Erreur lors de la récupération des sections:', error);
            throw error;
        }
    }
    
    // ==================== LEÇONS ====================
    
    saveLesson(lessonData) {
        try {
            const sql = `
                INSERT OR REPLACE INTO lessons (
                    lesson_id, section_id, title, type,
                    content_encrypted, duration, order_index,
                    completed, progress, preview, points, attachments
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const encryptedContent = lessonData.content ? 
                this.encryption.encrypt(lessonData.content, this.encryptionKey) : null;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                lessonData.lesson_id || lessonData.id,
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
            );
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la leçon:', error);
            throw error;
        }
    }
    
    getLesson(lessonId) {
        try {
            const sql = 'SELECT * FROM lessons WHERE lesson_id = ?';
            const stmt = this.db.prepare(sql);
            const lesson = stmt.get(lessonId);
            
            if (!lesson) return null;
            
            return {
                ...lesson,
                content: lesson.content_encrypted ? 
                    this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
                attachments: JSON.parse(lesson.attachments || '[]'),
                completed: lesson.completed === 1
            };
        } catch (error) {
            console.error('Erreur lors de la récupération de la leçon:', error);
            throw error;
        }
    }
    
    getLessons(sectionId) {
        try {
            const sql = 'SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC';
            const stmt = this.db.prepare(sql);
            const lessons = stmt.all(sectionId);
            
            return lessons.map(lesson => ({
                ...lesson,
                content: lesson.content_encrypted ? 
                    this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
                attachments: JSON.parse(lesson.attachments || '[]'),
                completed: lesson.completed === 1
            }));
        } catch (error) {
            console.error('Erreur lors de la récupération des leçons:', error);
            throw error;
        }
    }
    
    updateLessonProgress(lessonId, progress, completed) {
        try {
            const sql = `
                UPDATE lessons 
                SET progress = ?, 
                    completed = ?, 
                    completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
                WHERE lesson_id = ?
            `;
            
            const stmt = this.db.prepare(sql);
            const result = stmt.run(progress, completed ? 1 : 0, completed ? 1 : 0, lessonId);
            
            // Ajouter à la file de synchronisation
            if (result.changes > 0) {
                this.addToSyncQueue('lesson', lessonId, 'progress', { progress, completed });
            }
            
            return result;
        } catch (error) {
            console.error('Erreur lors de la mise à jour de la progression:', error);
            throw error;
        }
    }
    
    // ==================== MÉDIAS ====================
    
    saveMedia(mediaData) {
        try {
            const sql = `
                INSERT OR REPLACE INTO media (
                    media_id, lesson_id, course_id, type,
                    filename, original_filename, path_encrypted,
                    url_encrypted, size, mime_type, duration,
                    resolution, checksum
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const encryptedPath = mediaData.path ? 
                this.encryption.encrypt(mediaData.path, this.encryptionKey) : null;
            const encryptedUrl = mediaData.url ? 
                this.encryption.encrypt(mediaData.url, this.encryptionKey) : null;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                mediaData.media_id || mediaData.id,
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
            );
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du média:', error);
            throw error;
        }
    }
    
    getMedia(mediaId) {
        try {
            const sql = 'SELECT * FROM media WHERE media_id = ?';
            const stmt = this.db.prepare(sql);
            const media = stmt.get(mediaId);
            
            if (!media) return null;
            
            return {
                ...media,
                path: media.path_encrypted ? 
                    this.encryption.decrypt(media.path_encrypted, this.encryptionKey) : null,
                url: media.url_encrypted ? 
                    this.encryption.decrypt(media.url_encrypted, this.encryptionKey) : null
            };
        } catch (error) {
            console.error('Erreur lors de la récupération du média:', error);
            throw error;
        }
    }
    
    getMediaByLesson(lessonId) {
        try {
            const sql = 'SELECT * FROM media WHERE lesson_id = ?';
            const stmt = this.db.prepare(sql);
            const mediaList = stmt.all(lessonId);
            
            return mediaList.map(media => ({
                ...media,
                path: media.path_encrypted ? 
                    this.encryption.decrypt(media.path_encrypted, this.encryptionKey) : null,
                url: media.url_encrypted ? 
                    this.encryption.decrypt(media.url_encrypted, this.encryptionKey) : null
            }));
        } catch (error) {
            console.error('Erreur lors de la récupération des médias:', error);
            throw error;
        }
    }
    
    // ==================== QUIZ ====================
    
    saveQuiz(quizData) {
        try {
            const sql = `
                INSERT OR REPLACE INTO quizzes (
                    quiz_id, lesson_id, title, description,
                    questions_encrypted, settings, duration,
                    passing_grade, max_attempts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const encryptedQuestions = quizData.questions ? 
                this.encryption.encrypt(JSON.stringify(quizData.questions), this.encryptionKey) : null;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                quizData.quiz_id || quizData.id,
                quizData.lesson_id,
                quizData.title,
                quizData.description,
                encryptedQuestions,
                JSON.stringify(quizData.settings || {}),
                quizData.duration,
                quizData.passing_grade || 70,
                quizData.max_attempts || 0
            );
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du quiz:', error);
            throw error;
        }
    }
    
    getQuiz(quizId) {
        try {
            const sql = 'SELECT * FROM quizzes WHERE quiz_id = ?';
            const stmt = this.db.prepare(sql);
            const quiz = stmt.get(quizId);
            
            if (!quiz) return null;
            
            return {
                ...quiz,
                questions: quiz.questions_encrypted ? 
                    JSON.parse(this.encryption.decrypt(quiz.questions_encrypted, this.encryptionKey)) : [],
                settings: JSON.parse(quiz.settings || '{}'),
                user_answers: JSON.parse(quiz.user_answers || '[]')
            };
        } catch (error) {
            console.error('Erreur lors de la récupération du quiz:', error);
            throw error;
        }
    }
    
    saveQuizAttempt(quizId, answers, score) {
        try {
            const sql = `
                UPDATE quizzes 
                SET user_answers = ?, score = ?, attempts = attempts + 1,
                    last_attempt = CURRENT_TIMESTAMP, passed = ?
                WHERE quiz_id = ?
            `;
            
            const passed = score >= 70 ? 1 : 0;
            const stmt = this.db.prepare(sql);
            const result = stmt.run(JSON.stringify(answers), score, passed, quizId);
            
            // Ajouter à la file de synchronisation
            if (result.changes > 0) {
                this.addToSyncQueue('quiz', quizId, 'attempt', { answers, score, passed });
            }
            
            return result;
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la tentative:', error);
            throw error;
        }
    }
    
    // ==================== SYNCHRONISATION ====================
    
    addToSyncQueue(entityType, entityId, action, data = null) {
        try {
            const sql = `
                INSERT INTO sync_log (
                    entity_type, entity_id, action, data
                ) VALUES (?, ?, ?, ?)
            `;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(
                entityType,
                entityId,
                action,
                data ? JSON.stringify(data) : null
            );
        } catch (error) {
            console.error('Erreur lors de l\'ajout à la file de sync:', error);
            throw error;
        }
    }
    
    getUnsyncedItems() {
        try {
            const sql = `
                SELECT * FROM sync_log 
                WHERE synced = 0 
                ORDER BY created_at ASC
                LIMIT 100
            `;
            
            const stmt = this.db.prepare(sql);
            const items = stmt.all();
            
            return items.map(item => ({
                ...item,
                data: item.data ? JSON.parse(item.data) : null
            }));
        } catch (error) {
            console.error('Erreur lors de la récupération des éléments non synchronisés:', error);
            throw error;
        }
    }
    
    markAsSynced(syncIds) {
        try {
            if (!Array.isArray(syncIds) || syncIds.length === 0) return { changes: 0 };
            
            const placeholders = syncIds.map(() => '?').join(',');
            const sql = `
                UPDATE sync_log 
                SET synced = 1, synced_at = CURRENT_TIMESTAMP 
                WHERE id IN (${placeholders})
            `;
            
            const stmt = this.db.prepare(sql);
            return stmt.run(...syncIds);
        } catch (error) {
            console.error('Erreur lors du marquage comme synchronisé:', error);
            throw error;
        }
    }
    
    // ==================== PROGRESSION ====================
    
    getCourseProgress(courseId) {
        try {
            const sql = `
                SELECT 
                    COUNT(DISTINCT l.lesson_id) as total_lessons,
                    COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) as completed_lessons,
                    ROUND(AVG(l.progress), 2) as average_progress
                FROM sections s
                LEFT JOIN lessons l ON s.section_id = l.section_id
                WHERE s.course_id = ?
            `;
            
            const stmt = this.db.prepare(sql);
            const result = stmt.get(courseId);
            
            if (!result || result.total_lessons === 0) {
                return { total_lessons: 0, completed_lessons: 0, completion_percentage: 0 };
            }
            
            return {
                ...result,
                completion_percentage: Math.round((result.completed_lessons / result.total_lessons) * 100)
            };
        } catch (error) {
            console.error('Erreur lors du calcul de la progression:', error);
            throw error;
        }
    }
    
    // ==================== NETTOYAGE ====================
    
    getExpiredCourses() {
        try {
            const sql = 'SELECT * FROM courses WHERE expires_at < CURRENT_TIMESTAMP';
            const stmt = this.db.prepare(sql);
            return stmt.all();
        } catch (error) {
            console.error('Erreur lors de la récupération des cours expirés:', error);
            throw error;
        }
    }
    
    cleanupExpiredData() {
        try {
            // Supprimer les logs de sync anciens (> 30 jours)
            const cleanupSyncSql = `
                DELETE FROM sync_log 
                WHERE created_at < datetime('now', '-30 days')
                AND synced = 1
            `;
            this.db.exec(cleanupSyncSql);
            
            return { success: true };
        } catch (error) {
            console.error('Erreur lors du nettoyage:', error);
            throw error;
        }
    }
    
    // ==================== UTILITAIRES ====================
    
    close() {
        try {
            if (this.db) {
                this.db.close();
                this.db = null;
                console.log('Base de données fermée');
            }
        } catch (error) {
            console.error('Erreur lors de la fermeture de la DB:', error);
        }
    }
    
    getStats() {
        try {
            const queries = {
                courses: 'SELECT COUNT(*) as count FROM courses',
                lessons: 'SELECT COUNT(*) as count FROM lessons',
                unsynced: 'SELECT COUNT(*) as count FROM sync_log WHERE synced = 0'
            };
            
            const stats = {};
            Object.entries(queries).forEach(([key, sql]) => {
                const stmt = this.db.prepare(sql);
                stats[key] = stmt.get().count;
            });
            
            stats.dbSize = this.getFileSize();
            return stats;
        } catch (error) {
            console.error('Erreur lors de la récupération des stats:', error);
            return { courses: 0, lessons: 0, unsynced: 0, dbSize: 0 };
        }
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
