// app.js - Application principale corrigée

// État global de l'application
const AppState = {
    currentCourse: null,
    currentLesson: null,
    isOnline: true,
    isInitialized: false
};

// Variables globales
let currentLesson = null;
let lessonProgress = 0;

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Initialisation de l\'application...');
    
    try {
        // Attendre que l'auth manager soit prêt
        await waitForAuthManager();
        
        // Initialiser les gestionnaires d'événements
        initializeEventHandlers();
        
        // Initialiser l'interface
        initializeUI();
        
        AppState.isInitialized = true;
        console.log('Application initialisée avec succès');
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de l\'app:', error);
        showError('Erreur lors de l\'initialisation de l\'application');
    }
});

// Attendre que l'AuthManager soit disponible
function waitForAuthManager() {
    return new Promise((resolve) => {
        const checkAuth = () => {
            if (window.AuthManager) {
                resolve();
            } else {
                setTimeout(checkAuth, 100);
            }
        };
        checkAuth();
    });
}

// Initialiser les gestionnaires d'événements
function initializeEventHandlers() {
    console.log('Initialisation des gestionnaires d\'événements...');
    
    // Navigation sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', handleNavigation);
    });
    
    // Boutons header
    setupHeaderButtons();
    
    // Modals
    setupModals();
    
    // Player controls
    setupPlayerControls();
    
    // Recherche
    setupSearch();
    
    // Download button
    setupDownloadButton();
    
    console.log('Gestionnaires d\'événements initialisés');
}

// Initialiser l'interface utilisateur
function initializeUI() {
    console.log('Initialisation de l\'interface utilisateur...');
    
    // Masquer tous les loaders initiaux
    hideLoader();
    
    // Vérifier si l'utilisateur est connecté
    if (window.AuthState && window.AuthState.isLoggedIn) {
        // L'utilisateur est déjà connecté, charger le dashboard
        loadDashboardData();
    }
    
    // Mettre à jour les informations de l'app
    updateAppInfo();
}

// Gérer la navigation
function handleNavigation(e) {
    e.preventDefault();
    
    if (!AppState.isInitialized) {
        console.warn('App not initialized yet');
        return;
    }
    
    // Retirer active de tous
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });
    
    // Ajouter active au cliqué
    e.currentTarget.classList.add('active');
    
    // Afficher la page correspondante
    const page = e.currentTarget.dataset.page;
    showContentPage(page);
    
    // Charger le contenu approprié
    loadPageContent(page);
}

// Afficher une page de contenu
function showContentPage(pageId) {
    document.querySelectorAll('.content-page').forEach(page => {
        page.classList.add('hidden');
    });
    
    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
}

// Charger le contenu d'une page
function loadPageContent(page) {
    switch (page) {
        case 'courses':
            loadCourses();
            break;
        case 'downloads':
            if (window.coursesManager) {
                window.coursesManager.loadDownloads();
            }
            break;
        case 'progress':
            loadProgress();
            break;
        default:
            console.warn('Page inconnue:', page);
    }
}

// Configurer les boutons du header
function setupHeaderButtons() {
    // Menu toggle (mobile)
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('active');
            }
        });
    }
    
    // Sync button
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (window.syncManager) {
                showLoader('Synchronisation en cours...');
                try {
                    await window.syncManager.performFullSync();
                    showSuccess('Synchronisation terminée');
                } catch (error) {
                    console.error('Erreur de synchronisation:', error);
                    showError('Erreur lors de la synchronisation');
                } finally {
                    hideLoader();
                }
            }
        });
    }
    
    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
                if (window.AuthManager) {
                    await window.AuthManager.performLogout();
                }
            }
        });
    }
    
    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.classList.remove('hidden');
            }
        });
    }
    
    // Search button
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const searchBar = document.getElementById('search-bar');
            if (searchBar) {
                searchBar.classList.toggle('hidden');
                if (!searchBar.classList.contains('hidden')) {
                    const searchInput = document.getElementById('search-input');
                    if (searchInput) {
                        searchInput.focus();
                    }
                }
            }
        });
    }
}

// Configurer les modals
function setupModals() {
    // Settings modal
    const closeSettingsBtn = document.getElementById('close-settings-modal');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            const modal = document.getElementById('settings-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }
    
    // Download modal
    const closeDownloadBtn = document.getElementById('close-download-modal');
    if (closeDownloadBtn) {
        closeDownloadBtn.addEventListener('click', () => {
            const modal = document.getElementById('download-modal');
            if (modal) {
                modal.classList.add('hidden');
            }
        });
    }
    
    // Fermer les modals en cliquant sur le backdrop
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            e.target.classList.add('hidden');
        }
    });
}

// Configurer les contrôles du player
function setupPlayerControls() {
    const backBtn = document.getElementById('back-to-courses');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showDashboard();
            // Recharger les cours pour voir la progression mise à jour
            loadCourses();
        });
    }
    
    const prevBtn = document.getElementById('prev-lesson');
    const nextBtn = document.getElementById('next-lesson');
    const completeBtn = document.getElementById('complete-lesson');
    
    if (prevBtn && window.previousLesson) {
        prevBtn.addEventListener('click', window.previousLesson);
    }
    
    if (nextBtn && window.nextLesson) {
        nextBtn.addEventListener('click', window.nextLesson);
    }
    
    if (completeBtn && window.completeCurrentLesson) {
        completeBtn.addEventListener('click', window.completeCurrentLesson);
    }
}

// Configurer la recherche
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            searchCourses(query);
        }, 300));
    }
}

// Configurer le bouton de téléchargement
function setupDownloadButton() {
    const downloadBtn = document.getElementById('download-course-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (window.coursesManager) {
                window.coursesManager.showDownloadModal();
            } else {
                showDownloadModal();
            }
        });
    }
}

// Charger les données du dashboard
async function loadDashboardData() {
    console.log('Chargement des données du dashboard...');
    
    try {
        // Charger les informations utilisateur
        await loadUserInfo();
        
        // Charger les cours
        await loadCourses();
        
        // Mettre à jour les informations de stockage
        await updateStorageInfo();
        
    } catch (error) {
        console.error('Erreur lors du chargement du dashboard:', error);
        showError('Erreur lors du chargement des données');
    }
}

// Charger les informations utilisateur
async function loadUserInfo() {
    try {
        const username = await window.electronAPI.store.get('username');
        if (username) {
            const userDisplay = document.getElementById('user-display-name');
            if (userDisplay) {
                userDisplay.textContent = username;
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des infos utilisateur:', error);
    }
}

// Charger les cours
// Dans src/js/app.js, modifier loadCourses() :

async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        // Utiliser la nouvelle API pour récupérer les cours de l'utilisateur
        const response = await window.electronAPI.api.getUserCourses({
            enrolled_only: true,
            page: 1,
            per_page: 50
        });
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        const courses = response.courses;
        // ... reste du code
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// Créer une carte de cours
function createCourseCard(course, progress) {
    const card = document.createElement('div');
    card.className = 'course-card card';
    card.dataset.courseId = course.course_id;
    
    const isExpired = isCourseExpired(course);
    const thumbnailUrl = course.thumbnail || 'assets/default-course.jpg';
    const progressPercentage = progress ? Math.round(progress.completion_percentage || 0) : 0;
    
    card.innerHTML = `
        <div class="course-thumbnail-wrapper">
            <img src="${escapeHtml(thumbnailUrl)}" 
                 alt="${escapeHtml(course.title)}" 
                 class="course-thumbnail"
                 onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMwMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTgwIiBmaWxsPSIjRjVGNUY1Ii8+CjxwYXRoIGQ9Ik0xMjAgODBMMTQwIDEwMEwxMjAgMTIwVjEwNUgxMDBWOTVIMTIwVjgwWiIgZmlsbD0iIzk5OTk5OSIvPgo8L3N2Zz4K'">
            ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
        </div>
        <div class="course-info">
            <h3 class="course-title">${escapeHtml(course.title)}</h3>
            <p class="course-instructor">${escapeHtml(course.instructor_name || 'Instructeur')}</p>
            <div class="course-stats">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${progressPercentage > 0 ? `<span>📊 ${progressPercentage}%</span>` : ''}
            </div>
        </div>
        ${progress ? `
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${progressPercentage}%"></div>
        </div>
        ` : ''}
        <div class="course-actions">
            <button class="btn btn-icon" onclick="event.stopPropagation(); deleteCourse(${course.course_id})" title="Supprimer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        </div>
    `;
    
    // Ajouter l'événement de clic
    card.addEventListener('click', () => {
        if (!isExpired) {
            openCourse(course.course_id);
        } else {
            showWarning('Ce cours a expiré et ne peut plus être consulté');
        }
    });
    
    return card;
}

// Ouvrir un cours
async function openCourse(courseId) {
    try {
        showLoader('Chargement du cours...');
        
        const response = await window.electronAPI.db.getCourse(courseId);
        if (!response.success) {
            throw new Error(response.error);
        }
        
        AppState.currentCourse = response.result;
        
        // Mettre à jour l'accès
        const accessResponse = await window.electronAPI.db.updateCourseAccess(courseId);
        if (!accessResponse.success) {
            console.warn('Erreur lors de la mise à jour de l\'accès:', accessResponse.error);
        }
        
        // Afficher le player
        showPlayer();
        
        // Charger le contenu du cours
        await loadCourseContent(courseId);
        
        hideLoader();
    } catch (error) {
        console.error('Erreur lors de l\'ouverture du cours:', error);
        hideLoader();
        showError('Impossible d\'ouvrir le cours');
    }
}

// Charger le contenu du cours
async function loadCourseContent(courseId) {
    try {
        const sectionsResponse = await window.electronAPI.db.getSections(courseId);
        if (!sectionsResponse.success) {
            throw new Error(sectionsResponse.error);
        }
        
        const sections = sectionsResponse.result;
        const container = document.getElementById('course-sections');
        if (!container) {
            throw new Error('Container course-sections non trouvé');
        }
        
        container.innerHTML = '';
        
        // Mettre à jour le titre du cours
        const titleElement = document.getElementById('course-title');
        if (titleElement && AppState.currentCourse) {
            titleElement.textContent = AppState.currentCourse.title;
        }
        
        for (const section of sections) {
            const lessonsResponse = await window.electronAPI.db.getLessons(section.section_id);
            if (!lessonsResponse.success) {
                console.error('Erreur lors du chargement des leçons:', lessonsResponse.error);
                continue;
            }
            
            const lessons = lessonsResponse.result;
            
            const sectionEl = document.createElement('div');
            sectionEl.className = 'course-section';
            sectionEl.innerHTML = `
                <h4 class="section-title">${escapeHtml(section.title)}</h4>
                <div class="section-lessons"></div>
            `;
            
            const lessonsContainer = sectionEl.querySelector('.section-lessons');
            
            for (const lesson of lessons) {
                const lessonEl = document.createElement('div');
                lessonEl.className = `lesson-item ${lesson.completed ? 'completed' : ''}`;
                lessonEl.dataset.lessonId = lesson.lesson_id;
                
                lessonEl.innerHTML = `
                    <span class="lesson-icon">
                        ${getLessonIcon(lesson.type)}
                    </span>
                    <span class="lesson-title">${escapeHtml(lesson.title)}</span>
                    <span class="lesson-duration">${lesson.duration || ''}</span>
                    ${lesson.completed ? '<span class="lesson-check">✓</span>' : ''}
                `;
                
                lessonEl.addEventListener('click', () => {
                    if (window.loadLesson) {
                        window.loadLesson(lesson.lesson_id);
                    }
                });
                
                lessonsContainer.appendChild(lessonEl);
            }
            
            container.appendChild(sectionEl);
        }
        
        // Charger la première leçon non complétée
        const firstIncomplete = container.querySelector('.lesson-item:not(.completed)');
        if (firstIncomplete) {
            firstIncomplete.click();
        } else {
            // Ou la première leçon si toutes sont complétées
            const firstLesson = container.querySelector('.lesson-item');
            if (firstLesson) {
                firstLesson.click();
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement du contenu:', error);
        showError('Impossible de charger le contenu du cours');
    }
}

// Supprimer un cours
async function deleteCourse(courseId) {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce cours ? Cette action est irréversible.')) {
        try {
            showLoader('Suppression du cours...');
            const response = await window.electronAPI.db.deleteCourse(courseId);
            
            if (!response.success) {
                throw new Error(response.error);
            }
            
            showSuccess('Cours supprimé avec succès');
            await loadCourses();
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            showError('Erreur lors de la suppression du cours');
        } finally {
            hideLoader();
        }
    }
}

// Rechercher des cours
async function searchCourses(query) {
    const container = document.getElementById('courses-container');
    if (!container) return;
    
    if (!query) {
        await loadCourses();
        return;
    }
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const response = await window.electronAPI.db.searchCourses(query);
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        const courses = response.result;
        
        if (courses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Aucun cours trouvé pour "${escapeHtml(query)}"</p>
                </div>
            `;
        } else {
            container.innerHTML = '<div class="courses-grid" id="courses-grid"></div>';
            const grid = document.getElementById('courses-grid');
            
            for (const course of courses) {
                const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id);
                const progress = progressResponse.success ? progressResponse.result : null;
                const card = createCourseCard(course, progress);
                grid.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors de la recherche</div>';
    }
}

// Charger la progression
async function loadProgress() {
    const container = document.getElementById('progress-container');
    if (!container) return;
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const coursesResponse = await window.electronAPI.db.getAllCourses();
        if (!coursesResponse.success) {
            throw new Error(coursesResponse.error);
        }
        
        const courses = coursesResponse.result;
        let html = '<div class="progress-list">';
        
        for (const course of courses) {
            const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id);
            const progress = progressResponse.success ? progressResponse.result : null;
            
            if (progress && progress.total_lessons > 0) {
                html += `
                    <div class="progress-item">
                        <h4>${escapeHtml(course.title)}</h4>
                        <div class="progress-stats">
                            <span>${progress.completed_lessons}/${progress.total_lessons} leçons terminées</span>
                            <span>${Math.round(progress.completion_percentage || 0)}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress.completion_percentage || 0}%"></div>
                        </div>
                    </div>
                `;
            }
        }
        
        if (html === '<div class="progress-list">') {
            html = '<div class="empty-state"><p>Aucune progression à afficher</p></div>';
        } else {
            html += '</div>';
        }
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur lors du chargement de la progression:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement</div>';
    }
}

// Mettre à jour les informations de stockage
async function updateStorageInfo() {
    try {
        const stats = await window.electronAPI.db.getStats();
        if (stats.success) {
            const totalGB = 5 * 1024 * 1024 * 1024; // 5 GB par défaut
            const used = stats.result.dbSize || 0;
            const percentage = Math.min((used / totalGB) * 100, 100);
            
            const storageBar = document.getElementById('storage-bar');
            const storageText = document.getElementById('storage-text');
            
            if (storageBar) {
                storageBar.style.width = `${percentage}%`;
            }
            
            if (storageText) {
                storageText.textContent = `${formatFileSize(used)} / 5 GB`;
            }
        }
    } catch (error) {
        console.error('Erreur calcul stockage:', error);
    }
}

// Mettre à jour les informations de l'app
async function updateAppInfo() {
    try {
        const version = await window.electronAPI.getAppVersion();
        const versionElement = document.getElementById('app-version');
        if (versionElement) {
            versionElement.textContent = version;
        }
    } catch (error) {
        console.error('Erreur lors de la récupération de la version:', error);
    }
}

// Fonctions UI helpers
function showPlayer() {
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (dashboardPage) dashboardPage.classList.add('hidden');
    if (playerPage) playerPage.classList.remove('hidden');
}

function showDashboard() {
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (dashboardPage) dashboardPage.classList.remove('hidden');
    if (playerPage) playerPage.classList.add('hidden');
}

function showDownloadModal() {
    const modal = document.getElementById('download-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

// Utilitaires
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'mp4': '🎥', 'avi': '🎥', 'mov': '🎥',
        'pdf': '📕', 'doc': '📄', 'docx': '📄',
        'jpg': '🖼️', 'png': '🖼️',
        'mp3': '🎵',
        'zip': '📦'
    };
    return icons[ext] || '📎';
}

function getMediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'avi', 'mov', 'mkv', 'webm'];
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'ppt', 'pptx'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg'];
    
    if (videoExts.includes(ext)) return 'video';
    if (docExts.includes(ext)) return 'document';
    if (imageExts.includes(ext)) return 'image';
    
    return 'other';
}

function getLessonIcon(type) {
    const icons = {
        'video': '🎥',
        'text': '📄',
        'quiz': '❓',
        'assignment': '📋',
        'pdf': '📕'
    };
    return icons[type] || '📄';
}

function isCourseExpired(course) {
    if (!course.expires_at) return false;
    return new Date(course.expires_at) < new Date();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Fonctions de notification
function showLoader(message = 'Chargement...') {
    const loader = document.getElementById('global-loader');
    if (loader) {
        const text = loader.querySelector('p');
        if (text) text.textContent = message;
        loader.classList.add('show');
    }
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('show');
    }
}

function showError(message) {
    showNotification(message, 'error');
}

function showSuccess(message) {
    showNotification(message, 'success');
}

function showWarning(message) {
    showNotification(message, 'warning');
}

function showNotification(message, type = 'info') {
    // Supprimer les anciennes notifications du même type
    const oldNotifications = document.querySelectorAll(`.notification-${type}`);
    oldNotifications.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type} show`;
    
    const icons = {
        'success': '✅',
        'error': '❌',
        'warning': '⚠️',
        'info': 'ℹ️'
    };
    
    notification.innerHTML = `
        <span class="notification-icon">${icons[type] || 'ℹ️'}</span>
        <span class="notification-message">${escapeHtml(message)}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-supprimer après 5 secondes
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Exports globaux
window.loadCourses = loadCourses;
window.openCourse = openCourse;
window.deleteCourse = deleteCourse;
window.searchCourses = searchCourses;
window.updateStorageInfo = updateStorageInfo;
window.showDownloadModal = showDownloadModal;
window.AppState = AppState;
