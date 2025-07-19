// app.js - Logique principale de l'application (Renderer Process)

// État global de l'application
const AppState = {
    currentUser: null,
    currentPage: 'login',
    currentCourse: null,
    currentLesson: null,
    isAuthenticated: false
};

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Application LearnPress Offline démarrée');
    
    // Vérifier l'authentification
    await checkAuthentication();
    
    // Initialiser les gestionnaires d'événements
    initializeEventHandlers();
    
    // Initialiser la navigation
    initializeNavigation();
    
    // Écouter les événements IPC
    initializeIPCListeners();
});

// Vérifier l'authentification
async function checkAuthentication() {
    try {
        const token = await window.electronAPI.store.get('token');
        const apiUrl = await window.electronAPI.store.get('apiUrl');
        const userId = await window.electronAPI.store.get('userId');
        
        if (token && apiUrl) {
            // Vérifier la validité du token
            const result = await window.electronAPI.api.verifySubscription();
            
            if (result.success) {
                AppState.currentUser = { id: userId };
                AppState.isAuthenticated = true;
                showDashboard();
                
                // Synchronisation automatique si activée
                const autoSync = await window.electronAPI.store.get('autoSync');
                if (autoSync !== false) {
                    setTimeout(() => syncCourses(), 2000);
                }
            } else {
                showLoginPage();
            }
        } else {
            showLoginPage();
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'authentification:', error);
        showLoginPage();
    }
}


// Après la connexion réussie, vérifier périodiquement l'abonnement
async function checkMembershipStatus() {
    if (!AppState.isAuthenticated) return;
    
    const result = await window.electronAPI.api.verifySubscription();
    
    if (!result.isActive) {
        // Afficher une bannière d'avertissement
        showMembershipWarning(result.subscription);
        
        // Limiter l'accès aux fonctionnalités
        disablePremiumFeatures();
    }
}

function showMembershipWarning(subscription) {
    const banner = document.createElement('div');
    banner.className = 'membership-warning-banner';
    banner.innerHTML = `
        <div class="warning-content">
            <span>⚠️ Votre abonnement ${subscription.level_name || ''} a expiré</span>
            <button onclick="window.electronAPI.openExternal('${AppState.apiUrl}/membership-account/')">
                Renouveler
            </button>
        </div>
    `;
    document.body.insertBefore(banner, document.body.firstChild);
}

// Vérifier toutes les heures
setInterval(checkMembershipStatus, 60 * 60 * 1000);

// Initialiser les gestionnaires d'événements
function initializeEventHandlers() {
    // Menu toggle (mobile)
    document.getElementById('menu-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('active');
    });
    
    // Recherche
    document.getElementById('search-btn')?.addEventListener('click', () => {
        const searchBar = document.getElementById('search-bar');
        searchBar.classList.toggle('hidden');
        if (!searchBar.classList.contains('hidden')) {
            document.getElementById('search-input').focus();
        }
    });
    
    // Recherche en temps réel
    let searchTimeout;
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchCourses(e.target.value);
        }, 300);
    });
    
    // Synchronisation
    document.getElementById('sync-btn')?.addEventListener('click', syncCourses);
    
    // Paramètres
    document.getElementById('settings-btn')?.addEventListener('click', showSettings);
    
    // Déconnexion
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    
    // Retour aux cours
    document.getElementById('back-to-courses')?.addEventListener('click', () => {
        showDashboard();
        loadCourses();
    });
}

// Initialiser la navigation
function initializeNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Mettre à jour l'état actif
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Afficher la page correspondante
            const page = item.dataset.page;
            showContentPage(page);
        });
    });
}

// Initialiser les écouteurs IPC
function initializeIPCListeners() {
    window.electronAPI.on('sync-courses', () => {
        syncCourses();
    });
    
    window.electronAPI.on('logout', () => {
        logout();
    });
    
    window.electronAPI.on('update-progress', (data) => {
        updateProgressDisplay(data);
    });
    
    window.electronAPI.on('download-progress', (data) => {
        updateDownloadProgress(data);
    });
    
    window.electronAPI.on('course-downloaded', (data) => {
        onCourseDownloaded(data);
    });
}

// Afficher la page de connexion
function showLoginPage() {
    hideAllPages();
    document.getElementById('login-page').classList.remove('hidden');
    AppState.currentPage = 'login';
    AppState.isAuthenticated = false;
}

// Afficher le dashboard
function showDashboard() {
    hideAllPages();
    document.getElementById('dashboard-page').classList.remove('hidden');
    AppState.currentPage = 'dashboard';
    
    // Charger les informations utilisateur
    loadUserInfo();
    
    // Charger les cours
    loadCourses();
    
    // Mettre à jour l'espace de stockage
    updateStorageInfo();
}

// Afficher le lecteur
function showPlayer() {
    hideAllPages();
    document.getElementById('player-page').classList.remove('hidden');
    AppState.currentPage = 'player';
}

// Afficher une page de contenu
function showContentPage(page) {
    const contentPages = document.querySelectorAll('.content-page');
    contentPages.forEach(p => p.classList.add('hidden'));
    
    const targetPage = document.getElementById(`${page}-page`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        
        // Charger le contenu de la page
        switch(page) {
            case 'courses':
                loadCourses();
                break;
            case 'downloads':
                loadDownloads();
                break;
            case 'progress':
                loadProgress();
                break;
        }
    }
}

// Masquer toutes les pages
function hideAllPages() {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
}

// Charger les informations utilisateur
async function loadUserInfo() {
    try {
        const username = await window.electronAPI.store.get('username');
        document.getElementById('user-display-name').textContent = username || 'Utilisateur';
    } catch (error) {
        console.error('Erreur lors du chargement des infos utilisateur:', error);
    }
}

// Charger les cours
async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const courses = await window.electronAPI.db.getAllCourses();
        
        if (courses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                        <path d="M12 2l-5.5 9h11z"/>
                        <circle cx="17.5" cy="17.5" r="4.5"/>
                        <path d="M3 13.5h8v8H3z"/>
                    </svg>
                    <h3>Aucun cours téléchargé</h3>
                    <p>Cliquez sur "Télécharger un cours" pour commencer</p>
                </div>
            `;
        } else {
            container.innerHTML = '<div class="courses-grid" id="courses-grid"></div>';
            const grid = document.getElementById('courses-grid');
            
            for (const course of courses) {
                const progress = await window.electronAPI.db.getCourseProgress(course.course_id);
                const card = createCourseCard(course, progress);
                grid.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement des cours</div>';
    }
}

// Créer une carte de cours
function createCourseCard(course, progress) {
    const card = document.createElement('div');
    card.className = 'card course-card';
    card.dataset.courseId = course.course_id;
    
    const progressPercent = progress ? Math.round((progress.completed_lessons / progress.total_lessons) * 100) : 0;
    
    card.innerHTML = `
        <img src="${course.thumbnail || '../assets/images/placeholder.png'}" 
             alt="${course.title}" class="course-thumbnail"
             onerror="this.src='../assets/images/placeholder.png'">
        <div class="course-info">
            <h3 class="course-title">${course.title}</h3>
            <p class="course-instructor">${course.instructor_name || 'Instructeur'}</p>
            <div class="course-stats">
                <span>📚 ${progress?.total_lessons || 0} leçons</span>
                <span>⏱️ ${course.duration || '0h'}</span>
            </div>
        </div>
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="course-actions">
            <button class="btn btn-icon" onclick="openCourse(${course.course_id})" title="Ouvrir">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </button>
            <button class="btn btn-icon" onclick="deleteCourse(${course.course_id})" title="Supprimer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        </div>
    `;
    
    // Double-clic pour ouvrir
    card.addEventListener('dblclick', () => openCourse(course.course_id));
    
    return card;
}

// Ouvrir un cours
async function openCourse(courseId) {
    try {
        showLoader('Chargement du cours...');
        
        AppState.currentCourse = await window.electronAPI.db.getCourse(courseId);
        await window.electronAPI.db.updateCourseAccess(courseId);
        
        showPlayer();
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
        const sections = await window.electronAPI.db.getSections(courseId);
        const container = document.getElementById('course-sections');
        container.innerHTML = '';
        
        document.getElementById('course-title').textContent = AppState.currentCourse.title;
        
        for (const section of sections) {
            const lessons = await window.electronAPI.db.getLessons(section.section_id);
            
            const sectionEl = document.createElement('div');
            sectionEl.className = 'course-section';
            sectionEl.innerHTML = `
                <h4 class="section-title">${section.title}</h4>
                <div class="section-lessons"></div>
            `;
            
            const lessonsContainer = sectionEl.querySelector('.section-lessons');
            
            for (const lesson of lessons) {
                const lessonEl = document.createElement('div');
                lessonEl.className = `lesson-item ${lesson.completed ? 'completed' : ''}`;
                lessonEl.dataset.lessonId = lesson.lesson_id;
                
                lessonEl.innerHTML = `
                    <span class="lesson-icon">
                        ${lesson.type === 'video' ? '🎥' : '📄'}
                    </span>
                    <span class="lesson-title">${lesson.title}</span>
                    <span class="lesson-duration">${lesson.duration || ''}</span>
                    ${lesson.completed ? '<span class="lesson-check">✓</span>' : ''}
                `;
                
                lessonEl.addEventListener('click', () => loadLesson(lesson.lesson_id));
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
            if (firstLesson) firstLesson.click();
        }
    } catch (error) {
        console.error('Erreur lors du chargement du contenu:', error);
        showError('Impossible de charger le contenu du cours');
    }
}

// Synchroniser les cours
async function syncCourses() {
    const syncBtn = document.getElementById('sync-btn');
    const originalContent = syncBtn.innerHTML;
    
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="spinner-small"></span>';
    
    try {
        // Vérifier la connexion internet
        const isOnline = await window.electronAPI.checkInternet();
        if (!isOnline) {
            showInfo('Aucune connexion internet disponible');
            return;
        }
        
        showInfo('Synchronisation en cours...');
        
        // Synchroniser la progression
        await syncProgress();
        
        // Vérifier les mises à jour des cours
        const result = await window.electronAPI.api.getCourses(1, 100);
        if (result.success) {
            showSuccess('Synchronisation terminée');
            await loadCourses();
        } else {
            showError('Erreur lors de la synchronisation');
        }
    } catch (error) {
        console.error('Erreur lors de la synchronisation:', error);
        showError('Erreur lors de la synchronisation');
    } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalContent;
    }
}

// Synchroniser la progression
async function syncProgress() {
    try {
        // Récupérer les éléments non synchronisés
        const unsyncedItems = await window.electronAPI.db.getUnsyncedItems();
        
        if (unsyncedItems.length > 0) {
            const progressData = unsyncedItems.map(item => ({
                type: item.entity_type,
                id: item.entity_id,
                action: item.action,
                timestamp: item.created_at
            }));
            
            const result = await window.electronAPI.api.syncProgress(progressData);
            
            if (result.success) {
                // Marquer comme synchronisés
                const syncIds = unsyncedItems.map(item => item.id);
                await window.electronAPI.db.markAsSynced(syncIds);
            }
        }
    } catch (error) {
        console.error('Erreur lors de la synchronisation de la progression:', error);
    }
}

// Déconnexion
async function logout() {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
        try {
            await window.electronAPI.api.logout();
            AppState.currentUser = null;
            AppState.isAuthenticated = false;
            showLoginPage();
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
        }
    }
}

// Supprimer un cours
async function deleteCourse(courseId) {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce cours ? Cette action est irréversible.')) {
        try {
            showLoader('Suppression du cours...');
            await window.electronAPI.db.deleteCourse(courseId);
            showSuccess('Cours supprimé avec succès');
            await loadCourses();
            hideLoader();
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            hideLoader();
            showError('Erreur lors de la suppression du cours');
        }
    }
}

// Rechercher des cours
async function searchCourses(query) {
    const container = document.getElementById('courses-container');
    
    if (!query) {
        await loadCourses();
        return;
    }
    
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const courses = await window.electronAPI.db.searchCourses(query);
        
        if (courses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Aucun cours trouvé pour "${query}"</p>
                </div>
            `;
        } else {
            container.innerHTML = '<div class="courses-grid" id="courses-grid"></div>';
            const grid = document.getElementById('courses-grid');
            
            for (const course of courses) {
                const progress = await window.electronAPI.db.getCourseProgress(course.course_id);
                const card = createCourseCard(course, progress);
                grid.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors de la recherche</div>';
    }
}

// Mettre à jour les informations de stockage
async function updateStorageInfo() {
    try {
        const appPath = await window.electronAPI.getAppPath();
        // TODO: Implémenter le calcul réel de l'espace utilisé
        const used = 245; // MB
        const total = 2048; // MB
        
        const percentage = (used / total) * 100;
        
        document.getElementById('storage-bar').style.width = `${percentage}%`;
        document.getElementById('storage-text').textContent = `${used} MB / ${(total/1024).toFixed(1)} GB`;
    } catch (error) {
        console.error('Erreur lors de la mise à jour du stockage:', error);
    }
}

// Fonctions utilitaires pour les messages
function showError(message) {
    showMessage(message, 'error');
}

function showSuccess(message) {
    showMessage(message, 'success');
}

function showInfo(message) {
    showMessage(message, 'info');
}

function showMessage(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Afficher/masquer le loader
function showLoader(message = 'Chargement...') {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.className = 'loader-overlay';
        document.body.appendChild(loader);
    }
    
    loader.innerHTML = `
        <div class="loader-content">
            <div class="spinner"></div>
            <p>${message}</p>
        </div>
    `;
    
    loader.classList.add('show');
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.classList.remove('show');
    }
}

// Callbacks pour les événements IPC
function updateDownloadProgress(data) {
    // Mise à jour de la progression du téléchargement
    const progressEl = document.querySelector(`[data-download-id="${data.courseId}"] .progress-bar`);
    if (progressEl) {
        progressEl.style.width = `${data.progress}%`;
    }
}

function onCourseDownloaded(data) {
    showSuccess('Cours téléchargé avec succès !');
    loadCourses();
}

function updateProgressDisplay(data) {
    // Mise à jour de l'affichage de la progression
    console.log('Progression:', data);
}

// Implémenter la pagination virtuelle
let coursesPage = 1;
const coursesPerPage = 20;

async function loadMoreCourses() {
    const loader = document.createElement('div');
    loader.className = 'loading-more';
    loader.innerHTML = '<div class="spinner-small"></div>';
    document.getElementById('courses-grid').appendChild(loader);
    
    try {
        const courses = await window.electronAPI.db.getAllCourses(coursesPage, coursesPerPage);
        
        if (courses.length > 0) {
            courses.forEach(course => {
                const card = createCourseCard(course);
                document.getElementById('courses-grid').insertBefore(card, loader);
            });
            coursesPage++;
        }
        
        loader.remove();
        
        if (courses.length < coursesPerPage) {
            // Plus de cours à charger
            window.removeEventListener('scroll', handleInfiniteScroll);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        loader.remove();
    }
}

// Scroll infini
function handleInfiniteScroll() {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 100) {
        loadMoreCourses();
    }
}

// Export des fonctions globales pour onclick dans le HTML
window.openCourse = openCourse;
window.deleteCourse = deleteCourse;
window.showSettings = () => showMessage('Paramètres en cours de développement', 'info');
window.loadProgress = () => showMessage('Page de progression en cours de développement', 'info');
window.loadDownloads = () => showMessage('Page des téléchargements en cours de développement', 'info');
