// courses.js - Gestion des cours

// État local du module
const CoursesState = {
    availableCourses: [],
    downloadQueue: new Map(),
    activeDownloads: new Map(),
    filters: {
        category: null,
        difficulty: null,
        search: ''
    }
};

// Gestionnaires d'événements pour le téléchargement
document.getElementById('download-course-btn')?.addEventListener('click', showDownloadModal);
document.getElementById('close-download-modal')?.addEventListener('click', hideDownloadModal);
document.getElementById('cancel-download')?.addEventListener('click', hideDownloadModal);
document.getElementById('start-download')?.addEventListener('click', startDownload);

// Options de téléchargement
document.getElementById('include-videos')?.addEventListener('change', updateDownloadEstimate);
document.getElementById('include-documents')?.addEventListener('change', updateDownloadEstimate);
document.getElementById('compress-media')?.addEventListener('change', updateDownloadEstimate);

// Afficher la modal de téléchargement
async function showDownloadModal() {
    showLoader('Chargement des cours disponibles...');
    
    const modal = document.getElementById('download-modal');
    modal.classList.remove('hidden');
    
    // Charger la liste des cours disponibles
    await loadAvailableCourses();
    
    hideLoader();
}

// Masquer la modal de téléchargement
function hideDownloadModal() {
    const modal = document.getElementById('download-modal');
    modal.classList.add('hidden');
    
    // Réinitialiser le formulaire
    document.getElementById('course-select').value = '';
    document.getElementById('download-info').classList.add('hidden');
}

// Charger les cours disponibles depuis l'API
async function loadAvailableCourses() {
    const select = document.getElementById('course-select');
    select.innerHTML = '<option value="">Chargement des cours...</option>';
    
    try {
        const result = await window.electronAPI.api.getCourses(1, 100);
        
        if (result.success) {
            CoursesState.availableCourses = result.courses;
            
            // Récupérer les cours déjà téléchargés
            const downloadedCourses = await window.electronAPI.db.getAllCourses();
            const downloadedIds = new Set(downloadedCourses.map(c => c.course_id));
            
            // Filtrer les cours déjà téléchargés
            const availableForDownload = result.courses.filter(
                course => !downloadedIds.has(course.id)
            );
            
            if (availableForDownload.length === 0) {
                select.innerHTML = '<option value="">Tous les cours sont déjà téléchargés</option>';
            } else {
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
                        optgroup.appendChild(option);
                    });
                    
                    select.appendChild(optgroup);
                });
            }
            
            // Écouter les changements de sélection
            select.addEventListener('change', onCourseSelected);
        } else {
            select.innerHTML = '<option value="">Erreur lors du chargement des cours</option>';
            showError('Impossible de charger la liste des cours');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des cours:', error);
        select.innerHTML = '<option value="">Erreur de connexion</option>';
        showError('Erreur de connexion au serveur');
    }
}

// Gérer la sélection d'un cours
function onCourseSelected(e) {
    const courseId = parseInt(e.target.value);
    updateDownloadEstimate();
}

// Mettre à jour l'estimation du téléchargement
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
        estimatedSize += course.video_size || 500 * 1024 * 1024; // 500 MB par défaut
        contentTypes.push('Vidéos');
    }
    if (includeDocuments) {
        estimatedSize += course.document_size || 50 * 1024 * 1024; // 50 MB par défaut
        contentTypes.push('Documents');
    }
    
    if (compressMedia && includeVideos) {
        estimatedSize *= 0.7; // 30% de compression
    }
    
    infoDiv.innerHTML = `
        <div class="course-preview">
            <h4>${course.title}</h4>
            <p class="course-meta">
                <span>👤 ${course.instructor?.name || 'Instructeur'}</span>
                <span>📚 ${course.lessons_count || 0} leçons</span>
                <span>⏱️ ${course.duration || 'Durée inconnue'}</span>
            </p>
            <div class="download-details">
                <p><strong>Contenu à télécharger :</strong> ${contentTypes.join(', ') || 'Aucun'}</p>
                <p><strong>Taille estimée :</strong> ${Utils.formatFileSize(estimatedSize)}</p>
                ${compressMedia ? '<p class="info-note">📦 Compression activée - La taille finale peut être réduite</p>' : ''}
            </div>
            ${course.expires_at ? `
                <p class="warning-note">⚠️ Ce cours expire le ${Utils.formatDate(course.expires_at, 'long')}</p>
            ` : ''}
        </div>
    `;
    
    infoDiv.classList.remove('hidden');
}

// Démarrer le téléchargement
async function startDownload() {
    const courseId = parseInt(document.getElementById('course-select').value);
    if (!courseId) {
        showError('Veuillez sélectionner un cours');
        return;
    }
    
    const course = CoursesState.availableCourses.find(c => c.id === courseId);
    if (!course) return;
    
    // Vérifier l'espace disponible
    const storageInfo = await Utils.calculateStorageUsed();
    // TODO: Implémenter la vérification réelle de l'espace disponible
    
    // Options de téléchargement
    const options = {
        includeVideos: document.getElementById('include-videos').checked,
        includeDocuments: document.getElementById('include-documents').checked,
        compressMedia: document.getElementById('compress-media').checked
    };
    
    if (!options.includeVideos && !options.includeDocuments) {
        showError('Veuillez sélectionner au moins un type de contenu à télécharger');
        return;
    }
    
    // Fermer la modal
    hideDownloadModal();
    
    // Ajouter à la file d'attente
    addToDownloadQueue(course, options);
    
    // Afficher la page des téléchargements
    document.querySelector('[data-page="downloads"]').click();
}

// Ajouter un cours à la file de téléchargement
function addToDownloadQueue(course, options) {
    const downloadId = `download-${course.id}-${Date.now()}`;
    
    const download = {
        id: downloadId,
        course: course,
        options: options,
        status: 'pending',
        progress: 0,
        startTime: null,
        error: null,
        currentFile: null,
        totalFiles: 0,
        downloadedFiles: 0
    };
    
    CoursesState.downloadQueue.set(downloadId, download);
    CoursesState.activeDownloads.set(downloadId, download);
    
    // Logger le début du téléchargement
    Logger.log('Téléchargement ajouté à la file', {
        courseId: course.id,
        title: course.title,
        options
    });
    
    // Démarrer le téléchargement
    processDownloadQueue();
}

// Traiter la file de téléchargement
async function processDownloadQueue() {
    // Limiter à 2 téléchargements simultanés
    const activeCount = Array.from(CoursesState.activeDownloads.values())
        .filter(d => d.status === 'downloading').length;
    
    if (activeCount >= 2) return;
    
    // Trouver le prochain téléchargement en attente
    const nextDownload = Array.from(CoursesState.activeDownloads.values())
        .find(d => d.status === 'pending');
    
    if (!nextDownload) return;
    
    // Démarrer le téléchargement
    await downloadCourse(nextDownload);
    
    // Continuer avec le suivant
    processDownloadQueue();
}

// Télécharger un cours
async function downloadCourse(download) {
    download.status = 'downloading';
    download.startTime = Date.now();
    updateDownloadDisplay();
    
    try {
        // Écouter les événements de progression
        const progressHandler = (data) => {
            if (data.courseId === download.course.id) {
                download.progress = data.progress || 0;
                download.currentFile = data.currentFile;
                download.status = data.status || 'downloading';
                updateDownloadDisplay();
            }
        };
        
        window.electronAPI.on('download-progress', progressHandler);
        
        // Démarrer le téléchargement via l'API
        const result = await window.electronAPI.api.downloadCourse(
            download.course.id,
            download.options
        );
        
        if (result.success) {
            // Sauvegarder les informations du cours
            await saveCourseToDatabase(download.course, result);
            
            download.status = 'completed';
            download.progress = 100;
            
            showSuccess(`Cours "${download.course.title}" téléchargé avec succès`);
            
            // Supprimer de la file après 5 secondes
            setTimeout(() => {
                CoursesState.activeDownloads.delete(download.id);
                updateDownloadDisplay();
            }, 5000);
            
            // Rafraîchir la liste des cours
            await loadCourses();
            
        } else {
            throw new Error(result.error || 'Échec du téléchargement');
        }
        
        // Nettoyer l'écouteur
        window.electronAPI.off('download-progress');
        
    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        download.status = 'error';
        download.error = error.message;
        updateDownloadDisplay();
        
        showError(`Erreur lors du téléchargement: ${error.message}`);
        
        // Logger l'erreur
        window.electronAPI.logError({
            message: 'Erreur de téléchargement',
            error: error.toString(),
            courseId: download.course.id
        });
    }
}

// Sauvegarder le cours dans la base de données
async function saveCourseToDatabase(courseData, downloadResult) {
    try {
        // Sauvegarder le cours principal
        await window.electronAPI.db.saveCourse({
            ...courseData,
            expires_at: courseData.expires_at || 
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 jours par défaut
            checksum: downloadResult.packageId,
            version: courseData.version || 1
        });
        
        // Récupérer et sauvegarder les détails du cours
        const details = await window.electronAPI.api.getCourseDetails(courseData.id);
        
        if (details.success && details.course.sections) {
            for (const section of details.course.sections) {
                await window.electronAPI.db.saveSection({
                    ...section,
                    course_id: courseData.id
                });
                
                if (section.lessons) {
                    for (const lesson of section.lessons) {
                        await window.electronAPI.db.saveLesson({
                            ...lesson,
                            section_id: section.id
                        });
                    }
                }
            }
        }
        
        // Sauvegarder les informations des fichiers téléchargés
        if (downloadResult.files) {
            for (const file of downloadResult.files) {
                await window.electronAPI.db.saveMedia({
                    id: file.checksum ? file.checksum.substring(0, 16) : Utils.generateId(),
                    course_id: courseData.id,
                    type: getMediaType(file.filename),
                    filename: file.filename,
                    path: file.path,
                    size: file.size,
                    checksum: file.checksum
                });
            }
        }
        
        Logger.log('Cours sauvegardé dans la base de données', {
            courseId: courseData.id,
            sections: details.course?.sections?.length || 0
        });
        
    } catch (error) {
        console.error('Erreur lors de la sauvegarde dans la base de données:', error);
        throw error;
    }
}

// Mettre à jour l'affichage des téléchargements
function updateDownloadDisplay() {
    const container = document.getElementById('downloads-container');
    
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
    
    container.innerHTML = '';
    
    CoursesState.activeDownloads.forEach(download => {
        const downloadEl = createDownloadElement(download);
        container.appendChild(downloadEl);
    });
}

// Créer l'élément d'affichage d'un téléchargement
function createDownloadElement(download) {
    const el = document.createElement('div');
    el.className = 'download-item';
    el.dataset.downloadId = download.id;
    
    const statusIcon = {
        pending: '⏳',
        downloading: '⬇️',
        completed: '✅',
        error: '❌',
        cancelled: '🚫'
    }[download.status];
    
    const statusText = {
        pending: 'En attente',
        downloading: 'Téléchargement',
        completed: 'Terminé',
        error: 'Erreur',
        cancelled: 'Annulé'
    }[download.status];
    
    // Calculer la vitesse et le temps restant
    let speedInfo = '';
    if (download.status === 'downloading' && download.startTime) {
        const elapsed = (Date.now() - download.startTime) / 1000; // en secondes
        const speed = download.progress > 0 ? (download.progress / elapsed) : 0;
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
                <h4>${download.course.title}</h4>
                <p class="download-status">
                    ${statusText} 
                    ${download.currentFile ? `- ${download.currentFile}` : ''}
                    ${speedInfo}
                </p>
                ${download.error ? `<p class="download-error">${download.error}</p>` : ''}
            </div>
            ${download.status === 'downloading' || download.status === 'pending' ? `
                <button class="btn btn-icon" onclick="cancelDownload('${download.id}')" title="Annuler">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            ` : ''}
        </div>
        ${download.status === 'downloading' ? `
            <div class="download-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${download.progress}%"></div>
                </div>
                <span class="progress-text">${download.progress}%</span>
            </div>
        ` : ''}
    `;
    
    return el;
}

// Annuler un téléchargement
window.cancelDownload = function(downloadId) {
    const download = CoursesState.activeDownloads.get(downloadId);
    if (download && (download.status === 'downloading' || download.status === 'pending')) {
        if (confirm('Êtes-vous sûr de vouloir annuler ce téléchargement ?')) {
            download.status = 'cancelled';
            
            // TODO: Implémenter l'annulation côté main process
            
            setTimeout(() => {
                CoursesState.activeDownloads.delete(downloadId);
                updateDownloadDisplay();
            }, 2000);
            
            showInfo('Téléchargement annulé');
        }
    }
};

// Charger la page des téléchargements
function loadDownloads() {
    updateDownloadDisplay();
}

// Utilitaires
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

// Styles CSS pour les cours et téléchargements
const coursesStyles = `
<style>
.course-preview {
    background: var(--bg-secondary);
    padding: 16px;
    border-radius: 8px;
}

.course-preview h4 {
    margin: 0 0 8px;
    color: var(--primary-color);
}

.course-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
}

.download-details p {
    margin: 4px 0;
}

.info-note {
    color: var(--info-color);
    font-size: 13px;
}

.warning-note {
    color: var(--warning-color);
    font-size: 13px;
    margin-top: 8px;
}

.download-item {
    background: var(--bg-primary);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
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

.download-speed, .download-eta {
    font-size: 12px;
    margin-left: 8px;
}

.download-error {
    font-size: 14px;
    color: var(--danger-color);
    margin: 4px 0 0;
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

.download-options {
    margin: 20px 0;
}

.download-options .checkbox-label {
    margin-bottom: 12px;
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
</style>
`;

document.head.insertAdjacentHTML('beforeend', coursesStyles);

// Export des fonctions globales
window.coursesManager = {
    loadCourses,
    loadDownloads,
    searchCourses,
    showDownloadModal
};
