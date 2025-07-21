// app.js - Application principale

// État global de l'application
const AppState = {
    currentCourse: null,
    currentLesson: null,
    isOnline: true,
    user: null
};

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier si l'utilisateur est connecté
    const token = await window.electronAPI.store.get('token');
    if (!token) {
        showPage('login-page');
    } else {
        await initializeDashboard();
    }
    
    // Configurer les gestionnaires d'événements
    setupEventHandlers();
});

// Initialiser le dashboard
async function initializeDashboard() {
    try {
        showLoader('Initialisation...');
        
        // Récupérer les informations utilisateur
        const username = await window.electronAPI.store.get('username');
        if (username) {
            document.getElementById('user-display-name').textContent = username;
        }
        
        // Charger les cours
        await loadCourses();
        
        // Initialiser la synchronisation
        if (window.syncManager) {
            await window.syncManager.initializeSync();
        }
        
        // Mettre à jour l'espace de stockage
        await updateStorageInfo();
        
        showPage('dashboard-page');
        hideLoader();
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation:', error);
        hideLoader();
        showError('Erreur lors du chargement de l\'application');
    }
}

// Configurer les gestionnaires d'événements
function setupEventHandlers() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', handleNavigation);
    });
    
    // Boutons principaux
    document.getElementById('sync-btn')?.addEventListener('click', handleSync);
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('settings-btn')?.addEventListener('click', showSettings);
    document.getElementById('search-btn')?.addEventListener('click', toggleSearch);
    
    // Recherche
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleSearch, 300));
    }
    
    // Player
    document.getElementById('back-to-courses')?.addEventListener('click', () => {
        showDashboard();
        loadCourses();
    });
    
    document.getElementById('complete-lesson')?.addEventListener('click', completeCurrentLesson);
    document.getElementById('prev-lesson')?.addEventListener('click', previousLesson);
    document.getElementById('next-lesson')?.addEventListener('click', nextLesson);
    
    // Écouter les événements du main process
    window.electronAPI.on('sync-courses', handleSync);
    window.electronAPI.on('logout', handleLogout);
    window.electronAPI.on('open-settings', showSettings);
}

// Gérer la navigation
function handleNavigation(e) {
    e.preventDefault();
    
    // Retirer la classe active
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Ajouter la classe active
    e.currentTarget.classList.add('active');
    
    // Afficher la page correspondante
    const page = e.currentTarget.dataset.page;
    
    // Masquer toutes les pages de contenu
    document.querySelectorAll('.content-page').forEach(p => {
        p.classList.add('hidden');
    });
    
    // Afficher la page sélectionnée
    const pageEl = document.getElementById(`${page}-page`);
    if (pageEl) {
        pageEl.classList.remove('hidden');
    }
    
    // Charger le contenu de la page
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
    }
}

// Charger les cours
async function loadCourses() {
    const container = document.getElementById('courses-container');
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const response = await window.electronAPI.db.getAllCourses();
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        const courses = response.result;
        
        if (!courses || courses.length === 0) {
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
                const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id);
                const progress = progressResponse.success ? progressResponse.result : null;
                const card = createCourseCard(course, progress);
                grid.appendChild(card);
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement des cours</div>';
    }
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
        const sectionsResponse = await window.electronAPI.db.getSections(courseId);
        if (!sectionsResponse.success) {
            throw new Error(sectionsResponse.error);
        }
        
        const sections = sectionsResponse.result;
        const container = document.getElementById('course-sections');
        container.innerHTML = '';
        
        document.getElementById('course-title').textContent = AppState.currentCourse.title;
        
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
                    <span class="lesson-icon">${getFileIcon(lesson.type)}</span>
                    <span class="lesson-title">${escapeHtml(lesson.title)}</span>
                    <span class="lesson-duration">${lesson.duration || ''}</span>
                    ${lesson.completed ? '<span class="lesson-check">✓</span>' : ''}
                `;
                
                lessonEl.addEventListener('click', () => {
                    if (window.playerManager) {
                        window.playerManager.loadLesson(lesson.lesson_id);
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
            if (firstLesson) firstLesson.click();
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
            hideLoader();
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            hideLoader();
            showError('Erreur lors de la suppression du cours');
        }
    }
}

// Gérer la synchronisation
async function handleSync() {
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.classList.add('rotating');
    }
    
    try {
        if (window.syncManager) {
            const result = await window.syncManager.performFullSync();
            if (result.success) {
                showSuccess('Synchronisation terminée');
                await loadCourses();
            }
        }
    } catch (error) {
        console.error('Erreur de synchronisation:', error);
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.classList.remove('rotating');
        }
    }
}

// Gérer la déconnexion
async function handleLogout() {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
        try {
            showLoader('Déconnexion...');
            await window.electronAPI.api.logout();
            
            // Nettoyer l'état
            AppState.currentCourse = null;
            AppState.currentLesson = null;
            AppState.user = null;
            
            showPage('login-page');
            hideLoader();
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
            hideLoader();
        }
    }
}

// Afficher les paramètres
function showSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
}

// Basculer la recherche
function toggleSearch() {
    const searchBar = document.getElementById('search-bar');
    if (searchBar) {
        searchBar.classList.toggle('hidden');
        if (!searchBar.classList.contains('hidden')) {
            document.getElementById('search-input').focus();
        }
    }
}

// Gérer la recherche
async function handleSearch(e) {
    const query = e.target.value.trim();
    
    if (window.coursesManager) {
        await window.coursesManager.searchCourses(query);
    }
}

// Charger la progression
async function loadProgress() {
    const container = document.getElementById('progress-container');
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
            
            if (progress) {
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
        
        html += '</div>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur lors du chargement de la progression:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement</div>';
    }
}

// Mettre à jour les informations de stockage
async function updateStorageInfo() {
    try {
        const storage = await Utils.calculateStorageUsed();
        const totalGB = 5 * 1024 * 1024 * 1024; // 5 GB limite
        const percentage = (storage.total / totalGB) * 100;
        
        document.getElementById('storage-bar').style.width = `${percentage}%`;
        document.getElementById('storage-text').textContent = 
            `${Utils.formatFileSize(storage.total)} / 5 GB`;
            
    } catch (error) {
        console.error('Erreur lors du calcul du stockage:', error);
    }
}

// Naviguer vers la leçon précédente
function previousLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === window.currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex > 0) {
        lessons[currentIndex - 1].click();
    }
}

// Naviguer vers la leçon suivante
function nextLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === window.currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex < lessons.length - 1) {
        lessons[currentIndex + 1].click();
    }
}

// Marquer la leçon comme complétée
async function completeCurrentLesson() {
    if (window.playerManager && window.currentLesson) {
        await window.playerManager.completeCurrentLesson();
    }
}

// Exporter les fonctions globales
window.openCourse = openCourse;
window.deleteCourse = deleteCourse;
window.AppState = AppState;
