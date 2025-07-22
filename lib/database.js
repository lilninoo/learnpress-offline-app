// database.js - Version corrigée avec better-sqlite3 et gestion d'erreurs robuste
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
        this.isInitialized = false;
        this.transactionLevel = 0; // NOUVEAU : Tracking des transactions
        
        // NOUVEAU : Cache pour améliorer les performances
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute
        
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
            
            // Configuration optimisée pour better-sqlite3
            const options = {
                verbose: process.env.NODE_ENV === 'development' ? console.log : null,
                fileMustExist: false,
                timeout: 10000, // 10 secondes
                // NOUVEAU : Options de performance
                prepare: true
            };
            
            this.db = new Database(this.dbPath, options);
            
            // NOUVEAU : Configuration de performance
            this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging
            this.db.pragma('cache_size = 10000'); // 10MB cache
            this.db.pragma('temp_store = memory');
            this.db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
            this.db.pragma('optimize'); // Optimiser au démarrage
            
            // Activer les foreign keys
            this.db.pragma('foreign_keys = ON');
            
            // NOUVEAU : Vérifier l'intégrité de la DB
            this.checkIntegrity();
            
            // Créer les tables
            this.createTables();
            
            // NOUVEAU : Préparer les statements fréquemment utilisés
            this.prepareStatements();
            
            // NOUVEAU : Configurer les triggers et fonctions personnalisées
            this.setupTriggers();
            
            // NOUVEAU : Migrer si nécessaire
            this.migrate();
            
            this.isInitialized = true;
            console.log('Base de données initialisée avec succès');
            
        } catch (error) {
            console.error('Erreur lors de l\'initialisation de la DB:', error);
            this.handleDatabaseError(error);
            throw error;
        }
    }
    
    // NOUVEAU : Vérifier l'intégrité de la base
    checkIntegrity() {
        try {
            const result = this.db.pragma('integrity_check');
            if (result[0]?.integrity_check !== 'ok') {
                console.warn('Problème d\'intégrité détecté:', result);
                // TODO: Implémenter la réparation automatique ou la sauvegarde
            }
        } catch (error) {
            console.warn('Impossible de vérifier l\'intégrité:', error);
        }
    }
    
    // NOUVEAU : Gestion centralisée des erreurs de DB
    handleDatabaseError(error) {
        if (error.code === 'SQLITE_CORRUPT') {
            console.error('Base de données corrompue détectée');
            // TODO: Implémenter la récupération automatique
        } else if (error.code === 'SQLITE_BUSY') {
            console.warn('Base de données occupée, retry automatique');
            // Les statements préparés gèrent automatiquement les retries
        } else if (error.code === 'SQLITE_LOCKED') {
            console.warn('Base de données verrouillée');
        }
    }
    
    createTables() {
        try {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
            
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf8');
                
                // NOUVEAU : Exécution transactionnelle du schéma
                this.transaction(() => {
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
                })();
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
            // Table des cours avec colonnes optimisées
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
                difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')),
                category TEXT,
                tags TEXT, -- JSON array
                price REAL DEFAULT 0,
                currency TEXT DEFAULT 'EUR',
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME,
                expires_at DATETIME,
                version INTEGER DEFAULT 1,
                checksum TEXT,
                metadata TEXT, -- JSON pour données supplémentaires
                -- NOUVEAU : Colonnes supplémentaires
                file_size INTEGER DEFAULT 0,
                download_progress INTEGER DEFAULT 100,
                is_favorite BOOLEAN DEFAULT 0,
                rating REAL DEFAULT 0,
                completion_percentage REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Table des sections
            `CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                order_index INTEGER DEFAULT 0,
                lessons_count INTEGER DEFAULT 0,
                duration TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // Table des leçons avec colonnes étendues
            `CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER UNIQUE NOT NULL,
                section_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('video', 'text', 'quiz', 'assignment', 'pdf', 'audio')),
                content_encrypted TEXT,
                duration TEXT,
                order_index INTEGER DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                completed_at DATETIME,
                progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
                last_position INTEGER DEFAULT 0, -- Position en secondes pour les vidéos
                preview BOOLEAN DEFAULT 0,
                points INTEGER DEFAULT 0,
                attachments TEXT, -- JSON array
                -- NOUVEAU : Colonnes supplémentaires
                difficulty TEXT DEFAULT 'normal',
                estimated_time INTEGER DEFAULT 0, -- en minutes
                views_count INTEGER DEFAULT 0,
                notes_count INTEGER DEFAULT 0,
                bookmarks TEXT, -- JSON array des bookmarks
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE
            )`,
            
            // Table des médias avec métadonnées étendues
            `CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                media_id TEXT UNIQUE NOT NULL,
                lesson_id INTEGER,
                course_id INTEGER,
                type TEXT NOT NULL CHECK(type IN ('video', 'audio', 'document', 'image', 'archive')),
                filename TEXT NOT NULL,
                original_filename TEXT,
                path_encrypted TEXT NOT NULL,
                url_encrypted TEXT,
                size INTEGER,
                mime_type TEXT,
                duration INTEGER, -- Durée en secondes pour vidéo/audio
                resolution TEXT, -- Pour les vidéos (ex: "1920x1080")
                bitrate INTEGER, -- NOUVEAU
                quality TEXT, -- NOUVEAU : 'low', 'medium', 'high', 'original'
                checksum TEXT,
                thumbnail_path TEXT, -- NOUVEAU : Chemin vers la miniature
                download_priority INTEGER DEFAULT 5, -- NOUVEAU : Priorité de téléchargement
                downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // Table des quiz
            `CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                questions_encrypted TEXT NOT NULL, -- JSON array chiffré
                settings TEXT, -- JSON (passing_grade, retake_count, duration, etc.)
                duration INTEGER, -- Durée limite en minutes
                passing_grade INTEGER DEFAULT 70 CHECK(passing_grade >= 0 AND passing_grade <= 100),
                max_attempts INTEGER DEFAULT 0, -- 0 = illimité
                user_answers TEXT, -- JSON array des réponses
                score REAL,
                passed BOOLEAN DEFAULT 0,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME,
                -- NOUVEAU : Colonnes supplémentaires
                best_score REAL DEFAULT 0,
                time_spent INTEGER DEFAULT 0, -- Temps passé en secondes
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table des devoirs/assignments
            `CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                instructions_encrypted TEXT,
                due_days INTEGER, -- Nombre de jours pour rendre le devoir
                max_file_size INTEGER, -- Taille max en MB
                allowed_file_types TEXT, -- JSON array
                submission_encrypted TEXT, -- Soumission de l'étudiant chiffrée
                submitted_at DATETIME,
                grade REAL,
                feedback_encrypted TEXT,
                graded_at DATETIME,
                -- NOUVEAU : Colonnes supplémentaires
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'submitted', 'graded', 'late')),
                submission_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table de synchronisation améliorée
            `CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL CHECK(entity_type IN ('course', 'lesson', 'quiz', 'assignment', 'progress', 'note')),
                entity_id INTEGER NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'complete', 'progress')),
                data TEXT, -- JSON des données à synchroniser
                synced BOOLEAN DEFAULT 0,
                sync_attempts INTEGER DEFAULT 0,
                priority INTEGER DEFAULT 5, -- NOUVEAU : Priorité de sync
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                synced_at DATETIME,
                error_message TEXT,
                -- NOUVEAU : Colonnes pour retry logic
                next_retry_at DATETIME,
                max_retries INTEGER DEFAULT 3
            )`,
            
            // NOUVEAU : Table des notes et annotations
            `CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL,
                content_encrypted TEXT NOT NULL,
                position INTEGER, -- Position dans la vidéo ou le texte
                color TEXT DEFAULT '#ffeb3b',
                type TEXT DEFAULT 'note' CHECK(type IN ('note', 'highlight', 'bookmark')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // NOUVEAU : Table des certificats
            `CREATE TABLE IF NOT EXISTS certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                certificate_id INTEGER UNIQUE NOT NULL,
                course_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                certificate_key TEXT UNIQUE NOT NULL,
                issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                grade REAL,
                file_path_encrypted TEXT,
                metadata TEXT, -- JSON
                -- NOUVEAU : Colonnes supplémentaires
                template_id INTEGER,
                valid_until DATETIME,
                verification_url TEXT,
                FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
            )`,
            
            // NOUVEAU : Table des discussions (cache local)
            `CREATE TABLE IF NOT EXISTS discussions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discussion_id INTEGER UNIQUE NOT NULL,
                lesson_id INTEGER NOT NULL,
                parent_id INTEGER, -- Pour les réponses
                author_name TEXT,
                author_avatar_encrypted TEXT,
                content_encrypted TEXT,
                created_at DATETIME,
                likes INTEGER DEFAULT 0,
                replies_count INTEGER DEFAULT 0,
                is_instructor BOOLEAN DEFAULT 0,
                synced BOOLEAN DEFAULT 1, -- Déjà synchronisé car vient du serveur
                FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
            )`,
            
            // Table des paramètres utilisateur
            `CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                type TEXT DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
                description TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Table de cache avec TTL
            `CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                accessed_count INTEGER DEFAULT 0,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // NOUVEAU : Table des statistiques d'utilisation
            `CREATE TABLE IF NOT EXISTS usage_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                entity_type TEXT,
                entity_id INTEGER,
                metadata TEXT, -- JSON
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        
        // Exécution transactionnelle
        this.transaction(() => {
            tables.forEach(sql => {
                try {
                    this.db.exec(sql);
                } catch (err) {
                    console.warn('Erreur lors de la création de table:', err.message);
                }
            });
        })();
        
        // Créer les index après les tables
        this.createIndexes();
    }
    
    // NOUVEAU : Créer les index pour optimiser les performances
    createIndexes() {
        const indexes = [
            // Index de base
            'CREATE INDEX IF NOT EXISTS idx_lessons_section ON lessons(section_id)',
            'CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_lesson ON media(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_media_course ON media(course_id)',
            'CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced)',
            'CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_id)',
            'CREATE INDEX IF NOT EXISTS idx_quizzes_lesson ON quizzes(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_assignments_lesson ON assignments(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_notes_lesson ON notes(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_discussions_lesson ON discussions(lesson_id)',
            'CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at)',
            'CREATE INDEX IF NOT EXISTS idx_courses_expires ON courses(expires_at)',
            
            // NOUVEAU : Index composites pour les requêtes courantes
            'CREATE INDEX IF NOT EXISTS idx_lessons_completed ON lessons(completed, course_id)',
            'CREATE INDEX IF NOT EXISTS idx_lessons_progress ON lessons(progress, completed)',
            'CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category, downloaded_at)',
            'CREATE INDEX IF NOT EXISTS idx_sync_priority ON sync_log(priority, created_at, synced)',
            'CREATE INDEX IF NOT EXISTS idx_media_type_size ON media(type, size)',
            'CREATE INDEX IF NOT EXISTS idx_usage_stats_event ON usage_stats(event_type, created_at)',
            
            // Index pour la recherche textuelle
            'CREATE INDEX IF NOT EXISTS idx_courses_title ON courses(title)',
            'CREATE INDEX IF NOT EXISTS idx_lessons_title ON lessons(title)',
            'CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_name)'
        ];
        
        indexes.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (err) {
                console.warn('Erreur lors de la création d\'index:', err.message);
            }
        });
    }
    
    // NOUVEAU : Préparer les statements fréquemment utilisés
    prepareStatements() {
        try {
            // Statements pour les cours
            this.statements = {
                // Cours
                saveCourse: this.db.prepare(`
                    INSERT OR REPLACE INTO courses (
                        course_id, title, description, thumbnail_encrypted,
                        instructor_name, instructor_id, lessons_count, sections_count,
                        duration, difficulty_level, category, tags, price, currency,
                        downloaded_at, expires_at, version, checksum, metadata,
                        file_size, rating, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `),
                getCourse: this.db.prepare('SELECT * FROM courses WHERE course_id = ?'),
                getAllCourses: this.db.prepare(`
                    SELECT * FROM courses 
                    ORDER BY CASE 
                        WHEN last_accessed IS NOT NULL THEN last_accessed 
                        ELSE downloaded_at 
                    END DESC
                `),
                updateCourseAccess: this.db.prepare(`
                    UPDATE courses 
                    SET last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                    WHERE course_id = ?
                `),
                deleteCourse: this.db.prepare('DELETE FROM courses WHERE course_id = ?'),
                
                // Sections
                saveSection: this.db.prepare(`
                    INSERT OR REPLACE INTO sections (
                        section_id, course_id, title, description, order_index, lessons_count
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `),
                getSections: this.db.prepare(`
                    SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC
                `),
                
                // Leçons
                saveLesson: this.db.prepare(`
                    INSERT OR REPLACE INTO lessons (
                        lesson_id, section_id, title, type, content_encrypted,
                        duration, order_index, completed, progress, preview,
                        points, attachments, difficulty, estimated_time, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `),
                getLesson: this.db.prepare('SELECT * FROM lessons WHERE lesson_id = ?'),
                getLessons: this.db.prepare(`
                    SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC
                `),
                updateLessonProgress: this.db.prepare(`
                    UPDATE lessons 
                    SET progress = ?, 
                        completed = ?, 
                        completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE lesson_id = ?
                `),
                
                // Médias
                saveMedia: this.db.prepare(`
                    INSERT OR REPLACE INTO media (
                        media_id, lesson_id, course_id, type, filename, original_filename,
                        path_encrypted, url_encrypted, size, mime_type, duration,
                        resolution, bitrate, quality, checksum, thumbnail_path, download_priority
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `),
                getMedia: this.db.prepare('SELECT * FROM media WHERE media_id = ?'),
                getMediaByLesson: this.db.prepare('SELECT * FROM media WHERE lesson_id = ?'),
                getMediaByCourse: this.db.prepare('SELECT * FROM media WHERE course_id = ?'),
                
                // Synchronisation
                addToSyncQueue: this.db.prepare(`
                    INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
                    VALUES (?, ?, ?, ?, ?)
                `),
                getUnsyncedItems: this.db.prepare(`
                    SELECT * FROM sync_log 
                    WHERE synced = 0 AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
                    ORDER BY priority DESC, created_at ASC
                    LIMIT ?
                `),
                markAsSynced: this.db.prepare(`
                    UPDATE sync_log 
                    SET synced = 1, synced_at = CURRENT_TIMESTAMP 
                    WHERE id IN (${Array(20).fill('?').join(',')})
                `),
                
                // Cache
                getCacheItem: this.db.prepare(`
                    SELECT value FROM cache 
                    WHERE key = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                `),
                setCacheItem: this.db.prepare(`
                    INSERT OR REPLACE INTO cache (key, value, expires_at, accessed_count, last_accessed)
                    VALUES (?, ?, ?, COALESCE((SELECT accessed_count FROM cache WHERE key = ?), 0), CURRENT_TIMESTAMP)
                `),
                
                // Statistiques
                getStats: this.db.prepare(`
                    SELECT 
                        (SELECT COUNT(*) FROM courses) as courses,
                        (SELECT COUNT(*) FROM lessons) as lessons,
                        (SELECT COUNT(*) FROM sync_log WHERE synced = 0) as unsynced,
                        (SELECT SUM(file_size) FROM courses) as total_size
                `),
                
                // NOUVEAU : Progression des cours
                getCourseProgress: this.db.prepare(`
                    SELECT 
                        COUNT(DISTINCT l.lesson_id) as total_lessons,
                        COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) as completed_lessons,
                        ROUND(AVG(l.progress), 2) as average_progress,
                        ROUND(CAST(COUNT(DISTINCT CASE WHEN l.completed = 1 THEN l.lesson_id END) AS FLOAT) / 
                              COUNT(DISTINCT l.lesson_id) * 100, 2) as completion_percentage
                    FROM sections s
                    LEFT JOIN lessons l ON s.section_id = l.section_id
                    WHERE s.course_id = ?
                `)
            };
        } catch (error) {
            console.error('Erreur lors de la préparation des statements:', error);
            throw error;
        }
    }
    
    // NOUVEAU : Configuration des triggers
    setupTriggers() {
        const triggers = [
            // Mise à jour automatique de last_accessed
            `CREATE TRIGGER IF NOT EXISTS update_course_access 
             AFTER UPDATE ON lessons
             WHEN NEW.completed = 1 OR NEW.progress > OLD.progress
             BEGIN
                 UPDATE courses 
                 SET last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE course_id = (
                     SELECT c.course_id 
                     FROM courses c
                     JOIN sections s ON c.course_id = s.course_id
                     WHERE s.section_id = NEW.section_id
                 );
             END`,
             
            // Mise à jour du compteur de leçons dans les sections
            `CREATE TRIGGER IF NOT EXISTS update_section_lesson_count
             AFTER INSERT ON lessons
             BEGIN
                 UPDATE sections 
                 SET lessons_count = (
                     SELECT COUNT(*) FROM lessons WHERE section_id = NEW.section_id
                 )
                 WHERE section_id = NEW.section_id;
             END`,
             
            // Ajout automatique à la file de synchronisation
            `CREATE TRIGGER IF NOT EXISTS add_to_sync_on_progress
             AFTER UPDATE ON lessons
             WHEN NEW.progress > OLD.progress OR NEW.completed != OLD.completed
             BEGIN
                 INSERT INTO sync_log (entity_type, entity_id, action, data, priority)
                 VALUES ('lesson', NEW.lesson_id, 'progress', 
                         json_object('progress', NEW.progress, 'completed', NEW.completed), 5);
             END`,
             
            // NOUVEAU : Mise à jour des statistiques d'usage
            `CREATE TRIGGER IF NOT EXISTS track_lesson_completion
             AFTER UPDATE ON lessons
             WHEN NEW.completed = 1 AND OLD.completed = 0
             BEGIN
                 INSERT INTO usage_stats (event_type, entity_type, entity_id, metadata)
                 VALUES ('lesson_completed', 'lesson', NEW.lesson_id, 
                         json_object('duration', NEW.duration, 'progress_time', NEW.updated_at));
             END`,
             
            // Nettoyage automatique du cache expiré
            `CREATE TRIGGER IF NOT EXISTS cleanup_expired_cache
             AFTER INSERT ON cache
             BEGIN
                 DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP;
             END`
        ];
        
        triggers.forEach(trigger => {
            try {
                this.db.exec(trigger);
            } catch (err) {
                console.warn('Erreur lors de la création de trigger:', err.message);
            }
        });
    }
    
    // NOUVEAU : Système de migration
    migrate() {
        try {
            // Vérifier la version de la DB
            let currentVersion = 0;
            try {
                const result = this.db.prepare("SELECT value FROM user_settings WHERE key = 'db_version'").get();
                currentVersion = result ? parseInt(result.value) : 0;
            } catch (error) {
                // Table user_settings n'existe pas encore
                currentVersion = 0;
            }
            
            const targetVersion = 2; // Version cible
            
            if (currentVersion < targetVersion) {
                console.log(`Migration de la DB v${currentVersion} vers v${targetVersion}`);
                
                this.transaction(() => {
                    // Migrations par version
                    if (currentVersion < 1) {
                        this.migrateToV1();
                    }
                    if (currentVersion < 2) {
                        this.migrateToV2();
                    }
                    
                    // Mettre à jour la version
                    this.db.prepare(`
                        INSERT OR REPLACE INTO user_settings (key, value, type) 
                        VALUES ('db_version', ?, 'number')
                    `).run(targetVersion.toString());
                })();
                
                console.log('Migration terminée');
            }
        } catch (error) {
            console.error('Erreur lors de la migration:', error);
        }
    }
    
    // NOUVEAU : Migration vers v1
    migrateToV1() {
        // Ajouter des colonnes manquantes si nécessaire
        const alterations = [
            "ALTER TABLE courses ADD COLUMN file_size INTEGER DEFAULT 0",
            "ALTER TABLE courses ADD COLUMN rating REAL DEFAULT 0",
            "ALTER TABLE courses ADD COLUMN completion_percentage REAL DEFAULT 0",
            "ALTER TABLE lessons ADD COLUMN difficulty TEXT DEFAULT 'normal'",
            "ALTER TABLE lessons ADD COLUMN estimated_time INTEGER DEFAULT 0"
        ];
        
        alterations.forEach(sql => {
            try {
                this.db.exec(sql);
            } catch (error) {
                // Ignorer si la colonne existe déjà
                if (!error.message.includes('duplicate column
