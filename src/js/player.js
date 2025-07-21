// player.js - Gestionnaire du lecteur de cours

// Variables globales pour le player
let currentLesson = null;
let lessonProgress = 0;
let videoPlayer = null;
let saveProgressInterval = null;

// Initialiser le player
document.addEventListener('DOMContentLoaded', () => {
    // Boutons de navigation
    document.getElementById('prev-lesson')?.addEventListener('click', previousLesson);
    document.getElementById('next-lesson')?.addEventListener('click', nextLesson);
    document.getElementById('complete-lesson')?.addEventListener('click', completeCurrentLesson);
    document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);
});

// Charger une leçon
async function loadLesson(lessonId) {
    try {
        showLoader('Chargement de la leçon...');
        
        // Sauvegarder la progression de la leçon précédente
        if (currentLesson) {
            await saveProgress();
        }
        
        // Nettoyer les intervalles
        if (saveProgressInterval) {
            clearInterval(saveProgressInterval);
            saveProgressInterval = null;
        }
        
        // Charger la nouvelle leçon
        const response = await window.electronAPI.db.getLesson(lessonId);
        if (!response.success) {
            throw new Error(response.error);
        }
        
        currentLesson = response.result;
        if (!currentLesson) {
            throw new Error('Leçon non trouvée');
        }
        
        // Réinitialiser la progression
        lessonProgress = currentLesson.progress || 0;
        
        // Mettre à jour l'interface
        updateLessonUI();
        
        // Charger le contenu
        await loadLessonContent();
        
        // Marquer la leçon comme active
        markLessonActive(lessonId);
        
        // Démarrer la sauvegarde automatique
        startAutoSave();
        
        hideLoader();
        
    } catch (error) {
        console.error('Erreur lors du chargement de la leçon:', error);
        hideLoader();
        showError('Impossible de charger la leçon');
    }
}

// Charger le contenu de la leçon
async function loadLessonContent() {
    const contentContainer = document.getElementById('lesson-content');
    contentContainer.innerHTML = '';
    
    try {
        // Charger les médias associés
        const mediaResponse = await window.electronAPI.db.getMediaByLesson(currentLesson.lesson_id);
        const mediaList = mediaResponse.success ? mediaResponse.result : [];
        
        // Créer le contenu selon le type
        switch (currentLesson.type) {
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
                createAssignmentContent(contentContainer);
                break;
            default:
                createGenericContent(contentContainer);
        }
        
        // Ajouter les documents supplémentaires
        if (mediaList.length > 0) {
            createResourcesList(contentContainer, mediaList);
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement du contenu:', error);
        contentContainer.innerHTML = '<div class="message message-error">Erreur lors du chargement du contenu</div>';
    }
}

// Créer le lecteur vidéo
async function createVideoPlayer(container, mediaList) {
    const videoMedia = mediaList.find(m => m.type === 'video');
    
    if (!videoMedia) {
        container.innerHTML = '<div class="message message-warning">Aucune vidéo disponible pour cette leçon</div>';
        return;
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    videoContainer.innerHTML = `
        <video id="lesson-video" class="video-player" controls>
            <source src="${escapeHtml(videoMedia.path)}" type="${videoMedia.mime_type || 'video/mp4'}">
            Votre navigateur ne supporte pas la lecture vidéo.
        </video>
        <div class="video-controls">
            <button class="btn btn-icon" onclick="playerManager.skipBackward()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11 16.07V7.93c0-.81-.91-1.28-1.58-.82l-5.77 4.07c-.56.4-.56 1.24 0 1.63l5.77 4.07c.67.47 1.58 0 1.58-.81zm1.66-3.25l5.77 4.07c.66.47 1.58-.01 1.58-.82V7.93c0-.81-.91-1.28-1.58-.82l-5.77 4.07c-.57.4-.57 1.24 0 1.64z"/>
                </svg>
            </button>
            <button class="btn btn-icon" id="play-pause-btn" onclick="playerManager.togglePlayPause()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </button>
            <button class="btn btn-icon" onclick="playerManager.skipForward()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.58 16.89l5.77-4.07c.56-.4.56-1.24 0-1.64L7.58 7.11C6.91 6.65 6 7.12 6 7.93v8.14c0 .81.91 1.28 1.58.82zM16 7v10c0 .55.45 1 1 1s1-.45 1-1V7c0-.55-.45-1-1-1s-1 .45-1 1z"/>
                </svg>
            </button>
            <select class="form-control" id="playback-rate" onchange="playerManager.changePlaybackRate(this.value)">
                <option value="0.5">0.5x</option>
                <option value="0.75">0.75x</option>
                <option value="1" selected>1x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
            </select>
            <span class="video-time">
                <span id="current-time">0:00</span> / <span id="duration">0:00</span>
            </span>
        </div>
    `;
    
    container.appendChild(videoContainer);
    
    // Initialiser le lecteur vidéo
    videoPlayer = document.getElementById('lesson-video');
    
    // Restaurer la position
    if (currentLesson.last_position > 0) {
        videoPlayer.currentTime = currentLesson.last_position;
    }
    
    // Événements vidéo
    videoPlayer.addEventListener('timeupdate', handleVideoProgress);
    videoPlayer.addEventListener('ended', handleVideoEnded);
    videoPlayer.addEventListener('loadedmetadata', updateVideoDuration);
    videoPlayer.addEventListener('play', updatePlayPauseButton);
    videoPlayer.addEventListener('pause', updatePlayPauseButton);
}

// Créer le contenu texte
function createTextContent(container) {
    const textContainer = document.createElement('div');
    textContainer.className = 'text-content';
    
    if (currentLesson.content) {
        textContainer.innerHTML = currentLesson.content;
    } else {
        textContainer.innerHTML = '<p>Aucun contenu disponible.</p>';
    }
    
    container.appendChild(textContainer);
    
    // Calculer la progression basée sur le scroll
    textContainer.addEventListener('scroll', throttle(() => {
        const scrollPercentage = (textContainer.scrollTop / 
            (textContainer.scrollHeight - textContainer.clientHeight)) * 100;
        lessonProgress = Math.min(Math.round(scrollPercentage), 100);
    }, 1000));
}

// Créer le contenu quiz
async function createQuizContent(container) {
    try {
        const response = await window.electronAPI.db.getQuiz(currentLesson.lesson_id);
        
        if (!response.success || !response.result || response.result.length === 0) {
            container.innerHTML = '<div class="message message-info">Aucun quiz disponible pour cette leçon</div>';
            return;
        }
        
        const quiz = response.result[0];
        
        const quizContainer = document.createElement('div');
        quizContainer.className = 'quiz-container';
        
        quizContainer.innerHTML = `
            <h3>${escapeHtml(quiz.title)}</h3>
            ${quiz.description ? `<p>${escapeHtml(quiz.description)}</p>` : ''}
            <div id="quiz-questions"></div>
            <button class="btn btn-primary" id="submit-quiz" onclick="playerManager.submitQuiz()">
                Soumettre le quiz
            </button>
            <div id="quiz-results" class="hidden"></div>
        `;
        
        container.appendChild(quizContainer);
        
        // Afficher les questions
        displayQuizQuestions(quiz.questions);
        
        // Stocker le quiz dans l'état
        window.currentQuiz = quiz;
        
    } catch (error) {
        console.error('Erreur lors du chargement du quiz:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement du quiz</div>';
    }
}

// Afficher les questions du quiz
function displayQuizQuestions(questions) {
    const container = document.getElementById('quiz-questions');
    container.innerHTML = '';
    
    questions.forEach((question, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'quiz-question';
        
        questionEl.innerHTML = `
            <h4>Question ${index + 1}: ${escapeHtml(question.question)}</h4>
            <div class="quiz-options">
                ${question.options.map((option, optionIndex) => `
                    <label class="radio-label">
                        <input type="radio" name="question-${index}" value="${optionIndex}">
                        <span>${escapeHtml(option)}</span>
                    </label>
                `).join('')}
            </div>
        `;
        
        container.appendChild(questionEl);
    });
}

// Créer le visualiseur PDF
async function createPDFViewer(container, mediaList) {
    const pdfMedia = mediaList.find(m => m.type === 'document' && m.mime_type === 'application/pdf');
    
    if (!pdfMedia) {
        container.innerHTML = '<div class="message message-warning">Aucun PDF disponible pour cette leçon</div>';
        return;
    }
    
    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'pdf-container';
    
    pdfContainer.innerHTML = `
        <iframe src="${escapeHtml(pdfMedia.path)}" 
                class="pdf-viewer" 
                width="100%" 
                height="600px">
        </iframe>
    `;
    
    container.appendChild(pdfContainer);
}

// Créer le contenu de devoir
function createAssignmentContent(container) {
    const assignmentContainer = document.createElement('div');
    assignmentContainer.className = 'assignment-container';
    
    assignmentContainer.innerHTML = `
        <h3>Devoir</h3>
        ${currentLesson.content || '<p>Instructions du devoir non disponibles.</p>'}
        <div class="assignment-submission">
            <h4>Soumettre votre travail</h4>
            <textarea class="form-control" rows="10" placeholder="Entrez votre réponse ici..."></textarea>
            <div class="file-upload">
                <input type="file" id="assignment-file" multiple>
                <label for="assignment-file" class="btn btn-secondary">
                    Joindre des fichiers
                </label>
            </div>
            <button class="btn btn-primary" onclick="playerManager.submitAssignment()">
                Soumettre le devoir
            </button>
        </div>
    `;
    
    container.appendChild(assignmentContainer);
}

// Créer le contenu générique
function createGenericContent(container) {
    const content = document.createElement('div');
    content.className = 'generic-content';
    
    content.innerHTML = currentLesson.content || 
        `<p>Type de leçon: ${currentLesson.type}</p>
         <p>Contenu non disponible.</p>`;
    
    container.appendChild(content);
}

// Créer la liste des ressources
function createResourcesList(container, mediaList) {
    if (mediaList.length === 0) return;
    
    const resourcesContainer = document.createElement('div');
    resourcesContainer.className = 'resources-container';
    
    resourcesContainer.innerHTML = `
        <h4>Ressources de la leçon</h4>
        <ul class="resources-list">
            ${mediaList.map(media => `
                <li>
                    <span class="resource-icon">${getFileIcon(media.filename)}</span>
                    <a href="#" onclick="playerManager.openResource('${media.media_id}'); return false;">
                        ${escapeHtml(media.original_filename || media.filename)}
                    </a>
                    <span class="resource-size">${formatFileSize(media.size || 0)}</span>
                </li>
            `).join('')}
        </ul>
    `;
    
    container.appendChild(resourcesContainer);
}

// Gérer la progression vidéo
function handleVideoProgress() {
    if (!videoPlayer || !videoPlayer.duration) return;
    
    const percentage = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    lessonProgress = Math.round(percentage);
    
    // Mettre à jour l'affichage du temps
    document.getElementById('current-time').textContent = formatDuration(videoPlayer.currentTime);
    
    // Sauvegarder la position
    currentLesson.last_position = Math.floor(videoPlayer.currentTime);
}

// Gérer la fin de la vidéo
function handleVideoEnded() {
    lessonProgress = 100;
    completeCurrentLesson();
}

// Mettre à jour la durée de la vidéo
function updateVideoDuration() {
    if (videoPlayer && videoPlayer.duration) {
        document.getElementById('duration').textContent = formatDuration(videoPlayer.duration);
    }
}

// Mettre à jour le bouton play/pause
function updatePlayPauseButton() {
    const btn = document.getElementById('play-pause-btn');
    if (!btn) return;
    
    const icon = btn.querySelector('svg path');
    if (videoPlayer && !videoPlayer.paused) {
        icon.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'); // Pause icon
    } else {
        icon.setAttribute('d', 'M8 5v14l11-7z'); // Play icon
    }
}

// Sauvegarder la progression
async function saveProgress() {
    if (!currentLesson) return;
    
    try {
        const response = await window.electronAPI.db.updateLessonProgress(
            currentLesson.lesson_id,
            lessonProgress,
            lessonProgress >= 95 // Considérer comme complété à 95%
        );
        
        if (!response.success) {
            console.error('Erreur lors de la sauvegarde:', response.error);
        } else {
            Logger.debug('Progression sauvegardée:', { lessonId: currentLesson.lesson_id, progress: lessonProgress });
        }
        
        // Synchroniser si nécessaire
        if (window.syncManager) {
            await window.syncManager.syncItem('lesson', currentLesson.lesson_id, {
                progress: lessonProgress,
                completed: lessonProgress >= 95
            });
        }
        
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la progression:', error);
    }
}

// Démarrer la sauvegarde automatique
function startAutoSave() {
    if (saveProgressInterval) {
        clearInterval(saveProgressInterval);
    }
    
    saveProgressInterval = setInterval(() => {
        saveProgress();
    }, 30000); // Sauvegarder toutes les 30 secondes
}

// Marquer la leçon comme complétée
async function completeCurrentLesson() {
    if (!currentLesson) return;
    
    try {
        lessonProgress = 100;
        const response = await window.electronAPI.db.updateLessonProgress(
            currentLesson.lesson_id, 
            100, 
            true
        );
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        currentLesson.completed = true;
        updateLessonUI();
        
        // Mettre à jour l'affichage dans la sidebar
        const lessonEl = document.querySelector(`[data-lesson-id="${currentLesson.lesson_id}"]`);
        if (lessonEl) {
            lessonEl.classList.add('completed');
            if (!lessonEl.querySelector('.lesson-check')) {
                const check = document.createElement('span');
                check.className = 'lesson-check';
                check.textContent = '✓';
                lessonEl.appendChild(check);
            }
        }
        
        showSuccess('Leçon marquée comme terminée !');
        
        // Passer automatiquement à la suivante après 2 secondes
        setTimeout(() => {
            nextLesson();
        }, 2000);
        
    } catch (error) {
        console.error('Erreur lors de la complétion de la leçon:', error);
        showError('Erreur lors de la sauvegarde');
    }
}

// Soumettre le quiz
async function submitQuiz() {
    if (!window.currentQuiz) return;
    
    const quiz = window.currentQuiz;
    const answers = [];
    
    quiz.questions.forEach((question, index) => {
        const selected = document.querySelector(`input[name="question-${index}"]:checked`);
        answers.push(selected ? parseInt(selected.value) : null);
    });
    
    // Vérifier que toutes les questions ont une réponse
    if (answers.includes(null)) {
        showWarning('Veuillez répondre à toutes les questions');
        return;
    }
    
    // Calculer le score
    let correctCount = 0;
    quiz.questions.forEach((question, index) => {
        if (answers[index] === question.correctAnswer) {
            correctCount++;
        }
    });
    
    const score = (correctCount / quiz.questions.length) * 100;
    
    // Sauvegarder la tentative
    try {
        const response = await window.electronAPI.db.saveQuizAttempt(quiz.quiz_id, answers, score);
        if (!response.success) {
            console.error('Erreur lors de la sauvegarde du quiz:', response.error);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du quiz:', error);
    }
    
    // Afficher les résultats
    const resultsEl = document.getElementById('quiz-results');
    resultsEl.innerHTML = `
        <h3>Résultats du quiz</h3>
        <div class="quiz-score ${score >= 70 ? 'success' : 'warning'}">
            <div class="score-number">${Math.round(score)}%</div>
            <div class="score-text">${correctCount}/${quiz.questions.length} réponses correctes</div>
        </div>
        ${score >= 70 ? 
            '<p class="success-message">Félicitations ! Vous avez réussi le quiz.</p>' : 
            '<p class="warning-message">Vous devriez revoir cette leçon et réessayer.</p>'
        }
    `;
    resultsEl.classList.remove('hidden');
    
    // Masquer le bouton de soumission
    document.getElementById('submit-quiz').style.display = 'none';
    
    // Marquer comme complété si score suffisant
    if (score >= 70) {
        lessonProgress = 100;
        await completeCurrentLesson();
    }
}

// Soumettre le devoir
async function submitAssignment() {
    showInfo('Fonctionnalité en cours de développement');
    // TODO: Implémenter la soumission de devoir
}

// Ouvrir une ressource
async function openResource(mediaId) {
    try {
        const response = await window.electronAPI.db.getMedia(mediaId);
        if (!response.success) {
            throw new Error(response.error);
        }
        
        const media = response.result;
        if (media && media.path) {
            await window.electronAPI.openExternal(`file://${media.path}`);
        }
    } catch (error) {
        console.error('Erreur lors de l\'ouverture de la ressource:', error);
        showError('Impossible d\'ouvrir la ressource');
    }
}

// Contrôles vidéo
function togglePlayPause() {
    if (videoPlayer) {
        if (videoPlayer.paused) {
            videoPlayer.play();
        } else {
            videoPlayer.pause();
        }
    }
}

function skipBackward() {
    if (videoPlayer) {
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
    }
}

function skipForward() {
    if (videoPlayer) {
        videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 10);
    }
}

function changePlaybackRate(rate) {
    if (videoPlayer) {
        videoPlayer.playbackRate = parseFloat(rate);
    }
}

// Basculer en plein écran
function toggleFullscreen() {
    const playerContainer = document.querySelector('.player-container');
    
    if (!document.fullscreenElement) {
        playerContainer.requestFullscreen().catch(err => {
            console.error('Erreur fullscreen:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// Naviguer vers la leçon précédente
function previousLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex > 0) {
        lessons[currentIndex - 1].click();
    } else {
        showInfo('Vous êtes à la première leçon');
    }
}

// Naviguer vers la leçon suivante
function nextLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex >= 0 && currentIndex < lessons.length - 1) {
        lessons[currentIndex + 1].click();
    } else {
        showInfo('Vous êtes à la dernière leçon');
    }
}

// Nettoyer lors du changement de page
function cleanup() {
    if (saveProgressInterval) {
        clearInterval(saveProgressInterval);
        saveProgressInterval = null;
    }
    
    if (currentLesson) {
        saveProgress();
    }
    
    if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer = null;
    }
    
    currentLesson = null;
    lessonProgress = 0;
}

// Export des fonctions
window.playerManager = {
    loadLesson,
    completeCurrentLesson,
    submitQuiz,
    submitAssignment,
    openResource,
    togglePlayPause,
    skipBackward,
    skipForward,
    changePlaybackRate,
    cleanup
};

// Export des variables globales nécessaires
window.currentLesson = currentLesson;
