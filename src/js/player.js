// player.js - Lecteur de cours avec support du déchiffrement sécurisé

// État du lecteur
const PlayerState = {
    currentCourse: null,
    currentLesson: null,
    currentSection: null,
    lessonProgress: 0,
    videoPlayer: null,
    saveProgressInterval: null,
    streamUrl: null,
    notes: []
};

// Initialisation du lecteur
document.addEventListener('DOMContentLoaded', () => {
    initializePlayer();
    setupPlayerControls();
    setupKeyboardShortcuts();
});

// Initialiser le lecteur
function initializePlayer() {
    console.log('[Player] Initialisation du lecteur');
    
    // Événements de navigation
    document.getElementById('back-to-courses')?.addEventListener('click', exitPlayer);
    document.getElementById('prev-lesson')?.addEventListener('click', previousLesson);
    document.getElementById('next-lesson')?.addEventListener('click', nextLesson);
    document.getElementById('complete-lesson')?.addEventListener('click', completeCurrentLesson);
    
    // Contrôles vidéo personnalisés
    document.getElementById('play-pause-btn')?.addEventListener('click', togglePlayPause);
    document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('speed-control')?.addEventListener('change', changePlaybackSpeed);
    document.getElementById('volume-control')?.addEventListener('input', changeVolume);
    
    // Notes et annotations
    document.getElementById('add-note-btn')?.addEventListener('click', showNoteDialog);
    document.getElementById('toggle-notes')?.addEventListener('click', toggleNotesPanel);
}

// Charger une leçon
async function loadLesson(lessonId) {
    try {
        showPlayerLoader('Chargement de la leçon...');
        
        // Sauvegarder la progression de la leçon précédente
        if (PlayerState.currentLesson) {
            await saveProgress();
        }
        
        // Nettoyer l'ancien contenu
        cleanupCurrentLesson();
        
        // Charger la nouvelle leçon
        const response = await window.electronAPI.db.getLesson(lessonId);
        if (!response.success) {
            throw new Error(response.error);
        }
        
        PlayerState.currentLesson = response.result;
        
        if (!PlayerState.currentLesson) {
            throw new Error('Leçon non trouvée');
        }
        
        console.log('[Player] Leçon chargée:', PlayerState.currentLesson.title);
        
        // Mettre à jour l'interface
        updatePlayerUI();
        
        // Charger le contenu selon le type
        await loadLessonContent();
        
        // Marquer la leçon comme active dans la sidebar
        markLessonActive(lessonId);
        
        // Charger les notes de la leçon
        await loadLessonNotes(lessonId);
        
        // Démarrer le suivi de progression
        startProgressTracking();
        
        hidePlayerLoader();
        
    } catch (error) {
        console.error('[Player] Erreur lors du chargement de la leçon:', error);
        hidePlayerLoader();
        showPlayerError('Impossible de charger la leçon');
    }
}

// Charger le contenu de la leçon
async function loadLessonContent() {
    const contentContainer = document.getElementById('lesson-content');
    contentContainer.innerHTML = '';
    
    try {
        // Récupérer les médias associés
        const mediaResponse = await window.electronAPI.db.getMediaByLesson(PlayerState.currentLesson.lesson_id);
        const mediaList = mediaResponse.success ? mediaResponse.result : [];
        
        console.log('[Player] Médias trouvés:', mediaList.length);
        
        // Créer le contenu selon le type
        switch (PlayerState.currentLesson.type) {
            case 'video':
                await createVideoPlayer(contentContainer, mediaList);
                break;
            case 'text':
            case 'article':
                createTextContent(contentContainer);
                break;
            case 'quiz':
                await createQuizContent(contentContainer);
                break;
            case 'pdf':
                await createPDFViewer(contentContainer, mediaList);
                break;
            case 'assignment':
                await createAssignmentContent(contentContainer);
                break;
            default:
                createGenericContent(contentContainer);
        }
        
        // Ajouter les ressources supplémentaires
        if (mediaList.length > 1 || (mediaList.length > 0 && PlayerState.currentLesson.type !== 'video')) {
            createResourcesList(contentContainer, mediaList);
        }
        
    } catch (error) {
        console.error('[Player] Erreur lors du chargement du contenu:', error);
        contentContainer.innerHTML = `
            <div class="error-message">
                <h3>Erreur de chargement</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="retryLoadContent()">Réessayer</button>
            </div>
        `;
    }
}

// Créer le lecteur vidéo sécurisé
async function createVideoPlayer(container, mediaList) {
    const videoMedia = mediaList.find(m => m.type === 'video');
    
    if (!videoMedia) {
        container.innerHTML = `
            <div class="no-content-message">
                <svg class="no-content-icon" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p>Aucune vidéo disponible pour cette leçon</p>
            </div>
        `;
        return;
    }
    
    console.log('[Player] Création du lecteur vidéo pour:', videoMedia.filename);
    
    // Créer une URL de streaming sécurisée
    try {
        const streamResponse = await window.electronAPI.createStreamUrl({
            filePath: videoMedia.path,
            mimeType: videoMedia.mime_type || 'video/mp4'
        });
        
        if (!streamResponse.success) {
            throw new Error(streamResponse.error);
        }
        
        PlayerState.streamUrl = streamResponse.url;
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-player-container';
        
        videoContainer.innerHTML = `
            <div class="video-wrapper">
                <video id="lesson-video" class="video-player" controlsList="nodownload">
                    <source src="${PlayerState.streamUrl}" type="${videoMedia.mime_type || 'video/mp4'}">
                    Votre navigateur ne supporte pas la lecture vidéo.
                </video>
                
                <!-- Contrôles personnalisés -->
                <div class="video-controls" id="video-controls">
                    <div class="progress-bar" id="video-progress">
                        <div class="progress-buffered" id="progress-buffered"></div>
                        <div class="progress-played" id="progress-played"></div>
                        <div class="progress-handle" id="progress-handle"></div>
                    </div>
                    
                    <div class="controls-row">
                        <div class="controls-left">
                            <button class="control-btn" id="play-pause-btn">
                                <svg class="play-icon" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                                <svg class="pause-icon" style="display: none;" viewBox="0 0 24 24">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                            </button>
                            
                            <button class="control-btn" onclick="skipBackward()">
                                <svg viewBox="0 0 24 24">
                                    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
                                </svg>
                                <span class="skip-label">-10s</span>
                            </button>
                            
                            <button class="control-btn" onclick="skipForward()">
                                <svg viewBox="0 0 24 24">
                                    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
                                </svg>
                                <span class="skip-label">+10s</span>
                            </button>
                            
                            <div class="volume-control">
                                <button class="control-btn" id="volume-btn" onclick="toggleMute()">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                    </svg>
                                </button>
                                <input type="range" id="volume-control" min="0" max="100" value="100">
                            </div>
                            
                            <span class="time-display">
                                <span id="current-time">0:00</span> / <span id="duration">0:00</span>
                            </span>
                        </div>
                        
                        <div class="controls-right">
                            <select class="speed-control" id="speed-control">
                                <option value="0.5">0.5x</option>
                                <option value="0.75">0.75x</option>
                                <option value="1" selected>1x</option>
                                <option value="1.25">1.25x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2">2x</option>
                            </select>
                            
                            <button class="control-btn" id="captions-btn" onclick="toggleCaptions()">
                                <svg viewBox="0 0 24 24">
                                    <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
                                </svg>
                            </button>
                            
                            <button class="control-btn" id="fullscreen-btn">
                                <svg viewBox="0 0 24 24">
                                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Overlay pour les notes -->
                <div class="video-overlay" id="video-overlay" style="display: none;">
                    <div class="note-marker" style="left: 50%; top: 50%;">
                        <span class="note-content">Note ajoutée ici</span>
                    </div>
                </div>
            </div>
            
            <!-- Panneau des chapitres -->
            <div class="chapters-panel" id="chapters-panel">
                <h4>Chapitres</h4>
                <div class="chapters-list" id="chapters-list">
                    <!-- Les chapitres seront ajoutés ici -->
                </div>
            </div>
        `;
        
        container.appendChild(videoContainer);
        
        // Initialiser le lecteur vidéo
        PlayerState.videoPlayer = document.getElementById('lesson-video');
        
        // Configurer les événements vidéo
        setupVideoEvents();
        
        // Restaurer la position si disponible
        if (PlayerState.currentLesson.last_position > 0) {
            PlayerState.videoPlayer.currentTime = PlayerState.currentLesson.last_position;
        }
        
        // Charger les chapitres si disponibles
        loadVideoChapters();
        
    } catch (error) {
        console.error('[Player] Erreur lors de la création du lecteur vidéo:', error);
        container.innerHTML = `
            <div class="error-message">
                <h3>Erreur de lecture</h3>
                <p>Impossible de lire cette vidéo. ${error.message}</p>
            </div>
        `;
    }
}

// Configurer les événements vidéo
function setupVideoEvents() {
    const video = PlayerState.videoPlayer;
    if (!video) return;
    
    // Événements de lecture
    video.addEventListener('play', onVideoPlay);
    video.addEventListener('pause', onVideoPause);
    video.addEventListener('ended', onVideoEnded);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('loadedmetadata', onVideoMetadataLoaded);
    video.addEventListener('progress', onVideoProgress);
    video.addEventListener('error', onVideoError);
    
    // Barre de progression
    const progressBar = document.getElementById('video-progress');
    progressBar?.addEventListener('click', seekVideo);
    progressBar?.addEventListener('mousedown', startSeek);
    
    // Raccourcis clavier pour la vidéo
    video.addEventListener('keydown', handleVideoKeyboard);
}

// Événements vidéo
function onVideoPlay() {
    updatePlayPauseButton(true);
    startProgressTracking();
}

function onVideoPause() {
    updatePlayPauseButton(false);
    saveProgress();
}

function onVideoEnded() {
    PlayerState.lessonProgress = 100;
    completeCurrentLesson();
}

function onVideoTimeUpdate() {
    if (!PlayerState.videoPlayer) return;
    
    const video = PlayerState.videoPlayer;
    const currentTime = video.currentTime;
    const duration = video.duration;
    
    if (duration) {
        // Mettre à jour la progression
        PlayerState.lessonProgress = Math.round((currentTime / duration) * 100);
        
        // Mettre à jour l'affichage
        updateTimeDisplay(currentTime, duration);
        updateProgressBar(currentTime, duration);
        
        // Sauvegarder la position
        PlayerState.currentLesson.last_position = Math.floor(currentTime);
    }
}

function onVideoMetadataLoaded() {
    const video = PlayerState.videoPlayer;
    if (video && video.duration) {
        document.getElementById('duration').textContent = formatTime(video.duration);
    }
}

function onVideoProgress() {
    // Afficher le buffering
    const video = PlayerState.videoPlayer;
    if (video && video.buffered.length > 0) {
        const buffered = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration;
        const percent = (buffered / duration) * 100;
        
        const bufferedBar = document.getElementById('progress-buffered');
        if (bufferedBar) {
            bufferedBar.style.width = percent + '%';
        }
    }
}

function onVideoError(e) {
    console.error('[Player] Erreur vidéo:', e);
    showPlayerError('Erreur lors de la lecture de la vidéo');
}

// Contrôles vidéo
function togglePlayPause() {
    if (PlayerState.videoPlayer) {
        if (PlayerState.videoPlayer.paused) {
            PlayerState.videoPlayer.play();
        } else {
            PlayerState.videoPlayer.pause();
        }
    }
}

function updatePlayPauseButton(isPlaying) {
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    
    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

function skipBackward() {
    if (PlayerState.videoPlayer) {
        PlayerState.videoPlayer.currentTime = Math.max(0, PlayerState.videoPlayer.currentTime - 10);
    }
}

function skipForward() {
    if (PlayerState.videoPlayer) {
        const video = PlayerState.videoPlayer;
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
    }
}

function changePlaybackSpeed(e) {
    if (PlayerState.videoPlayer) {
        PlayerState.videoPlayer.playbackRate = parseFloat(e.target.value);
    }
}

function changeVolume(e) {
    if (PlayerState.videoPlayer) {
        PlayerState.videoPlayer.volume = e.target.value / 100;
    }
}

function toggleMute() {
    if (PlayerState.videoPlayer) {
        PlayerState.videoPlayer.muted = !PlayerState.videoPlayer.muted;
        updateVolumeButton();
    }
}

function toggleFullscreen() {
    const container = document.querySelector('.video-player-container');
    if (!container) return;
    
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error('Erreur fullscreen:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// Seeking vidéo
function seekVideo(e) {
    if (!PlayerState.videoPlayer) return;
    
    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    
    PlayerState.videoPlayer.currentTime = percent * PlayerState.videoPlayer.duration;
}

let isSeeking = false;
function startSeek(e) {
    isSeeking = true;
    document.addEventListener('mousemove', handleSeek);
    document.addEventListener('mouseup', endSeek);
}

function handleSeek(e) {
    if (!isSeeking || !PlayerState.videoPlayer) return;
    
    const progressBar = document.getElementById('video-progress');
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    
    PlayerState.videoPlayer.currentTime = percent * PlayerState.videoPlayer.duration;
}

function endSeek() {
    isSeeking = false;
    document.removeEventListener('mousemove', handleSeek);
    document.removeEventListener('mouseup', endSeek);
}

// Mise à jour de l'affichage
function updateTimeDisplay(currentTime, duration) {
    document.getElementById('current-time').textContent = formatTime(currentTime);
    document.getElementById('duration').textContent = formatTime(duration);
}

function updateProgressBar(currentTime, duration) {
    const percent = (currentTime / duration) * 100;
    const playedBar = document.getElementById('progress-played');
    const handle = document.getElementById('progress-handle');
    
    if (playedBar) playedBar.style.width = percent + '%';
    if (handle) handle.style.left = percent + '%';
}

// Créer le contenu texte
function createTextContent(container) {
    const textContainer = document.createElement('div');
    textContainer.className = 'text-content';
    
    if (PlayerState.currentLesson.content) {
        textContainer.innerHTML = `
            <div class="text-content-wrapper">
                ${PlayerState.currentLesson.content}
            </div>
        `;
    } else {
        textContainer.innerHTML = '<p class="no-content">Aucun contenu disponible.</p>';
    }
    
    container.appendChild(textContainer);
    
    // Marquer comme lu après 5 secondes
    setTimeout(() => {
        PlayerState.lessonProgress = 100;
    }, 5000);
}

// Créer le contenu quiz
async function createQuizContent(container) {
    // À implémenter : système de quiz interactif
    container.innerHTML = `
        <div class="quiz-container">
            <h3>Quiz: ${PlayerState.currentLesson.title}</h3>
            <p>Fonctionnalité quiz en cours de développement</p>
        </div>
    `;
}

// Navigation entre les leçons
async function previousLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === PlayerState.currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex > 0) {
        const prevLessonId = lessons[currentIndex - 1].dataset.lessonId;
        await loadLesson(prevLessonId);
    }
}

async function nextLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === PlayerState.currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex < lessons.length - 1) {
        const nextLessonId = lessons[currentIndex + 1].dataset.lessonId;
        await loadLesson(nextLessonId);
    }
}

// Marquer la leçon comme complétée
async function completeCurrentLesson() {
    if (!PlayerState.currentLesson) return;
    
    try {
        const response = await window.electronAPI.db.updateLessonProgress(
            PlayerState.currentLesson.lesson_id,
            100,
            true
        );
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        PlayerState.currentLesson.completed = true;
        updatePlayerUI();
        
        // Mettre à jour l'UI
        const lessonEl = document.querySelector(`[data-lesson-id="${PlayerState.currentLesson.lesson_id}"]`);
        if (lessonEl) {
            lessonEl.classList.add('completed');
        }
        
        showPlayerSuccess('Leçon terminée !');
        
        // Passer à la suivante après 2 secondes
        setTimeout(() => {
            nextLesson();
        }, 2000);
        
    } catch (error) {
        console.error('[Player] Erreur lors de la complétion:', error);
        showPlayerError('Erreur lors de la sauvegarde');
    }
}

// Sauvegarder la progression
async function saveProgress() {
    if (!PlayerState.currentLesson) return;
    
    try {
        await window.electronAPI.db.updateLessonProgress(
            PlayerState.currentLesson.lesson_id,
            PlayerState.lessonProgress,
            PlayerState.lessonProgress >= 95
        );
    } catch (error) {
        console.error('[Player] Erreur lors de la sauvegarde:', error);
    }
}

// Suivi de progression
function startProgressTracking() {
    stopProgressTracking();
    
    PlayerState.saveProgressInterval = setInterval(() => {
        saveProgress();
    }, 10000); // Sauvegarder toutes les 10 secondes
}

function stopProgressTracking() {
    if (PlayerState.saveProgressInterval) {
        clearInterval(PlayerState.saveProgressInterval);
        PlayerState.saveProgressInterval = null;
    }
}

// Nettoyage
function cleanupCurrentLesson() {
    stopProgressTracking();
    
    if (PlayerState.videoPlayer) {
        PlayerState.videoPlayer.pause();
        PlayerState.videoPlayer.src = '';
        PlayerState.videoPlayer = null;
    }
    
    if (PlayerState.streamUrl) {
        // Le serveur de streaming nettoiera automatiquement après expiration
        PlayerState.streamUrl = null;
    }
}

// Sortir du lecteur
async function exitPlayer() {
    await saveProgress();
    cleanupCurrentLesson();
    
    // Retourner au dashboard
    if (window.showDashboard) {
        window.showDashboard();
    }
}

// UI Helpers
function updatePlayerUI() {
    const completeBtn = document.getElementById('complete-lesson');
    if (completeBtn) {
        if (PlayerState.currentLesson?.completed) {
            completeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Terminé';
            completeBtn.disabled = true;
        } else {
            completeBtn.textContent = 'Marquer comme terminé';
            completeBtn.disabled = false;
        }
    }
    
    // Mettre à jour le titre
    const titleEl = document.getElementById('lesson-title');
    if (titleEl && PlayerState.currentLesson) {
        titleEl.textContent = PlayerState.currentLesson.title;
    }
}

function markLessonActive(lessonId) {
    document.querySelectorAll('.lesson-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const lessonEl = document.querySelector(`[data-lesson-id="${lessonId}"]`);
    if (lessonEl) {
        lessonEl.classList.add('active');
    }
}

// Utilitaires
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Notifications
function showPlayerLoader(message) {
    // Implémenter le loader du player
}

function hidePlayerLoader() {
    // Masquer le loader
}

function showPlayerError(message) {
    // Afficher une erreur
}

function showPlayerSuccess(message) {
    // Afficher un succès
}

// Raccourcis clavier
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!PlayerState.videoPlayer) return;
        
        switch(e.key) {
            case ' ':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                skipBackward();
                break;
            case 'ArrowRight':
                skipForward();
                break;
            case 'ArrowUp':
                PlayerState.videoPlayer.volume = Math.min(1, PlayerState.videoPlayer.volume + 0.1);
                break;
            case 'ArrowDown':
                PlayerState.videoPlayer.volume = Math.max(0, PlayerState.videoPlayer.volume - 0.1);
                break;
            case 'f':
                toggleFullscreen();
                break;
            case 'm':
                toggleMute();
                break;
        }
    });
}

// Export global
window.loadLesson = loadLesson;
window.PlayerState = PlayerState;
