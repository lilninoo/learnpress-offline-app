// database.js - Version compatible avec sqlite3 standard
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
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Erreur lors de l\'ouverture de la base de données:', err);
                    reject(err);
                } else {
                    console.log('Base de données connectée');
                    // Activer les foreign keys
                    this.db.run('PRAGMA foreign_keys = ON');
                    
                    // Créer les tables
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }
    
    createTables() {
        return new Promise((resolve, reject) => {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
            
            if (!fs.existsSync(schemaPath)) {
                // Créer un schéma de base si le fichier n'existe pas
                this.createBasicSchema().then(resolve).catch(reject);
                return;
            }
            
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            // Exécuter le schéma par étapes (sqlite3 ne supporte pas les scripts multi-requêtes)
            const statements = schema.split(';').filter(stmt => stmt.trim());
            
            this.executeStatements(statements, 0, resolve, reject);
        });
    }
    
    executeStatements(statements, index, resolve, reject) {
        if (index >= statements.length) {
            resolve();
            return;
        }
        
        const stmt = statements[index].trim();
        if (!stmt) {
            this.executeStatements(statements, index + 1, resolve, reject);
            return;
        }
        
        this.db.run(stmt, (err) => {
            if (err) {
                console.error('Erreur SQL:', err, 'Statement:', stmt);
                // Continuer malgré les erreurs (pour les CREATE IF NOT EXISTS)
            }
            this.executeStatements(statements, index + 1, resolve, reject);
        });
    }
    
    createBasicSchema() {
        return new Promise((resolve, reject) => {
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
            
            this.executeStatements(tables, 0, resolve, reject);
        });
    }
    
    // Wrapper pour les opérations avec promesses
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }
    
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }
    
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
    
    // ==================== COURS ====================
    
    async saveCourse(courseData) {
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
        
        return await this.run(sql, params);
    }
    
    async getCourse(courseId) {
        const sql = 'SELECT * FROM courses WHERE course_id = ?';
        const course = await this.get(sql, [courseId]);
        
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
    
    async getAllCourses() {
        const sql = 'SELECT * FROM courses ORDER BY last_accessed DESC';
        const courses = await this.all(sql);
        
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
    
    async updateCourseAccess(courseId) {
        const sql = 'UPDATE courses SET last_accessed = CURRENT_TIMESTAMP WHERE course_id = ?';
        return await this.run(sql, [courseId]);
    }
    
    async deleteCourse(courseId) {
        const sql = 'DELETE FROM courses WHERE course_id = ?';
        return await this.run(sql, [courseId]);
    }
    
    async searchCourses(query) {
        const sql = `
            SELECT * FROM courses 
            WHERE title LIKE ? 
            OR instructor_name LIKE ? 
            OR category LIKE ?
            ORDER BY last_accessed DESC
        `;
        const searchTerm = `%${query}%`;
        const courses = await this.all(sql, [searchTerm, searchTerm, searchTerm]);
        
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
    
    // ==================== SECTIONS ====================
    
    async saveSection(sectionData) {
        const sql = `
            INSERT OR REPLACE INTO sections (
                section_id, course_id, title, description, 
                order_index, lessons_count
            ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedDescription = sectionData.description ? 
            this.encryption.encrypt(sectionData.description, this.encryptionKey) : null;
        
        return await this.run(sql, [
            sectionData.section_id,
            sectionData.course_id,
            sectionData.title,
            encryptedDescription,
            sectionData.order_index || 0,
            sectionData.lessons_count || 0
        ]);
    }
    
    async getSections(courseId) {
        const sql = 'SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC';
        const sections = await this.all(sql, [courseId]);
        
        return sections.map(section => ({
            ...section,
            description: section.description ? 
                this.encryption.decrypt(section.description, this.encryptionKey) : null
        }));
    }
    
    // ==================== LEÇONS ====================
    
    async saveLesson(lessonData) {
        const sql = `
            INSERT OR REPLACE INTO lessons (
                lesson_id, section_id, title, type,
                content_encrypted, duration, order_index,
                completed, progress, preview, points, attachments
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const encryptedContent = lessonData.content ? 
            this.encryption.encrypt(lessonData.content, this.encryptionKey) : null;
        
        return await this.run(sql, [
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
    
    async getLesson(lessonId) {
        const sql = 'SELECT * FROM lessons WHERE lesson_id = ?';
        const lesson = await this.get(sql, [lessonId]);
        
        if (!lesson) return null;
        
        return {
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]'),
            completed: lesson.completed === 1
        };
    }
    
    async getLessons(sectionId) {
        const sql = 'SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC';
        const lessons = await this.all(sql, [sectionId]);
        
        return lessons.map(lesson => ({
            ...lesson,
            content: lesson.content_encrypted ? 
                this.encryption.decrypt(lesson.content_encrypted, this.encryptionKey) : null,
            attachments: JSON.parse(lesson.attachments || '[]'),
            completed: lesson.completed === 1
        }));
    }
    
    async updateLessonProgress(lessonId, progress, completed) {
        const sql = `
            UPDATE lessons 
            SET progress = ?, 
                completed = ?, 
                completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE lesson_id = ?
        `;
        
        const result = await this.run(sql, [progress, completed ? 1 : 0, completed ? 1 : 0, lessonId]);
        
        // Ajouter à la file de synchronisation
        if (result.changes > 0) {
            await this.addToSyncQueue('lesson', lessonId, 'progress', { progress, completed });
        }
        
        return result;
    }
    
    // ==================== SYNCHRONISATION ====================
    
    async addToSyncQueue(entityType, entityId, action, data = null) {
        const sql = `
            INSERT INTO sync_log (
                entity_type, entity_id, action, data
            ) VALUES (?, ?, ?, ?)
        `;
        
        return await this.run(sql, [
            entityType,
            entityId,
            action,
            data ? JSON.stringify(data) : null
        ]);
    }
    
    async getUnsyncedItems() {
        const sql = `
            SELECT * FROM sync_log 
            WHERE synced = 0 
            ORDER BY created_at ASC
            LIMIT 100
        `;
        
        const items = await this.all(sql);
        return items.map(item => ({
            ...item,
            data: item.data ? JSON.parse(item.data) : null
        }));
    }
    
    async markAsSynced(syncIds) {
        const placeholders = syncIds.map(() => '?').join(',');
        const sql = `
            UPDATE sync_log 
            SET synced = 1, synced_at = CURRENT_TIMESTAMP 
            WHERE id IN (${placeholders})
        `;
        
        return await this.run(sql, syncIds);
    }
    
    // ==================== UTILITAIRES ====================
    
    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) console.error(err);
                    this.db = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
    
    async getStats() {
        const queries = [
            'SELECT COUNT(*) as count FROM courses',
            'SELECT COUNT(*) as count FROM lessons',
            'SELECT COUNT(*) as count FROM sync_log WHERE synced = 0'
        ];
        
        const [courses, lessons, unsynced] = await Promise.all(
            queries.map(q => this.get(q))
        );
        
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
