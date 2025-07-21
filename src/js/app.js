// app.js - Application principale

// État global de l'application
const AppState = {
    currentCourse: null,
    currentLesson: null,
    isOnline: true
};

// Variables globales
let currentLesson = null;
let lessonProgress = 0;

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

// Créer une carte de cours
function createCourseCard(course, progress) {
    const card = document.createElement('div');
    card.className = 'course-card card';
    card.dataset.courseId = course.course_id;
    
    card.innerHTML = `
        <img src="${course.thumbnail || 'assets/default-course.jpg'}" 
             alt="${course.title}" class="course-thumbnail">
        <div class="course-info">
            <h3 class="course-title">${course.title}</h3>
            <p class="course-instructor">${course.instructor_name || 'Instructeur'}</p>
            <div class="course-stats">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
            </div>
        </div>
        ${progress ? `
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${progress.completion_percentage || 0}%"></div>
        </div>
        ` : ''}
    `;
    
    card.addEventListener('click', () => openCourse(course.course_id));
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
        
        const accessResponse = await window.electronAPI.db.updateCourseAccess(courseId);
        if (!accessResponse.success) {
            console.warn('Erreur lors de la mise à jour de l\'accès:', accessResponse.error);
        }
        
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

// Rechercher des cours
async function searchCourses(query) {
    const container = document.getElementById('courses-container');
    
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
                    <p>Aucun cours trouvé pour "${query}"</p>
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

// Fonctions UI manquantes
function showPlayer() {
    document.getElementById('dashboard-page').classList.add('hidden');
    document.getElementById('player-page').classList.remove('hidden');
}

function showLoader(message) {
    const loader = document.getElementById('global-loader');
    if (loader) {
        loader.querySelector('p').textContent = message || 'Chargement...';
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

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type} show`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Gestion de la navigation
document.addEventListener('DOMContentLoaded', async () => {
    // Navigation sidebar
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Retirer active de tous
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.remove('active');
            });
            
            // Ajouter active au cliqué
            e.currentTarget.classList.add('active');
            
            // Afficher la page correspondante
            const page = e.currentTarget.dataset.page;
            document.querySelectorAll('.content-page').forEach(p => {
                p.classList.add('hidden');
            });
            
            document.getElementById(`${page}-page`)?.classList.remove('hidden');
            
            // Charger le contenu
            if (page === 'courses') {
                loadCourses();
            } else if (page === 'downloads' && window.coursesManager) {
                window.coursesManager.loadDownloads();
            } else if (page === 'progress') {
                loadProgress();
            }
        });
    });
    
    // Boutons header
    document.getElementById('sync-btn')?.addEventListener('click', async () => {
        if (window.syncManager) {
            await window.syncManager.performFullSync();
        }
    });
    
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
            await window.electronAPI.api.logout();
            location.reload();
        }
    });
    
    document.getElementById('settings-btn')?.addEventListener('click', () => {
        document.getElementById('settings-modal')?.classList.remove('hidden');
    });
    
    document.getElementById('search-btn')?.addEventListener('click', () => {
        const searchBar = document.getElementById('search-bar');
        searchBar?.classList.toggle('hidden');
        if (!searchBar?.classList.contains('hidden')) {
            document.getElementById('search-input')?.focus();
        }
    });
    
    // Recherche
    document.getElementById('search-input')?.addEventListener('input', debounce((e) => {
        searchCourses(e.target.value);
    }, 300));
    
    // Bouton télécharger
    document.getElementById('download-course-btn')?.addEventListener('click', () => {
        if (window.coursesManager) {
            window.coursesManager.showDownloadModal();
        }
    });
    
    // Player
    document.getElementById('back-to-courses')?.addEventListener('click', () => {
        document.getElementById('player-page').classList.add('hidden');
        document.getElementById('dashboard-page').classList.remove('hidden');
        loadCourses();
    });
    
    // Modals
    document.getElementById('close-settings-modal')?.addEventListener('click', () => {
        document.getElementById('settings-modal')?.classList.add('hidden');
    });
    
    // Charger les informations utilisateur
    const username = await window.electronAPI.store.get('username');
    if (username) {
        document.getElementById('user-display-name').textContent = username;
    }
    
    // Charger les cours au démarrage
    const token = await window.electronAPI.store.get('token');
    if (token) {
        loadCourses();
        updateStorageInfo();
    }
});

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
                        <h4>${course.title}</h4>
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

// Mettre à jour les infos de stockage
async function updateStorageInfo() {
    try {
        const storage = await Utils.calculateStorageUsed();
        const totalGB = 5 * 1024 * 1024 * 1024; // 5 GB
        const percentage = (storage.total / totalGB) * 100;
        
        document.getElementById('storage-bar').style.width = `${percentage}%`;
        document.getElementById('storage-text').textContent = 
            `${Utils.formatFileSize(storage.total)} / 5 GB`;
    } catch (error) {
        console.error('Erreur calcul stockage:', error);
    }
}

// Fonction debounce simple
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

// Exports globaux
window.loadCourses = loadCourses;
window.openCourse = openCourse;
window.deleteCourse = deleteCourse;
window.searchCourses = searchCourses;
window.AppState = AppState;
