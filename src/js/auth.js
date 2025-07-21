// auth.js - Gestion de l'authentification

// Gestionnaire du formulaire de connexion
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    // Validation des entrées
    if (!apiUrl || !username || !password) {
        showLoginError('Veuillez remplir tous les champs');
        return;
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

    // Valider l'URL
    if (!Utils.isValidUrl(apiUrl)) {
        showLoginError('URL invalide. Veuillez entrer une URL valide (ex: https://votre-site.com)');
        return;
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

    // Afficher le loader
    setLoginLoading(true);
    hideLoginError();
    
    try {
        // Tenter la connexion via l'API exposée par le preload
        const result = await window.electronAPI.api.login(apiUrl, username, password);

        // Par (pour gérer les erreurs d'abonnement)
        const result = await window.electronAPI.api.login(apiUrl, username, password);
        
        if (!result.success && result.requiresMembership) {
            showLoginError('Vous devez avoir un abonnement actif pour utiliser l\'application');
            // Optionnel : Ajouter un lien vers la page d'abonnement
            const subscribeLink = document.createElement('a');
            subscribeLink.href = 'https://teachmemore.fr/nos-tarifs/';
            subscribeLink.textContent = 'Souscrire à un abonnement';
            subscribeLink.onclick = () => window.electronAPI.openExternal(`${apiUrl}/membership-account/membership-checkout/`);
            document.getElementById('login-error').appendChild(subscribeLink);
            return;
        }
                
        
        if (result.success) {
            // Sauvegarder les informations de connexion
            await window.electronAPI.store.set('apiUrl', apiUrl);
            await window.electronAPI.store.set('username', username);
            await window.electronAPI.store.set('userId', result.user.id);
    createTables() {
        try {
            // Lire le schéma SQL
            const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

            // Se souvenir de l'URL et du nom d'utilisateur si demandé
            if (rememberMe) {
                await window.electronAPI.store.set('savedApiUrl', apiUrl);
                await window.electronAPI.store.set('savedUsername', username);
            } else {
                await window.electronAPI.store.set('savedApiUrl', '');
                await window.electronAPI.store.set('savedUsername', '');
            if (!fs.existsSync(schemaPath)) {
                // Créer un schéma de base si le fichier n'existe pas
                this.createBasicSchema();
                return;
            }

            // Mettre à jour l'état global
            AppState.currentUser = result.user;
            AppState.isAuthenticated = true;
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
            
            // Logger le succès
            Logger.log('Connexion réussie', { userId: result.user.id });
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
            
            // Afficher le dashboard
            showDashboard();
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
            
            // Synchronisation initiale après un court délai
            setTimeout(() => {
                window.syncManager.performFullSync();
            }, 1000);
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
            
        } else {
            showLoginError(result.error || 'Échec de la connexion');
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
    } catch (error) {
        console.error('Erreur de connexion:', error);
        
        // Gérer les différents types d'erreurs
        let errorMessage = 'Erreur de connexion. Veuillez réessayer.';
        
        if (error.message) {
            if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Impossible de se connecter au serveur. Vérifiez l\'URL et votre connexion internet.';
            } else if (error.message.includes('401')) {
                errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
            } else if (error.message.includes('403')) {
                errorMessage = 'Accès refusé. Vérifiez vos permissions.';
            } else if (error.message.includes('ETIMEDOUT')) {
                errorMessage = 'Délai de connexion dépassé. Vérifiez votre connexion internet.';
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

        showLoginError(errorMessage);
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

        // Logger l'erreur
        window.electronAPI.logError({
            message: 'Erreur de connexion',
            error: error.toString(),
            apiUrl: apiUrl
        });
    } finally {
        setLoginLoading(false);
        return this.run(sql, params);
    }
});

// Charger les informations sauvegardées au démarrage
async function loadSavedCredentials() {
    try {
        const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
        const savedUsername = await window.electronAPI.store.get('savedUsername');
        
        if (savedApiUrl) {
            document.getElementById('api-url').value = savedApiUrl;
        }
    
    getCourse(courseId) {
        const sql = 'SELECT * FROM courses WHERE course_id = ?';
        const course = this.get(sql, [courseId]);

        if (savedUsername) {
            document.getElementById('username').value = savedUsername;
            document.getElementById('remember-me').checked = true;
        }
        if (!course) return null;

        // Focus sur le champ approprié
        if (savedApiUrl && savedUsername) {
            document.getElementById('password').focus();
        } else if (savedApiUrl) {
            document.getElementById('username').focus();
        } else {
            document.getElementById('api-url').focus();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des credentials:', error);
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
}

// Afficher/masquer le loader de connexion
function setLoginLoading(loading) {
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');
    
    if (loading) {
        loginBtn.disabled = true;
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
    } else {
        loginBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    
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
}

// Afficher une erreur de connexion
function showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // Animation
    errorDiv.style.animation = 'shake 0.5s';
    setTimeout(() => {
        errorDiv.style.animation = '';
    }, 500);
}

// Masquer l'erreur de connexion
function hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    errorDiv.classList.add('hidden');
}

// Gérer la déconnexion forcée (token expiré, etc.)
async function handleAuthError() {
    // Nettoyer les tokens
    await window.electronAPI.store.set('token', '');
    await window.electronAPI.store.set('refreshToken', '');
    
    // Réinitialiser l'état
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
    
    // Afficher la page de connexion avec un message
    showLoginPage();
    showLoginError('Votre session a expiré. Veuillez vous reconnecter.');
    
    // Logger l'événement
    Logger.log('Session expirée, déconnexion forcée');
}

// Rafraîchir le token automatiquement
async function setupTokenRefresh() {
    // Vérifier le token toutes les 30 minutes
    setInterval(async () => {
        if (AppState.isAuthenticated) {
            try {
                const result = await window.electronAPI.api.refreshToken();
                if (result.success) {
                    Logger.log('Token rafraîchi avec succès');
                } else {
                    handleAuthError();
                }
            } catch (error) {
                console.error('Erreur lors du rafraîchissement du token:', error);
                handleAuthError();
            }
        }
    }, 30 * 60 * 1000); // 30 minutes
}

// Vérifier la validité de l'abonnement
async function checkSubscriptionStatus() {
    if (!AppState.isAuthenticated) return null;

    try {
        const result = await window.electronAPI.api.verifySubscription();
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

        if (!result.success || !result.isActive) {
            showMessage('Votre abonnement a expiré. Certaines fonctionnalités peuvent être limitées.', 'warning');
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
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'abonnement:', error);
        return null;
    }
}

// Gestion du mot de passe
document.getElementById('password')?.addEventListener('keydown', (e) => {
    // Afficher/masquer le mot de passe avec Ctrl+Shift
    if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        const input = e.target;
        input.type = input.type === 'password' ? 'text' : 'password';
        
        // Remasquer après 2 secondes
        setTimeout(() => {
            input.type = 'password';
        }, 2000);
    }
});

// Validation en temps réel
document.getElementById('api-url')?.addEventListener('blur', (e) => {
    const url = e.target.value;
    if (url && !Utils.isValidUrl(url)) {
        e.target.classList.add('error');
        showLoginError('URL invalide');
    } else {
        e.target.classList.remove('error');
        hideLoginError();
    }
});

document.getElementById('username')?.addEventListener('blur', (e) => {
    const username = e.target.value;
    if (username && username.includes('@') && !Utils.isValidEmail(username)) {
        e.target.classList.add('error');
        showLoginError('Email invalide');
    } else {
        e.target.classList.remove('error');
        hideLoginError();
    }
});

// Animation du logo au survol
const loginLogo = document.querySelector('.login-logo');
if (loginLogo) {
    loginLogo.addEventListener('mouseenter', () => {
        loginLogo.style.transform = 'rotate(360deg) scale(1.1)';
    });
    
    loginLogo.addEventListener('mouseleave', () => {
        loginLogo.style.transform = 'rotate(0deg) scale(1)';
    });
}

// Styles CSS pour la page de connexion
const loginStyles = `
<style>
.login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    position: relative;
    overflow: hidden;
}

.login-container::before {
    content: '';
    position: absolute;
    width: 200%;
    height: 200%;
    background-image: 
        radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 0%, transparent 50%),
        radial-gradient(circle at 80% 80%, rgba(255,255,255,0.1) 0%, transparent 50%);
    animation: float 20s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    33% { transform: translate(30px, -30px) rotate(120deg); }
    66% { transform: translate(-20px, 20px) rotate(240deg); }
}

.login-box {
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    width: 100%;
    max-width: 400px;
    position: relative;
    z-index: 1;
    animation: slideIn 0.5s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(30px);
    
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
    to {
        opacity: 1;
        transform: translateY(0);
    
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

.login-header {
    text-align: center;
    margin-bottom: 30px;
}

.login-logo {
    width: 80px;
    height: 80px;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    border-radius: 20px;
    transition: transform 0.5s ease;
    cursor: pointer;
}

.login-logo svg {
    width: 50px;
    height: 50px;
}

.app-title {
    font-size: 28px;
    font-weight: 700;
    color: var(--primary-color);
    margin-bottom: 8px;
}

.app-subtitle {
    color: var(--text-secondary);
    font-size: 16px;
}

.form-control.error {
    border-color: var(--danger-color);
}

.checkbox-label {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
}

.checkbox-label input {
    margin-right: 8px;
}

.btn-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
}
</style>
`;

// Ajouter les styles au document
document.head.insertAdjacentHTML('beforeend', loginStyles);

// Charger les credentials sauvegardés au démarrage
document.addEventListener('DOMContentLoaded', () => {
    loadSavedCredentials();
    setupTokenRefresh();
});

// Export des fonctions pour utilisation externe
window.authManager = {
    handleAuthError,
    checkSubscriptionStatus,
    setupTokenRefresh
};
module.exports = SecureDatabase;
