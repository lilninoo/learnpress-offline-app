// course-functions.js - Centralisation des fonctions de gestion des cours avec DEBUG

// Importer les dépendances nécessaires
const CourseFunctions = {
    // Créer une carte de cours avec toutes les fonctionnalités
    createCourseCard: function(course) {
        const progress = course.progress || 0;
        const thumbnail = course.thumbnail || 'assets/default-course.jpg';
        const isDownloaded = course.isDownloaded || false;
        const isExpired = course.expires_at && new Date(course.expires_at) < new Date();
        
        return `
            <div class="course-card card" data-course-id="${course.id || course.course_id}">
                <div class="course-thumbnail-wrapper">
                    <img src="${thumbnail}" 
                         alt="${this.escapeHtml(course.title)}" 
                         class="course-thumbnail"
                         onerror="this.src='assets/default-course.jpg'">
                    ${progress > 0 ? `
                    <div class="course-progress-overlay">
                        <div class="progress-circle">
                            <span>${progress}%</span>
                        </div>
                    </div>
                    ` : ''}
                    ${isExpired ? '<div class="course-expired-badge">Expiré</div>' : ''}
                    ${isDownloaded ? '<div class="course-downloaded-badge" title="Cours téléchargé">💾</div>' : ''}
                </div>
                <div class="card-body">
                    <h3 class="course-title">${this.escapeHtml(course.title)}</h3>
                    <p class="course-instructor">${this.escapeHtml(course.instructor_name || 'Instructeur')}</p>
                    <div class="course-meta">
                        <span>📚 ${course.lessons_count || 0} leçons</span>
                        <span>•</span>
                        <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
                    </div>
                    <div class="course-actions">
                        ${this.createCourseActions(course, isDownloaded)}
                    </div>
                </div>
            </div>
        `;
    },

    // Créer les actions pour une carte de cours
    createCourseActions: function(course, isDownloaded) {
        if (isDownloaded) {
            return `
                <button class="btn btn-primary btn-sm play-course-btn" data-course-id="${course.id || course.course_id}">
                    ${course.progress > 0 ? 'Continuer' : 'Commencer'}
                </button>
                ${course.completed ? `
                <button class="btn btn-secondary btn-sm" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                    Terminé
                </button>
                ` : ''}
            `;
        } else {
            return `
                <button class="btn btn-primary btn-sm download-course-btn" data-course-id="${course.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    Télécharger
                </button>
            `;
        }
    },

    // Attacher les event listeners aux cartes de cours
    attachCourseEventListeners: function() {
        console.log('[DEBUG] Attaching course event listeners...');
        
        // Boutons de lecture
        document.querySelectorAll('.play-course-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const courseId = btn.dataset.courseId;
                console.log('[DEBUG] Play button clicked for course:', courseId);
                
                if (window.openCoursePlayer) {
                    window.openCoursePlayer(courseId);
                } else if (window.openCourse) {
                    window.openCourse(courseId);
                } else {
                    console.error('[DEBUG] No course player function available');
                }
            });
        });
        
        // Boutons de téléchargement
        document.querySelectorAll('.download-course-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const courseId = btn.dataset.courseId;
                console.log('[DEBUG] Download button clicked for course:', courseId);
                
                if (window.downloadSingleCourse) {
                    window.downloadSingleCourse(courseId);
                } else {
                    console.error('[DEBUG] downloadSingleCourse function not available');
                }
            });
        });
        
        // Cartes de cours (clic général)
        document.querySelectorAll('.course-card').forEach(card => {
            // Retirer les anciens listeners
            const newCard = card.cloneNode(true);
            card.parentNode.replaceChild(newCard, card);
            
            newCard.addEventListener('click', (e) => {
                // Ignorer si clic sur un bouton
                if (e.target.closest('button')) return;
                
                const courseId = newCard.dataset.courseId;
                console.log('[DEBUG] Course card clicked:', courseId);
                
                // Vérifier si le cours est téléchargé
                const isDownloaded = newCard.querySelector('.course-downloaded-badge') !== null;
                
                if (isDownloaded) {
                    if (window.openCoursePlayer) {
                        window.openCoursePlayer(courseId);
                    } else if (window.openCourse) {
                        window.openCourse(courseId);
                    }
                } else {
                    if (window.showCourseDetails) {
                        window.showCourseDetails(courseId);
                    } else {
                        // Afficher les détails ou proposer le téléchargement
                        if (confirm('Voulez-vous télécharger ce cours ?')) {
                            if (window.downloadSingleCourse) {
                                window.downloadSingleCourse(courseId);
                            }
                        }
                    }
                }
            });
        });
    },

    // Afficher le modal de téléchargement
    showDownloadModal: async function() {
        console.log('[DEBUG] showDownloadModal called');
        
        const modal = document.getElementById('download-modal');
        if (!modal) {
            console.error('[DEBUG] Download modal element not found');
            return;
        }
        
        modal.classList.remove('hidden');
        
        // Afficher un loader
        const courseSelect = document.getElementById('course-select');
        if (courseSelect) {
            courseSelect.innerHTML = '<option value="">Chargement des cours...</option>';
        } else {
            console.error('[DEBUG] course-select element not found');
        }
        
        try {
            console.log('[DEBUG] Checking window.electronAPI:', window.electronAPI);
            
            if (!window.electronAPI || !window.electronAPI.api) {
                console.error('[DEBUG] window.electronAPI.api is not available');
                courseSelect.innerHTML = '<option value="">Erreur: API non disponible</option>';
                return;
            }
            
            console.log('[DEBUG] Calling getUserCourses with params:', {
                enrolled_only: true,
                page: 1,
                per_page: 100
            });
            
            // Récupérer les cours disponibles
            const response = await window.electronAPI.api.getUserCourses({
                enrolled_only: true,
                page: 1,
                per_page: 100
            });
            
            console.log('[DEBUG] API Response:', response);
            
            // Vérifier si la réponse contient une erreur HTML
            if (response.error && response.error.includes('<p>') && response.error.includes('</p>')) {
                console.error('[DEBUG] Server returned HTML error:', response.error);
                
                // Extraire le message d'erreur du HTML si possible
                const errorMatch = response.error.match(/<p>(.*?)<\/p>/);
                const errorMessage = errorMatch ? errorMatch[1] : 'Erreur serveur';
                
                courseSelect.innerHTML = `<option value="">Erreur serveur: ${this.escapeHtml(errorMessage)}</option>`;
                
                // Afficher plus de détails dans la console
                console.error('[DEBUG] Full error response:', response);
                
                // Suggérer des actions
                console.log('[DEBUG] Suggestions:');
                console.log('1. Vérifier les logs PHP sur le serveur');
                console.log('2. Activer WP_DEBUG dans wp-config.php');
                console.log('3. Vérifier que LearnPress est installé et activé');
                console.log('4. Vérifier les permissions de l\'utilisateur');
                
                if (window.showError) {
                    window.showError('Erreur serveur. Consultez les logs pour plus de détails.');
                }
                return;
            }
            
            if (response.success && response.courses && response.courses.length > 0) {
                courseSelect.innerHTML = '<option value="">Sélectionnez un cours</option>';
                
                console.log(`[DEBUG] ${response.courses.length} cours trouvés sur le serveur`);
                
                // Récupérer les cours déjà téléchargés
                let downloadedIds = new Set();
                try {
                    console.log('[DEBUG] Getting local courses...');
                    const localCourses = await window.electronAPI.db.getAllCourses();
                    console.log('[DEBUG] Local courses response:', localCourses);
                    
                    if (localCourses.success && localCourses.result) {
                        downloadedIds = new Set(localCourses.result.map(c => c.course_id));
                        console.log(`[DEBUG] ${downloadedIds.size} cours déjà téléchargés:`, Array.from(downloadedIds));
                    }
                } catch (err) {
                    console.error('[DEBUG] Error getting local courses:', err);
                }
                
                // Filtrer et afficher les cours non téléchargés
                const availableCourses = response.courses.filter(course => {
                    const courseId = course.id || course.course_id;
                    const isDownloaded = downloadedIds.has(courseId);
                    console.log(`[DEBUG] Course ${courseId} "${course.title}" - Downloaded: ${isDownloaded}`);
                    return !isDownloaded;
                });
                
                console.log('[DEBUG] Available courses after filtering:', availableCourses);
                
                if (availableCourses.length === 0) {
                    courseSelect.innerHTML = '<option value="">Tous les cours sont déjà téléchargés</option>';
                } else {
                    availableCourses.forEach(course => {
                        const option = document.createElement('option');
                        option.value = course.id;
                        option.textContent = course.title;
                        courseSelect.appendChild(option);
                    });
                }
                
                console.log(`[DEBUG] ${availableCourses.length} cours disponibles pour téléchargement`);
            } else {
                courseSelect.innerHTML = '<option value="">Aucun cours disponible</option>';
                console.warn('[DEBUG] No courses available - Full response:', response);
                
                // Analyser pourquoi aucun cours n'est disponible
                if (!response.success) {
                    console.error('[DEBUG] API call was not successful');
                    console.error('[DEBUG] Error type:', response.errorType);
                    console.error('[DEBUG] Error message:', response.error);
                } else if (!response.courses) {
                    console.error('[DEBUG] Response has no courses property');
                } else if (response.courses.length === 0) {
                    console.log('[DEBUG] Courses array is empty');
                }
            }
        } catch (error) {
            console.error('[DEBUG] Exception in showDownloadModal:', error);
            console.error('[DEBUG] Error stack:', error.stack);
            
            if (courseSelect) {
                courseSelect.innerHTML = '<option value="">Erreur de chargement</option>';
            }
            
            if (window.showError) {
                window.showError(`Impossible de charger la liste des cours: ${error.message}`);
            }
        }
    },

    // Fonction utilitaire pour échapper le HTML
    escapeHtml: function(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Exporter les fonctions globalement
window.CourseFunctions = CourseFunctions;

// Alias pour compatibilité
window.createCourseCard = CourseFunctions.createCourseCard.bind(CourseFunctions);
window.attachCourseEventListeners = CourseFunctions.attachCourseEventListeners.bind(CourseFunctions);
window.showDownloadModal = CourseFunctions.showDownloadModal.bind(CourseFunctions);

console.log('[DEBUG] CourseFunctions module loaded successfully');
