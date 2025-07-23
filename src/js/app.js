// src/js/app.js - Version COMPLÈTE avec les nouvelles fonctions

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
        loadDashboardData();
    }
    
    // Mettre à jour les informations de l'app
    updateAppInfo();
}

// ========== NOUVELLES FONCTIONS AJOUTÉES ==========

// Fonction robuste pour s'assurer que les cours sont chargés
window.ensureCoursesLoaded = async function() {
    console.log('[App] Ensuring courses are loaded...');
    
    // Attendre que le DOM soit prêt
    if (document.readyState === 'loading') {
        console.log('[App] Waiting for DOM to be ready...');
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve);
        });
    }
    
    // Attendre que les modules soient chargés
    let attempts = 0;
    const maxAttempts = 20; // 4 secondes max
    
    while (attempts < maxAttempts) {
        const container = document.getElementById('courses-container') || 
                         document.getElementById('courses-list');
        
        console.log(`[App] Attempt ${attempts + 1}/${maxAttempts} - Container: ${!!container}, loadCourses: ${!!window.loadCourses}`);
        
        if (container && window.loadCourses) {
            try {
                console.log('[App] Container and function found, loading courses...');
                await window.loadCourses();
                console.log('[App] Courses loaded successfully');
                return true;
            } catch (error) {
                console.error('[App] Error loading courses:', error);
                // Si c'est une erreur réseau, on peut réessayer
                if (error.message && error.message.includes('network')) {
                    console.log('[App] Network error, will retry...');
                } else {
                    // Pour les autres erreurs, on arrête
                    throw error;
                }
            }
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Si on arrive ici, c'est qu'on a dépassé le timeout
    const container = document.getElementById('courses-container');
    if (!container) {
        throw new Error('Container de cours introuvable après 4 secondes');
    } else if (!window.loadCourses) {
        throw new Error('Fonction loadCourses introuvable après 4 secondes');
    } else {
        throw new Error('Timeout: Impossible de charger les cours après 20 tentatives');
    }
};

// Ajouter aussi une fonction pour débugger
window.debugLoadingState = function() {
    console.log('[Debug] Loading state:');
    console.log('- DOM ready:', document.readyState);
    console.log('- Auth state:', window.AuthState);
    console.log('- Courses container:', !!document.getElementById('courses-container'));
    console.log('- Courses list:', !!document.getElementById('courses-list'));
    console.log('- loadCourses function:', !!window.loadCourses);
    console.log('- coursesManager:', !!window.coursesManager);
    console.log('- Active page:', document.querySelector('.page.active')?.id);
};

// ========== FIN DES NOUVELLES FONCTIONS ==========

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
    
    // Mettre à jour le titre
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
        const titles = {
            'dashboard': 'Tableau de bord',
            'courses': 'Mes cours',
            'downloads': 'Téléchargements'
        };
        pageTitle.textContent = titles[page] || 'LearnPress Offline';
    }
    
    // Charger le contenu approprié
    loadPageContent(page);
}

// Afficher une page de contenu
function showContentPage(pageId) {
    document.querySelectorAll('.content-page').forEach(page => {
        page.classList.add('hidden');
    });
    
    const targetPage = document.getElementById(`${pageId}-content`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        
        // Mettre à jour le titre de la page
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
            const titles = {
                'dashboard': 'Tableau de bord',
                'courses': 'Mes cours',
                'downloads': 'Téléchargements',
                'progress': 'Ma progression'
            };
            pageTitle.textContent = titles[pageId] || pageId;
        }
    }
}

// Charger le contenu d'une page
function loadPageContent(page) {
    switch (page) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'courses':
            loadCoursesPage();
            break;
        case 'downloads':
            loadDownloadsPage();
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
            console.log('Paramètres - À implémenter');
        });
    }
}

// Configurer les modals
function setupModals() {
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
            loadCourses();
        });
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
            console.log('Ouvrir modal de téléchargement');
            showInfo('Fonctionnalité de téléchargement en cours de développement');
        });
    }
}

// Charger les données du dashboard
async function loadDashboardData() {
    console.log('Chargement des données du dashboard...');
    
    try {
        // Charger les cours
        await loadCourses();
        
        // Mettre à jour les statistiques
        await updateStats();
        
        // Mettre à jour les informations de stockage
        await updateStorageInfo();
        
    } catch (error) {
        console.error('Erreur lors du chargement du dashboard:', error);
        showError('Erreur lors du chargement des données');
    }
}

// Charger les cours - CORRECTION
async function loadCourses() {
    const container = document.getElementById('courses-container');
    const coursesListContainer = document.getElementById('courses-list');
    
    // Utiliser le bon container selon la page
    const activeContainer = container || coursesListContainer;
    if (!activeContainer) {
        console.error('[App] Aucun container trouvé pour les cours');
        return;
    }
    
    activeContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        // 1. D'abord charger les cours locaux (offline first)
        const localResponse = await window.electronAPI.db.getAllCourses();
        if (localResponse.success && localResponse.result.length > 0) {
            await displayCourses(localResponse.result, activeContainer, true);
        }
        
        // 2. Ensuite, essayer de récupérer les cours en ligne
        const onlineResponse = await window.electronAPI.api.getUserCourses({
            enrolled_only: true,
            page: 1,
            per_page: 50
        });
        
        if (onlineResponse.success) {
            const onlineCourses = onlineResponse.courses;
            console.log('[App] Cours en ligne récupérés:', onlineCourses.length);
            
            // Mettre à jour l'affichage avec les cours en ligne
            await displayCourses(onlineCourses, activeContainer, false);
            
            // Mettre à jour les statistiques
            updateDashboardStats(onlineCourses);
        } else {
            console.warn('[App] Impossible de récupérer les cours en ligne:', onlineResponse.error);
            // Garder l'affichage des cours locaux
        }
        
    } catch (error) {
        console.error('[App] Erreur lors du chargement des cours:', error);
        
        // En cas d'erreur, afficher uniquement les cours locaux
        try {
            const localResponse = await window.electronAPI.db.getAllCourses();
            if (localResponse.success && localResponse.result.length > 0) {
                await displayCourses(localResponse.result, activeContainer, true);
            } else {
                activeContainer.innerHTML = `
                    <div class="empty-state">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                        </svg>
                        <p>Aucun cours disponible</p>
                        <p class="text-muted">Connectez-vous pour voir vos cours</p>
                    </div>
                `;
            }
        } catch (dbError) {
            console.error('[App] Erreur DB:', dbError);
            activeContainer.innerHTML = '<div class="message message-error">Erreur lors du chargement des cours</div>';
        }
    }
}

// Afficher les cours
async function displayCourses(courses, container, isLocal = false) {
    if (!courses || courses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                </svg>
                <p>Aucun cours disponible</p>
                ${!isLocal ? '<button class="btn btn-primary" onclick="showDownloadModal()">Télécharger un cours</button>' : ''}
            </div>
        `;
        return;
    }
    
    // Créer la grille de cours
    container.innerHTML = '<div class="courses-grid" id="courses-grid"></div>';
    const grid = document.getElementById('courses-grid');
    
    // Obtenir les cours téléchargés pour comparaison
    let downloadedCourseIds = new Set();
    if (!isLocal) {
        try {
            const localCoursesResponse = await window.electronAPI.db.getAllCourses();
            if (localCoursesResponse.success) {
                downloadedCourseIds = new Set(localCoursesResponse.result.map(c => c.course_id));
            }
        } catch (error) {
            console.error('[App] Erreur lors de la récupération des cours locaux:', error);
        }
    }

    // Afficher chaque cours
    for (const course of courses) {
        try {
            // Récupérer la progression si disponible
            let progress = null;
            if (isLocal || downloadedCourseIds.has(course.id || course.course_id)) {
                const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id || course.id);
                progress = progressResponse.success ? progressResponse.result : null;
            }
            
            // Créer la carte du cours
            const card = createCourseCard(course, progress);
            
            // Ajouter un badge si le cours est téléchargé
            if (!isLocal && downloadedCourseIds.has(course.id || course.course_id)) {
                const badge = document.createElement('div');
                badge.className = 'course-downloaded-badge';
                badge.innerHTML = '💾';
                badge.title = 'Cours téléchargé';
                card.querySelector('.course-thumbnail-wrapper').appendChild(badge);
            }
            
            grid.appendChild(card);
            
        } catch (error) {
            console.error('[App] Erreur lors de l\'affichage du cours:', error);
        }
    }
}

// Mettre à jour les statistiques du dashboard
function updateDashboardStats(courses) {
    try {
        // Nombre de cours
        const statCourses = document.getElementById('stat-courses');
        if (statCourses) {
            statCourses.textContent = courses.length;
        }
        
        // Cours terminés
        const completedCourses = courses.filter(c => c.completed).length;
        const statCompleted = document.getElementById('stat-completed');
        if (statCompleted) {
            statCompleted.textContent = completedCourses;
        }
        
        // Progression moyenne
        const totalProgress = courses.reduce((sum, course) => sum + (course.progress || 0), 0);
        const avgProgress = courses.length > 0 ? Math.round(totalProgress / courses.length) : 0;
        const statProgress = document.getElementById('stat-progress');
        if (statProgress) {
            statProgress.textContent = `${avgProgress}%`;
        }
        
        // Mettre à jour le compteur dans le menu
        const coursesCount = document.getElementById('courses-count');
        if (coursesCount) {
            coursesCount.textContent = courses.length;
        }
        
    } catch (error) {
        console.error('[App] Erreur lors de la mise à jour des stats:', error);
    }
}

// Créer une carte de cours
async function createCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card';
    card.dataset.courseId = course.course_id || course.id;
    
    // Style pour la carte
    card.style.cssText = `
        background: var(--bg-card);
        border-radius: var(--radius);
        overflow: hidden;
        border: 1px solid var(--border-color);
        cursor: pointer;
        transition: all 0.3s;
        position: relative;
    `;
    
    const isExpired = isCourseExpired(course);
    const thumbnailUrl = course.thumbnail || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMwMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTgwIiBmaWxsPSIjMjAyMDIwIi8+CjxwYXRoIGQ9Ik0xNTAgOTBDMTUwIDEwMy4yNTUgMTM5LjI1NSAxMTQgMTI2IDExNEMxMTIuNzQ1IDExNCAxMDIgMTAzLjI1NSAxMDIgOTBDMTAyIDc2Ljc0NTIgMTEyLjc0NSA2NiAxMjYgNjZDMTM5LjI1NSA2NiAxNTAgNzYuNzQ1MiAxNTAgOTBaIiBmaWxsPSIjNDA0MDQwIi8+CjwvcGc+';
    
    // Obtenir la progression
    let progressPercentage = 0;
    try {
        const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id || course.id);
        if (progressResponse.success && progressResponse.result) {
            progressPercentage = Math.round(progressResponse.result.completion_percentage || 0);
        }
    } catch (error) {
        console.error('Erreur lors de la récupération de la progression:', error);
    }
    
    card.innerHTML = `
        <div style="position: relative; height: 180px; background: #1a1a1a; overflow: hidden;">
            <img src="${escapeHtml(thumbnailUrl)}" 
                 alt="${escapeHtml(course.title)}" 
                 style="width: 100%; height: 100%; object-fit: cover;"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: var(--bg-hover);">
                <span style="font-size: 48px;">📚</span>
            </div>
            ${isExpired ? '<div style="position: absolute; top: 10px; right: 10px; background: var(--danger); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Expiré</div>' : ''}
        </div>
        <div style="padding: 20px;">
            <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 600;">
                ${escapeHtml(course.title)}
            </h3>
            <p style="margin: 0 0 12px; color: var(--text-secondary); font-size: 14px;">
                ${escapeHtml(course.instructor_name || 'Instructeur')}
            </p>
            <div style="display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); flex-wrap: wrap;">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${progressPercentage > 0 ? `<span style="color: var(--success);">✓ ${progressPercentage}%</span>` : ''}
            </div>
        </div>
        ${progressPercentage > 0 ? `
            <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: var(--bg-hover);">
                <div style="height: 100%; width: ${progressPercentage}%; background: var(--primary); transition: width 0.3s;"></div>
            </div>
        ` : ''}
    `;
    
    // Ajouter les événements
    card.addEventListener('click', () => {
        if (!isExpired) {
            openCourse(course.course_id || course.id);
        } else {
            showWarning('Ce cours a expiré et ne peut plus être consulté');
        }
    });
    
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
    });
    
    card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.boxShadow = '';
    });
    
    return card;
}

// Ouvrir un cours
async function openCourse(courseId) {
    console.log('Ouverture du cours:', courseId);
    showInfo('Ouverture du cours en cours de développement');
    // TODO: Implémenter l'ouverture du cours
}

// Charger la page des cours
async function loadCoursesPage() {
    const container = document.getElementById('courses-list');
    if (container) {
        container.innerHTML = '<p>Liste complète des cours...</p>';
    }
}

// Charger la page des téléchargements
async function loadDownloadsPage() {
    const container = document.getElementById('downloads-list');
    if (container) {
        container.innerHTML = '<p>Aucun téléchargement en cours</p>';
    }
}

// Mettre à jour les statistiques
async function updateStats() {
    try {
        const stats = await window.electronAPI.db.getStats();
        if (stats.success) {
            const statCourses = document.getElementById('stat-courses');
            const statCompleted = document.getElementById('stat-completed');
            const statProgress = document.getElementById('stat-progress');
            
            if (statCourses) statCourses.textContent = stats.result.courses || 0;
            if (statCompleted) statCompleted.textContent = '0'; // TODO: Calculer
            if (statProgress) statProgress.textContent = '0%'; // TODO: Calculer
        }
    } catch (error) {
        console.error('Erreur lors de la mise à jour des stats:', error);
    }
}

// Mettre à jour les informations de stockage
async function updateStorageInfo() {
    // TODO: Implémenter le calcul du stockage
    console.log('Mise à jour des infos de stockage');
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

// Rechercher des cours
async function searchCourses(query) {
    console.log('Recherche:', query);
    // TODO: Implémenter la recherche
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

// Utilitaires
function isCourseExpired(course) {
    if (!course.expires_at) return false;
    return new Date(course.expires_at) < new Date();
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

// Notifications
function showLoader(message = 'Chargement...') {
    console.log('Loader:', message);
}

function hideLoader() {
    console.log('Hide loader');
}

function showError(message) {
    console.error('Erreur:', message);
    alert('Erreur: ' + message);
}

function showSuccess(message) {
    console.log('Succès:', message);
    alert('Succès: ' + message);
}

function showWarning(message) {
    console.warn('Avertissement:', message);
    alert('Attention: ' + message);
}

function showInfo(message) {
    console.info('Info:', message);
    alert('Info: ' + message);
}

// Exports globaux
window.loadCourses = loadCourses;
window.openCourse = openCourse;
window.searchCourses = searchCourses;
window.updateStorageInfo = updateStorageInfo;
window.showDashboard = showDashboard;
window.showPlayer = showPlayer;
window.AppState = AppState;
