// courses.js - Gestion complète des cours et téléchargements

// État local du module
const CoursesState = {
    availableCourses: [],
    downloadedCourses: [],
    activeDownloads: new Map(),
    filters: {
        category: null,
        difficulty: null,
        search: '',
        showDownloaded: true,
        showAvailable: true
    },
    currentPage: 1,
    coursesPerPage: 12
};

// ==================== INITIALISATION ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeCourses();
    loadActiveDownloads();
});

function initializeCourses() {
    // Gestionnaires d'événements pour le téléchargement
    const downloadBtn = document.getElementById('download-course-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', showDownloadModal);
    }
    
    const closeDownloadModal = document.getElementById('close-download-modal');
    if (closeDownloadModal) {
        closeDownloadModal.addEventListener('click', hideDownloadModal);
    }
    
    const cancelDownload = document.getElementById('cancel-download');
    if (cancelDownload) {
        cancelDownload.addEventListener('click', hideDownloadModal);
    }
    
    const startDownloadBtn = document.getElementById('start-download');
    if (startDownloadBtn) {
        startDownloadBtn.addEventListener('click', startDownload);
    }
    
    // Sélection de cours
    const courseSelect = document.getElementById('course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', onCourseSelected);
    }
    
    // Options de téléchargement
    const downloadOptions = ['include-videos', 'include-documents', 'compress-media'];
    downloadOptions.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updateDownloadEstimate);
        }
    });
    
    // Écouter les événements de progression
    window.electronAPI.on('download-progress', handleDownloadProgress);
    window.electronAPI.on('download-completed', handleDownloadCompleted);
    window.electronAPI.on('download-error', handleDownloadError);
    window.electronAPI.on('course-downloaded', handleCourseDownloaded);
}

// ==================== AFFICHAGE DES COURS ====================

async function loadCourses() {
    const container = document.getElementById('courses-container');
    const coursesListContainer = document.getElementById('courses-list');
    
    // Utiliser le bon container selon la page active
    const activeContainer = container || coursesListContainer;
    if (!activeContainer) {
        console.error('[Courses] Aucun container trouvé pour les cours');
        return;
    }
    
    // Afficher le loader
    activeContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        // 1. Charger les cours locaux (offline first)
        const localCoursesPromise = loadLocalCourses();
        
        // 2. Charger les cours en ligne
        const onlineCoursesPromise = loadOnlineCourses();
        
        // Attendre les deux promesses
        const [localCourses, onlineCourses] = await Promise.all([
            localCoursesPromise,
            onlineCoursesPromise
        ]);
        
        // Fusionner les données
        const mergedCourses = mergeCourseData(localCourses, onlineCourses);
        
        // Afficher les cours
        await displayCourses(mergedCourses, activeContainer);
        
        // Mettre à jour les statistiques
        updateDashboardStats(mergedCourses);
        
    } catch (error) {
        console.error('[Courses] Erreur lors du chargement des cours:', error);
        activeContainer.innerHTML = `
            <div class="message message-error">
                Erreur lors du chargement des cours
                <button class="btn btn-sm" onclick="window.loadCourses()">Réessayer</button>
            </div>
        `;
    }
}

async function loadLocalCourses() {
    try {
        const response = await window.electronAPI.db.getAllCourses();
        if (response.success && response.result) {
            CoursesState.downloadedCourses = response.result;
            return response.result;
        }
        return [];
    } catch (error) {
        console.error('[Courses] Erreur lors du chargement des cours locaux:', error);
        return [];
    }
}

async function loadOnlineCourses() {
    try {
        const response = await window.electronAPI.api.getUserCourses({
            enrolled_only: true,
            page: 1,
            per_page: 100
        });
        
        if (response.success && response.courses) {
            CoursesState.availableCourses = response.courses;
            return response.courses;
        }
        return [];
    } catch (error) {
        console.warn('[Courses] Impossible de charger les cours en ligne:', error);
        return [];
    }
}

function mergeCourseData(localCourses, onlineCourses) {
    const merged = new Map();
    
    // Ajouter les cours locaux
    localCourses.forEach(course => {
        merged.set(course.course_id, {
            ...course,
            isDownloaded: true,
            isLocal: true
        });
    });
    
    // Fusionner avec les cours en ligne
    onlineCourses.forEach(course => {
        const courseId = course.id || course.course_id;
        const existing = merged.get(courseId);
        
        if (existing) {
            // Fusionner les données
            merged.set(courseId, {
                ...existing,
                ...course,
                isDownloaded: true,
                isOnline: true,
                // Garder les données locales importantes
                last_accessed: existing.last_accessed,
                local_path: existing.local_path
            });
        } else {
            // Ajouter le cours en ligne
            merged.set(courseId, {
                ...course,
                course_id: courseId,
                isDownloaded: false,
                isOnline: true
            });
        }
    });
    
    return Array.from(merged.values());
}

async function displayCourses(courses, container) {
    if (!courses || courses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                </svg>
                <h3>Aucun cours disponible</h3>
                <p>Téléchargez des cours pour les consulter hors ligne</p>
                <button class="btn btn-primary" onclick="showDownloadModal()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    Télécharger un cours
                </button>
            </div>
        `;
        return;
    }
    
    // Appliquer les filtres
    const filteredCourses = applyFilters(courses);
    
    // Pagination
    const totalPages = Math.ceil(filteredCourses.length / CoursesState.coursesPerPage);
    const startIndex = (CoursesState.currentPage - 1) * CoursesState.coursesPerPage;
    const endIndex = startIndex + CoursesState.coursesPerPage;
    const coursesToDisplay = filteredCourses.slice(startIndex, endIndex);
    
    // Créer le conteneur
    container.innerHTML = `
        <div class="courses-filters">
            ${createFiltersHTML()}
        </div>
        <div class="courses-grid" id="courses-grid"></div>
        ${totalPages > 1 ? createPaginationHTML(totalPages) : ''}
    `;
    
    // Afficher les cours
    const grid = document.getElementById('courses-grid');
    for (const course of coursesToDisplay) {
        const card = await createCourseCard(course);
        grid.appendChild(card);
    }
    
    // Attacher les événements des filtres
    attachFilterEvents();
}

function applyFilters(courses) {
    return courses.filter(course => {
        // Filtre de recherche
        if (CoursesState.filters.search) {
            const searchLower = CoursesState.filters.search.toLowerCase();
            const matchTitle = course.title?.toLowerCase().includes(searchLower);
            const matchInstructor = course.instructor_name?.toLowerCase().includes(searchLower);
            if (!matchTitle && !matchInstructor) return false;
        }
        
        // Filtre de catégorie
        if (CoursesState.filters.category && course.category !== CoursesState.filters.category) {
            return false;
        }
        
        // Filtre de difficulté
        if (CoursesState.filters.difficulty && course.difficulty_level !== CoursesState.filters.difficulty) {
            return false;
        }
        
        // Filtre téléchargé/disponible
        if (!CoursesState.filters.showDownloaded && course.isDownloaded) return false;
        if (!CoursesState.filters.showAvailable && !course.isDownloaded) return false;
        
        return true;
    });
}

function createFiltersHTML() {
    return `
        <div class="filters-row">
            <input type="text" 
                   id="course-search" 
                   class="form-control" 
                   placeholder="Rechercher un cours..."
                   value="${CoursesState.filters.search}">
            
            <select id="category-filter" class="form-control">
                <option value="">Toutes les catégories</option>
                ${getUniqueCategories().map(cat => 
                    `<option value="${cat}" ${CoursesState.filters.category === cat ? 'selected' : ''}>${cat}</option>`
                ).join('')}
            </select>
            
            <select id="difficulty-filter" class="form-control">
                <option value="">Toutes les difficultés</option>
                <option value="beginner" ${CoursesState.filters.difficulty === 'beginner' ? 'selected' : ''}>Débutant</option>
                <option value="intermediate" ${CoursesState.filters.difficulty === 'intermediate' ? 'selected' : ''}>Intermédiaire</option>
                <option value="advanced" ${CoursesState.filters.difficulty === 'advanced' ? 'selected' : ''}>Avancé</option>
            </select>
            
            <div class="filter-toggles">
                <label class="checkbox-label">
                    <input type="checkbox" id="show-downloaded" ${CoursesState.filters.showDownloaded ? 'checked' : ''}>
                    Téléchargés
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="show-available" ${CoursesState.filters.showAvailable ? 'checked' : ''}>
                    Disponibles
                </label>
            </div>
        </div>
    `;
}

function getUniqueCategories() {
    const categories = new Set();
    [...CoursesState.availableCourses, ...CoursesState.downloadedCourses].forEach(course => {
        if (course.category) categories.add(course.category);
    });
    return Array.from(categories).sort();
}

function createPaginationHTML(totalPages) {
    let html = '<div class="pagination">';
    
    // Bouton précédent
    html += `<button class="btn btn-sm" onclick="changePage(${CoursesState.currentPage - 1})" 
             ${CoursesState.currentPage === 1 ? 'disabled' : ''}>←</button>`;
    
    // Numéros de page
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= CoursesState.currentPage - 2 && i <= CoursesState.currentPage + 2)) {
            html += `<button class="btn btn-sm ${i === CoursesState.currentPage ? 'btn-primary' : ''}" 
                     onclick="changePage(${i})">${i}</button>`;
        } else if (i === CoursesState.currentPage - 3 || i === CoursesState.currentPage + 3) {
            html += '<span>...</span>';
        }
    }
    
    // Bouton suivant
    html += `<button class="btn btn-sm" onclick="changePage(${CoursesState.currentPage + 1})" 
             ${CoursesState.currentPage === totalPages ? 'disabled' : ''}>→</button>`;
    
    html += '</div>';
    return html;
}

function attachFilterEvents() {
    // Recherche
    const searchInput = document.getElementById('course-search');
    if (searchInput) {
        searchInput.addEventListener('input', Utils.debounce((e) => {
            CoursesState.filters.search = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        }, 300));
    }
    
    // Catégorie
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
            CoursesState.filters.category = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    // Difficulté
    const difficultyFilter = document.getElementById('difficulty-filter');
    if (difficultyFilter) {
        difficultyFilter.addEventListener('change', (e) => {
            CoursesState.filters.difficulty = e.target.value;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    // Toggles
    const showDownloaded = document.getElementById('show-downloaded');
    if (showDownloaded) {
        showDownloaded.addEventListener('change', (e) => {
            CoursesState.filters.showDownloaded = e.target.checked;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
    
    const showAvailable = document.getElementById('show-available');
    if (showAvailable) {
        showAvailable.addEventListener('change', (e) => {
            CoursesState.filters.showAvailable = e.target.checked;
            CoursesState.currentPage = 1;
            loadCourses();
        });
    }
}

// ==================== CRÉATION DES CARTES DE COURS ====================

async function createCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card card';
    card.dataset.courseId = course.course_id || course.id;
    
    const isExpired = Utils.isCourseExpired(course);
    const isDownloaded = course.isDownloaded;
    const thumbnailUrl = course.thumbnail || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMwMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTgwIiBmaWxsPSIjMjAyMDIwIi8+CjxwYXRoIGQ9Ik0xNTAgOTBDMTUwIDEwMy4yNTUgMTM5LjI1NSAxMTQgMTI2IDExNEMxMTIuNzQ1IDExNCAxMDIgMTAzLjI1NSAxMDIgOTBDMTAyIDc2Ljc0NTIgMTEyLjc0NSA2NiAxMjYgNjZDMTM5LjI1NSA2NiAxNTAgNzYuNzQ1MiAxNTAgOTBaIiBmaWxsPSIjNDA0MDQwIi8+Cjwvc3ZnPg==';
    
    // Obtenir la progression
    let progressData = null;
    if (isDownloaded) {
        try {
            const progressResponse = await window.electronAPI.db.getCourseProgress(course.course_id || course.id);
            if (progressResponse.success && progressResponse.result) {
                progressData = progressResponse.result;
            }
        } catch (error) {
            console.error('Erreur lors de la récupération de la progression:', error);
        }
    }
    
    const progressPercentage = progressData ? Math.round(progressData.completion_percentage || 0) : 0;
    
    card.innerHTML = `
        <div class="course-thumbnail-wrapper">
            <img src="${Utils.escapeHtml(thumbnailUrl)}" 
                 alt="${Utils.escapeHtml(course.title)}" 
                 class="course-thumbnail"
                 onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMwMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTgwIiBmaWxsPSIjMjAyMDIwIi8+CjxwYXRoIGQ9Ik0xNTAgOTBDMTUwIDEwMy4yNTUgMTM5LjI1NSAxMTQgMTI2IDExNEMxMTIuNzQ1IDExNCAxMDIgMTAzLjI1NSAxMDIgOTBDMTAyIDc2Ljc0NTIgMTEyLjc0NSA2NiAxMjYgNjZDMTM5LjI1NSA2NiAxNTAgNzYuNzQ1MiAxNTAgOTBaIiBmaWxsPSIjNDA0MDQwIi8+Cjwvc3ZnPg=='">
            ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
            ${isDownloaded ? '<div class="course-downloaded-badge" title="Cours téléchargé">💾</div>' : ''}
            <div class="course-actions">
                ${createCourseActions(course, isDownloaded)}
            </div>
        </div>
        <div class="course-info">
            <h3 class="course-title">${Utils.escapeHtml(course.title)}</h3>
            <p class="course-instructor">${Utils.escapeHtml(course.instructor_name || 'Instructeur')}</p>
            <div class="course-stats">
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${progressPercentage > 0 ? `<span class="course-progress-text">✓ ${progressPercentage}%</span>` : ''}
            </div>
            ${course.rating ? `
                <div class="course-rating">
                    ${createRatingStars(course.rating)}
                    <span class="rating-count">(${course.review_count || 0})</span>
                </div>
            ` : ''}
        </div>
        ${progressPercentage > 0 ? `
        <div class="course-progress">
            <div class="course-progress-bar" style="width: ${progressPercentage}%"></div>
        </div>
        ` : ''}
    `;
    
    // Ajouter l'événement de clic
    card.addEventListener('click', (e) => {
        if (e.target.closest('.course-actions')) return; // Ignorer si clic sur les actions
        
        if (!isExpired) {
            if (isDownloaded) {
                openCourse(course.course_id || course.id);
            } else {
                showCourseDetails(course);
            }
        } else {
            showWarning('Ce cours a expiré et ne peut plus être consulté');
        }
    });
    
    return card;
}

function createCourseActions(course, isDownloaded) {
    const actions = [];
    
    if (isDownloaded) {
        // Actions pour cours téléchargé
        actions.push(`
            <button class="btn btn-icon" onclick="event.stopPropagation(); updateCourse(${course.course_id || course.id})" title="Mettre à jour">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                </svg>
            </button>
        `);
        
        actions.push(`
            <button class="btn btn-icon" onclick="event.stopPropagation(); deleteCourse(${course.course_id || course.id})" title="Supprimer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `);
    } else {
        // Actions pour cours non téléchargé
        actions.push(`
            <button class="btn btn-icon btn-primary" onclick="event.stopPropagation(); downloadSingleCourse(${course.id})" title="Télécharger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
            </button>
        `);
    }
    
    return actions.join('');
}

function createRatingStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    let stars = '';
    for (let i = 0; i < fullStars; i++) {
        stars += '⭐';
    }
    if (hasHalfStar) {
        stars += '✨';
    }
    for (let i = 0; i < emptyStars; i++) {
        stars += '☆';
    }
    
    return `<span class="rating-stars">${stars}</span>`;
}

// ==================== MODAL DE TÉLÉCHARGEMENT ====================

async function showDownloadModal() {
    showLoader('Chargement des cours disponibles...');
    
    const modal = document.getElementById('download-modal');
    modal.classList.remove('hidden');
    
    // Charger la liste des cours disponibles
    await loadAvailableCourses();
    
    hideLoader();
}

function hideDownloadModal() {
    const modal = document.getElementById('download-modal');
    modal.classList.add('hidden');
    
    // Réinitialiser le formulaire
    document.getElementById('course-select').value = '';
    document.getElementById('download-info').classList.add('hidden');
}

async function loadAvailableCourses() {
    const select = document.getElementById('course-select');
    select.innerHTML = '<option value="">Chargement des cours...</option>';
    
    try {
        // Utiliser les cours déjà chargés ou les recharger
        if (CoursesState.availableCourses.length === 0) {
            await loadOnlineCourses();
        }
        
        // Récupérer les IDs des cours déjà téléchargés
        const downloadedIds = new Set(CoursesState.downloadedCourses.map(c => c.course_id));
        
        // Filtrer les cours non téléchargés
        const availableForDownload = CoursesState.availableCourses.filter(
            course => !downloadedIds.has(course.id || course.course_id)
        );
        
        if (availableForDownload.length === 0) {
            select.innerHTML = '<option value="">Tous les cours sont déjà téléchargés</option>';
            return;
        }
        
        select.innerHTML = '<option value="">Sélectionner un cours...</option>';
        
        // Grouper par catégorie
        const coursesByCategory = {};
        availableForDownload.forEach(course => {
            const category = course.category || 'Autres';
            if (!coursesByCategory[category]) {
                coursesByCategory[category] = [];
            }
            coursesByCategory[category].push(course);
        });
        
        // Créer les options groupées
        Object.entries(coursesByCategory).forEach(([category, courses]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category;
            
            courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.id;
                option.textContent = `${course.title} - ${course.lessons_count || 0} leçons`;
                if (course.instructor_name) {
                    option.textContent += ` (${course.instructor_name})`;
                }
                optgroup.appendChild(option);
            });
            
            select.appendChild(optgroup);
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        select.innerHTML = '<option value="">Erreur de connexion</option>';
        showError('Impossible de charger la liste des cours');
    }
}

function onCourseSelected(e) {
    const courseId = parseInt(e.target.value);
    updateDownloadEstimate();
}

async function updateDownloadEstimate() {
    const courseId = parseInt(document.getElementById('course-select').value);
    const infoDiv = document.getElementById('download-info');
    
    if (!courseId) {
        infoDiv.classList.add('hidden');
        return;
    }
    
    const course = CoursesState.availableCourses.find(c => c.id === courseId);
    if (!course) return;
    
    // Options sélectionnées
    const includeVideos = document.getElementById('include-videos').checked;
    const includeDocuments = document.getElementById('include-documents').checked;
    const compressMedia = document.getElementById('compress-media').checked;
    
    // Calculer la taille estimée
    let estimatedSize = 0;
    let contentTypes = [];
    
    if (includeVideos) {
        const videoSize = course.download_info?.estimated_size || course.video_size || 500 * 1024 * 1024;
        estimatedSize += videoSize;
        contentTypes.push(`Vidéos (${course.download_info?.video_count || 0})`);
    }
    
    if (includeDocuments) {
        const docSize = course.document_size || 50 * 1024 * 1024;
        estimatedSize += docSize;
        contentTypes.push(`Documents (${course.download_info?.document_count || 0})`);
    }
    
    if (compressMedia && includeVideos) {
        estimatedSize *= 0.7; // 30% de compression
    }
    
    infoDiv.innerHTML = `
        <div class="course-preview">
            <h4>${Utils.escapeHtml(course.title)}</h4>
            <div class="course-meta">
                <span>👤 ${Utils.escapeHtml(course.instructor_name || 'Instructeur')}</span>
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                ${course.rating ? `<span>⭐ ${course.rating}/5</span>` : ''}
            </div>
            ${course.description ? `
                <p class="course-description">${Utils.escapeHtml(course.description).substring(0, 200)}...</p>
            ` : ''}
            <div class="download-details">
                <p><strong>Contenu à télécharger :</strong> ${contentTypes.join(', ') || 'Aucun'}</p>
                <p><strong>Taille estimée :</strong> ${Utils.formatFileSize(estimatedSize)}</p>
                <p><strong>Espace disponible :</strong> <span id="available-space">Calcul...</span></p>
                ${compressMedia ? '<p class="info-note">📦 Compression activée - La taille finale peut être réduite</p>' : ''}
            </div>
            ${course.expires_at ? `
                <p class="warning-note">⚠️ Ce cours expire le ${Utils.formatDate(course.expires_at, 'long')}</p>
            ` : ''}
        </div>
    `;
    
    infoDiv.classList.remove('hidden');
    
    // Vérifier l'espace disponible
    checkAvailableSpace();
}

async function checkAvailableSpace() {
    try {
        const systemInfo = await window.electronAPI.system.getSystemInfo();
        if (systemInfo.success) {
            const spaceElement = document.getElementById('available-space');
            if (spaceElement) {
                spaceElement.textContent = Utils.formatFileSize(systemInfo.info.freeMemory);
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'espace:', error);
    }
}

// ==================== TÉLÉCHARGEMENT ====================

async function startDownload() {
    const courseId = parseInt(document.getElementById('course-select').value);
    if (!courseId) {
        showError('Veuillez sélectionner un cours');
        return;
    }
    
    const course = CoursesState.availableCourses.find(c => c.id === courseId);
    if (!course) return;
    
    // Options de téléchargement
    const options = {
        includeVideos: document.getElementById('include-videos').checked,
        includeDocuments: document.getElementById('include-documents').checked,
        compressMedia: document.getElementById('compress-media').checked,
        videoQuality: 'high',
        encryptionEnabled: true
    };
    
    if (!options.includeVideos && !options.includeDocuments) {
        showError('Veuillez sélectionner au moins un type de contenu à télécharger');
        return;
    }
    
    // Fermer la modal
    hideDownloadModal();
    
    try {
        // Utiliser la nouvelle API de téléchargement
        const result = await window.electronAPI.download.downloadCourse(courseId, options);
        
        if (result.success) {
            // Ajouter à l'affichage local
            const download = {
                id: result.downloadId,
                course: course,
                options: options,
                status: 'pending',
                progress: 0,
                startTime: Date.now()
            };
            
            CoursesState.activeDownloads.set(result.downloadId, download);
            
            // Afficher la page des téléchargements
            document.querySelector('[data-page="downloads"]').click();
            updateDownloadDisplay();
            
            showSuccess('Téléchargement démarré');
            
            // Logger l'action
            Logger.info('[Courses] Téléchargement démarré', {
                courseId: course.id,
                title: course.title,
                options
            });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Erreur lors du démarrage du téléchargement:', error);
        showError(`Erreur: ${error.message}`);
    }
}

async function downloadSingleCourse(courseId) {
    const course = CoursesState.availableCourses.find(c => c.id === courseId);
    if (!course) {
        showError('Cours introuvable');
        return;
    }
    
    // Options par défaut pour téléchargement rapide
    const options = {
        includeVideos: true,
        includeDocuments: true,
        compressMedia: false,
        videoQuality: 'high',
        encryptionEnabled: true
    };
    
    try {
        const result = await window.electronAPI.download.downloadCourse(courseId, options);
        
        if (result.success) {
            const download = {
                id: result.downloadId,
                course: course,
                options: options,
                status: 'pending',
                progress: 0,
                startTime: Date.now()
            };
            
            CoursesState.activeDownloads.set(result.downloadId, download);
            updateDownloadDisplay();
            
            showSuccess(`Téléchargement de "${course.title}" démarré`);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Erreur lors du téléchargement rapide:', error);
        showError(`Erreur: ${error.message}`);
    }
}

// ==================== GESTION DES ÉVÉNEMENTS DE TÉLÉCHARGEMENT ====================

function handleDownloadProgress(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        download.status = data.status;
        download.progress = data.progress || 0;
        download.currentFile = data.currentFile;
        download.error = data.error;
        
        updateDownloadDisplay();
        
        // Si terminé ou erreur, nettoyer après un délai
        if (data.status === 'completed' || data.status === 'error') {
            setTimeout(() => {
                CoursesState.activeDownloads.delete(data.downloadId);
                updateDownloadDisplay();
            }, 5000);
        }
    }
}

function handleDownloadCompleted(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        showSuccess(`"${download.course.title}" téléchargé avec succès !`);
        
        // Recharger la liste des cours
        loadCourses();
    }
}

function handleDownloadError(data) {
    const download = CoursesState.activeDownloads.get(data.downloadId);
    if (download) {
        showError(`Erreur lors du téléchargement de "${download.course.title}": ${data.error}`);
    }
}

function handleCourseDownloaded(data) {
    // Mettre à jour la liste des cours téléchargés
    loadLocalCourses().then(() => {
        loadCourses();
    });
}

// ==================== AFFICHAGE DES TÉLÉCHARGEMENTS ====================

function updateDownloadDisplay() {
    const container = document.getElementById('downloads-container') || document.getElementById('downloads-list');
    if (!container) return;
    
    if (CoursesState.activeDownloads.size === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                <p>Aucun téléchargement en cours</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '<div class="downloads-list">';
    const listContainer = container.querySelector('.downloads-list');
    
    CoursesState.activeDownloads.forEach(download => {
        const downloadEl = createDownloadElement(download);
        listContainer.appendChild(downloadEl);
    });
}

function createDownloadElement(download) {
    const el = document.createElement('div');
    el.className = 'download-item';
    el.dataset.downloadId = download.id;
    
    const statusIcon = {
        pending: '⏳',
        preparing: '🔄',
        creating_package: '📦',
        downloading: '⬇️',
        completed: '✅',
        error: '❌',
        cancelled: '🚫'
    }[download.status] || '⏳';
    
    const statusText = {
        pending: 'En attente',
        preparing: 'Préparation',
        creating_package: 'Création du package',
        downloading: 'Téléchargement',
        completed: 'Terminé',
        error: 'Erreur',
        cancelled: 'Annulé'
    }[download.status] || download.status;
    
    // Calculer la vitesse et le temps restant
    let speedInfo = '';
    if (download.status === 'downloading' && download.startTime && download.progress > 0) {
        const elapsed = (Date.now() - download.startTime) / 1000; // en secondes
        const speed = download.progress / elapsed; // %/s
        const remaining = speed > 0 ? ((100 - download.progress) / speed) : 0;
        
        speedInfo = `
            <span class="download-speed">${speed.toFixed(1)}%/s</span>
            <span class="download-eta">${Utils.formatDuration(remaining)} restant</span>
        `;
    }
    
    el.innerHTML = `
        <div class="download-header">
            <span class="download-icon">${statusIcon}</span>
            <div class="download-info">
                <h4>${Utils.escapeHtml(download.course.title)}</h4>
                <p class="download-status">
                    ${statusText} 
                    ${download.currentFile ? `- ${Utils.escapeHtml(download.currentFile)}` : ''}
                    ${speedInfo}
                </p>
                ${download.error ? `<p class="download-error">${Utils.escapeHtml(download.error)}</p>` : ''}
            </div>
            <div class="download-actions">
                ${download.status === 'downloading' || download.status === 'pending' ? `
                    <button class="btn btn-icon" onclick="cancelDownload('${download.id}')" title="Annuler">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                ` : ''}
                ${download.status === 'error' ? `
                    <button class="btn btn-sm btn-primary" onclick="retryDownload('${download.id}')">
                        Réessayer
                    </button>
                ` : ''}
            </div>
        </div>
        ${download.status === 'downloading' || download.status === 'creating_package' ? `
            <div class="download-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${download.progress}%"></div>
                </div>
                <span class="progress-text">${Math.round(download.progress)}%</span>
            </div>
        ` : ''}
    `;
    
    return el;
}

// ==================== ACTIONS SUR LES TÉLÉCHARGEMENTS ====================

window.cancelDownload = async function(downloadId) {
    const download = CoursesState.activeDownloads.get(downloadId);
    if (download && (download.status === 'downloading' || download.status === 'pending')) {
        if (confirm(`Êtes-vous sûr de vouloir annuler le téléchargement de "${download.course.title}" ?`)) {
            try {
                const result = await window.electronAPI.download.cancelDownload(downloadId);
                if (result.success) {
                    download.status = 'cancelled';
                    updateDownloadDisplay();
                    
                    setTimeout(() => {
                        CoursesState.activeDownloads.delete(downloadId);
                        updateDownloadDisplay();
                    }, 2000);
                    
                    showInfo('Téléchargement annulé');
                }
            } catch (error) {
                console.error('Erreur lors de l\'annulation:', error);
                showError('Impossible d\'annuler le téléchargement');
            }
        }
    }
};

window.retryDownload = async function(downloadId) {
    const download = CoursesState.activeDownloads.get(downloadId);
    if (download && download.status === 'error') {
        try {
            // Réinitialiser le téléchargement
            download.status = 'pending';
            download.error = null;
            download.progress = 0;
            download.startTime = Date.now();
            
            const result = await window.electronAPI.download.downloadCourse(
                download.course.id,
                download.options
            );
            
            if (result.success) {
                // Mettre à jour l'ID si nécessaire
                if (result.downloadId !== downloadId) {
                    CoursesState.activeDownloads.delete(downloadId);
                    download.id = result.downloadId;
                    CoursesState.activeDownloads.set(result.downloadId, download);
                }
                
                updateDownloadDisplay();
                showInfo('Téléchargement relancé');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            download.status = 'error';
            download.error = error.message;
            updateDownloadDisplay();
            showError(`Impossible de relancer: ${error.message}`);
        }
    }
};

// ==================== CHARGEMENT DES TÉLÉCHARGEMENTS ACTIFS ====================

async function loadActiveDownloads() {
    try {
        const result = await window.electronAPI.download.getAllDownloads();
        if (result.success && result.downloads) {
            result.downloads.forEach(dl => {
                if (dl.status === 'downloading' || dl.status === 'pending' || dl.status === 'preparing') {
                    CoursesState.activeDownloads.set(dl.id, dl);
                }
            });
            updateDownloadDisplay();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des téléchargements:', error);
    }
}

// ==================== ACTIONS SUR LES COURS ====================

async function openCourse(courseId) {
    try {
        // Mettre à jour l'accès au cours
        await window.electronAPI.db.updateCourseAccess(courseId);
        
        // Charger le cours
        if (window.playerManager) {
            await window.playerManager.loadCourse(courseId);
            showPlayer();
        } else {
            showError('Le lecteur de cours n\'est pas disponible');
        }
    } catch (error) {
        console.error('Erreur lors de l\'ouverture du cours:', error);
        showError('Impossible d\'ouvrir le cours');
    }
}

async function deleteCourse(courseId) {
    const course = CoursesState.downloadedCourses.find(c => c.course_id === courseId);
    const title = course ? course.title : 'ce cours';
    
    if (confirm(`Êtes-vous sûr de vouloir supprimer "${title}" ?\n\nCette action est irréversible.`)) {
        try {
            showLoader('Suppression en cours...');
            
            const result = await window.electronAPI.db.deleteCourse(courseId);
            
            if (result.success) {
                // Retirer de la liste locale
                CoursesState.downloadedCourses = CoursesState.downloadedCourses.filter(
                    c => c.course_id !== courseId
                );
                
                // Recharger l'affichage
                await loadCourses();
                
                showSuccess('Cours supprimé avec succès');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            showError(`Erreur lors de la suppression: ${error.message}`);
        } finally {
            hideLoader();
        }
    }
}

async function updateCourse(courseId) {
    showInfo('La mise à jour des cours sera disponible dans une prochaine version');
    // TODO: Implémenter la mise à jour des cours
}

function showCourseDetails(course) {
    // TODO: Afficher une modal avec les détails du cours
    console.log('Détails du cours:', course);
}

// ==================== UTILITAIRES ====================

function updateDashboardStats(courses) {
    try {
        // Nombre de cours
        const statCourses = document.getElementById('stat-courses');
        if (statCourses) {
            statCourses.textContent = courses.filter(c => c.isDownloaded).length;
        }
        
        // Cours terminés
        const completedCourses = courses.filter(c => c.completed || c.progress >= 100).length;
        const statCompleted = document.getElementById('stat-completed');
        if (statCompleted) {
            statCompleted.textContent = completedCourses;
        }
        
        // Progression moyenne
        const coursesWithProgress = courses.filter(c => c.isDownloaded);
        let avgProgress = 0;
        if (coursesWithProgress.length > 0) {
            const totalProgress = coursesWithProgress.reduce((sum, course) => sum + (course.progress || 0), 0);
            avgProgress = Math.round(totalProgress / coursesWithProgress.length);
        }
        
        const statProgress = document.getElementById('stat-progress');
        if (statProgress) {
            statProgress.textContent = `${avgProgress}%`;
        }
        
        // Mettre à jour le compteur dans le menu
        const coursesCount = document.getElementById('courses-count');
        if (coursesCount) {
            coursesCount.textContent = courses.filter(c => c.isDownloaded).length;
        }
        
    } catch (error) {
        console.error('[Courses] Erreur lors de la mise à jour des stats:', error);
    }
}

function changePage(page) {
    CoursesState.currentPage = page;
    loadCourses();
    
    // Scroll vers le haut
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== EXPORTS GLOBAUX ====================

window.coursesManager = {
    loadCourses,
    showDownloadModal,
    openCourse,
    deleteCourse,
    updateCourse,
    loadActiveDownloads
};

// Assigner les fonctions globales pour les onclick
window.showDownloadModal = showDownloadModal;
window.cancelDownload = cancelDownload;
window.retryDownload = retryDownload;
window.changePage = changePage;
window.downloadSingleCourse = downloadSingleCourse;
window.deleteCourse = deleteCourse;
window.updateCourse = updateCourse;
window.openCourse = openCourse;
window.loadCourses = loadCourses;

// ==================== STYLES CSS ====================

const coursesStyles = `
<style>
/* Filtres */
.courses-filters {
    margin-bottom: 24px;
    padding: 16px;
    background: var(--bg-primary);
    border-radius: 8px;
    box-shadow: var(--shadow);
}

.filters-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
}

.filters-row .form-control {
    flex: 1;
    min-width: 200px;
}

.filter-toggles {
    display: flex;
    gap: 16px;
}

/* Grille de cours */
.courses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
}

/* Carte de cours améliorée */
.course-card {
    position: relative;
    cursor: pointer;
    transition: all 0.3s;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.course-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-xl);
}

.course-thumbnail-wrapper {
    position: relative;
    height: 180px;
    overflow: hidden;
    border-radius: 8px 8px 0 0;
}

.course-thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.course-card:hover .course-thumbnail {
    transform: scale(1.05);
}

.course-expired-badge,
.course-downloaded-badge {
    position: absolute;
    top: 10px;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    z-index: 1;
}

.course-expired-badge {
    right: 10px;
    background: var(--danger-color);
    color: white;
}

.course-downloaded-badge {
    left: 10px;
    background: var(--success-color);
    color: white;
}

.course-actions {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.2s;
}

.course-card:hover .course-actions {
    opacity: 1;
}

.course-info {
    padding: 16px;
    flex: 1;
    display: flex;
    flex-direction: column;
}

.course-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
}

.course-instructor {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
}

.course-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
    flex-wrap: wrap;
    margin-bottom: 8px;
}

.course-progress-text {
    color: var(--success-color) !important;
    font-weight: 500;
}

.course-rating {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin-top: auto;
}

.rating-stars {
    letter-spacing: 2px;
}

.rating-count {
    color: var(--text-secondary);
}

.course-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--bg-secondary);
}

.course-progress-bar {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
}

/* Modal de téléchargement */
.course-preview {
    background: var(--bg-secondary);
    padding: 20px;
    border-radius: 8px;
    margin: 16px 0;
}

.course-preview h4 {
    margin: 0 0 12px;
    color: var(--primary-color);
    font-size: 18px;
}

.course-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.course-description {
    margin: 12px 0;
    line-height: 1.6;
}

.download-details {
    margin: 16px 0;
}

.download-details p {
    margin: 8px 0;
}

.info-note {
    color: var(--info-color);
    font-size: 13px;
    margin-top: 8px;
}

.warning-note {
    color: var(--warning-color);
    font-size: 13px;
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(255, 193, 7, 0.1);
    border-radius: 4px;
}

/* Téléchargements */
.downloads-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.download-item {
    background: var(--bg-primary);
    border-radius: 8px;
    padding: 20px;
    box-shadow: var(--shadow);
    transition: transform 0.2s;
}

.download-item:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-lg);
}

.download-header {
    display: flex;
    align-items: start;
    gap: 16px;
}

.download-icon {
    font-size: 24px;
    line-height: 1;
}

.download-info {
    flex: 1;
}

.download-info h4 {
    margin: 0 0 4px;
    font-size: 16px;
}

.download-status {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
}

.download-speed,
.download-eta {
    font-size: 12px;
    margin-left: 8px;
}

.download-error {
    font-size: 14px;
    color: var(--danger-color);
    margin: 4px 0 0;
}

.download-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.download-progress {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
}

.progress-bar {
    flex: 1;
    height: 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
    position: relative;
}

.progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.3),
        transparent
    );
    animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.progress-text {
    font-size: 13px;
    font-weight: 500;
    min-width: 40px;
    text-align: right;
}

/* Options de téléchargement */
.download-options {
    margin: 20px 0;
}

.download-options .checkbox-label {
    margin-bottom: 12px;
    display: flex;
    align-items: center;
}

/* Pagination */
.pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
}

.pagination button {
    min-width: 36px;
    height: 36px;
}

.pagination span {
    color: var(--text-secondary);
    font-size: 14px;
}

/* Responsive */
@media (max-width: 768px) {
    .courses-grid {
        grid-template-columns: 1fr;
    }
    
    .filters-row {
        flex-direction: column;
    }
    
    .filters-row .form-control {
        width: 100%;
    }
}
</style>
`;

// Injecter les styles
document.head.insertAdjacentHTML('beforeend', coursesStyles);

console.log('[Courses] Module chargé');
