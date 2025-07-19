// player.js - Lecteur de contenu pour les cours

let currentLesson = null;
let currentMedia = null;
let videoPlayer = null;
let lessonProgress = 0;

// Initialiser le player
document.addEventListener('DOMContentLoaded', () => {
    initializePlayerControls();
});

// Initialiser les contrôles du player
function initializePlayerControls() {
    // Boutons de navigation
    document.getElementById('prev-lesson')?.addEventListener('click', previousLesson);
    document.getElementById('next-lesson')?.addEventListener('click', nextLesson);
    document.getElementById('complete-lesson')?.addEventListener('click', completeCurrentLesson);
    document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);
    
    // Contrôles vidéo personnalisés
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Charger une leçon
async function loadLesson(lessonId) {
    try {
        showLoader('Chargement de la leçon...');
        
        // Sauvegarder la progression de la leçon précédente
        if (currentLesson) {
            await saveProgress();
        }
        
        // Charger la nouvelle leçon
        currentLesson = await window.electronAPI.db.getLesson(lessonId);
        if (!currentLesson) {
            throw new Error('Leçon non trouvée');
        }
        
        // Mettre à jour l'interface
        updateLessonUI();
        
        // Charger le contenu
        await loadLessonContent();
        
        // Marquer la leçon comme active
        markLessonActive(lessonId);
        
        hideLoader();
    } catch (error) {
        console.error('Erreur lors du chargement de la leçon:', error);
        hideLoader();
        showError('Impossible de charger la leçon');
    }
}

// Mettre à jour l'interface de la leçon
function updateLessonUI() {
    document.getElementById('lesson-title').textContent = currentLesson.title;
    
    // Mettre à jour le bouton de complétion
    const completeBtn = document.getElementById('complete-lesson');
    if (currentLesson.completed) {
        completeBtn.textContent = 'Leçon terminée ✓';
        completeBtn.classList.add('btn-success');
    } else {
        completeBtn.textContent = 'Marquer comme terminé';
        completeBtn.classList.remove('btn-success');
    }
    
    // Restaurer la progression
    lessonProgress = currentLesson.progress || 0;
}

// Charger le contenu de la leçon
async function loadLessonContent() {
    const contentContainer = document.getElementById('lesson-content');
    contentContainer.innerHTML = '';
    
    try {
        // Charger les médias associés
        const mediaList = await window.electronAPI.db.getMediaByLesson(currentLesson.lesson_id);
        
        // Créer le contenu selon le type
        if (currentLesson.type === 'video') {
            await createVideoPlayer(contentContainer, mediaList);
        } else if (currentLesson.type === 'text' || currentLesson.type === 'article') {
            createTextContent(contentContainer);
        } else if (currentLesson.type === 'quiz') {
            await createQuizContent(contentContainer);
        } else if (currentLesson.type === 'pdf') {
            await createPDFViewer(contentContainer, mediaList);
        } else {
            // Type générique
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
    const videoFile = mediaList.find(m => m.type === 'video');
    
    if (!videoFile) {
        container.innerHTML = '<div class="message message-warning">Aucune vidéo disponible pour cette leçon</div>';
        return;
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    videoContainer.innerHTML = `
        <video id="lesson-video" class="video-player" controls>
            <source src="${videoFile.path}" type="video/mp4">
            Votre navigateur ne supporte pas la lecture vidéo.
        </video>
        <div class="video-controls">
            <button class="btn btn-icon" onclick="rewind()">⏪ 10s</button>
            <button class="btn btn-icon" onclick="playPause()">⏯️</button>
            <button class="btn btn-icon" onclick="forward()">⏩ 10s</button>
            <button class="btn btn-icon" onclick="changeSpeed()">⚡</button>
            <span class="video-time">
                <span id="current-time">0:00</span> / <span id="duration">0:00</span>
            </span>
        </div>
    `;
    
    container.appendChild(videoContainer);
    
    // Initialiser le lecteur vidéo
    videoPlayer = document.getElementById('lesson-video');
    
    // Restaurer la position
    if (lessonProgress > 0) {
        videoPlayer.currentTime = (lessonProgress / 100) * videoPlayer.duration;
    }
    
    // Événements vidéo
    videoPlayer.addEventListener('timeupdate', updateVideoProgress);
    videoPlayer.addEventListener('loadedmetadata', updateVideoDuration);
    videoPlayer.addEventListener('ended', onVideoEnded);
    
    // Afficher le contenu textuel si disponible
    if (currentLesson.content) {
        const textContent = document.createElement('div');
        textContent.className = 'lesson-text-content';
        textContent.innerHTML = currentLesson.content;
        container.appendChild(textContent);
    }
}

// Créer le contenu textuel
function createTextContent(container) {
    const textContainer = document.createElement('div');
    textContainer.className = 'text-content';
    
    if (currentLesson.content) {
        textContainer.innerHTML = currentLesson.content;
    } else {
        textContainer.innerHTML = '<p>Aucun contenu disponible</p>';
    }
    
    container.appendChild(textContainer);
    
    // Suivre la progression de lecture
    trackReadingProgress(textContainer);
}

// Créer le contenu quiz
async function createQuizContent(container) {
    try {
        // Récupérer le quiz depuis la base de données
        const quizzes = await window.electronAPI.db.getQuiz(currentLesson.lesson_id);
        
        if (!quizzes || quizzes.length === 0) {
            container.innerHTML = '<div class="message message-info">Aucun quiz disponible pour cette leçon</div>';
            return;
        }
        
        const quiz = quizzes[0]; // Prendre le premier quiz
        
        const quizContainer = document.createElement('div');
        quizContainer.className = 'quiz-container';
        
        quizContainer.innerHTML = `
            <h3>Quiz: ${currentLesson.title}</h3>
            <div id="quiz-questions"></div>
            <button class="btn btn-primary" id="submit-quiz">Soumettre le quiz</button>
            <div id="quiz-results" class="hidden"></div>
        `;
        
        container.appendChild(quizContainer);
        
        // Afficher les questions
        displayQuizQuestions(quiz.questions);
        
        // Gérer la soumission
        document.getElementById('submit-quiz').addEventListener('click', () => submitQuiz(quiz));
        
    } catch (error) {
        console.error('Erreur lors du chargement du quiz:', error);
        container.innerHTML = '<div class="message message-error">Erreur lors du chargement du quiz</div>';
    }
}

// Créer le visualiseur PDF
async function createPDFViewer(container, mediaList) {
    const pdfFile = mediaList.find(m => m.type === 'document' && m.filename.endsWith('.pdf'));
    
    if (!pdfFile) {
        container.innerHTML = '<div class="message message-warning">Aucun PDF disponible pour cette leçon</div>';
        return;
    }
    
    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'pdf-container';
    
    // Option simple : iframe
    pdfContainer.innerHTML = `
        <iframe src="${pdfFile.path}" class="pdf-viewer">
            <p>Votre navigateur ne peut pas afficher ce PDF. 
               <a href="${pdfFile.path}" download>Télécharger le PDF</a>
            </p>
        </iframe>
    `;
    
    container.appendChild(pdfContainer);
}

// Créer le contenu générique
function createGenericContent(container) {
    const content = document.createElement('div');
    content.className = 'generic-content';
    
    if (currentLesson.content) {
        content.innerHTML = currentLesson.content;
    } else {
        content.innerHTML = `
            <div class="message message-info">
                <h3>${currentLesson.title}</h3>
                <p>Type de leçon : ${currentLesson.type}</p>
            </div>
        `;
    }
    
    container.appendChild(content);
}

// Créer la liste des ressources
function createResourcesList(container, mediaList) {
    if (mediaList.length === 0) return;
    
    const resourcesContainer = document.createElement('div');
    resourcesContainer.className = 'lesson-resources';
    
    resourcesContainer.innerHTML = '<h4>Ressources de la leçon</h4>';
    
    const resourcesList = document.createElement('ul');
    resourcesList.className = 'resources-list';
    
    mediaList.forEach(media => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="resource-icon">${getMediaIcon(media.type)}</span>
            <a href="#" onclick="openResource('${media.media_id}')">${media.filename}</a>
            <span class="resource-size">${formatFileSize(media.size)}</span>
        `;
        resourcesList.appendChild(li);
    });
    
    resourcesContainer.appendChild(resourcesList);
    container.appendChild(resourcesContainer);
}

// Fonctions de contrôle vidéo
function updateVideoProgress() {
    if (!videoPlayer) return;
    
    const progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    lessonProgress = Math.round(progress);
    
    // Sauvegarder périodiquement
    if (lessonProgress % 5 === 0) {
        saveProgress();
    }
    
    // Mettre à jour l'affichage du temps
    document.getElementById('current-time').textContent = formatTime(videoPlayer.currentTime);
}

function updateVideoDuration() {
    if (!videoPlayer) return;
    document.getElementById('duration').textContent = formatTime(videoPlayer.duration);
}

function onVideoEnded() {
    lessonProgress = 100;
    completeCurrentLesson();
}

window.playPause = function() {
    if (!videoPlayer) return;
    
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
};

window.rewind = function() {
    if (!videoPlayer) return;
    videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
};

window.forward = function() {
    if (!videoPlayer) return;
    videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 10);
};

window.changeSpeed = function() {
    if (!videoPlayer) return;
    
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentSpeed = videoPlayer.playbackRate;
    const currentIndex = speeds.indexOf(currentSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    
    videoPlayer.playbackRate = speeds[nextIndex];
    showInfo(`Vitesse: ${speeds[nextIndex]}x`);
};

// Suivre la progression de lecture du texte
function trackReadingProgress(container) {
    let scrollTimer;
    
    container.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            const scrollPercentage = (container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100;
            lessonProgress = Math.round(scrollPercentage);
            saveProgress();
        }, 1000);
    });
}

// Sauvegarder la progression
async function saveProgress() {
    if (!currentLesson) return;
    
    try {
        await window.electronAPI.db.updateLessonProgress(
            currentLesson.lesson_id,
            lessonProgress,
            lessonProgress >= 95 // Considérer comme complété à 95%
        );
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la progression:', error);
    }
}

// Marquer la leçon comme complétée
async function completeCurrentLesson() {
    if (!currentLesson) return;
    
    try {
        await window.electronAPI.db.updateLessonProgress(currentLesson.lesson_id, 100, true);
        
        currentLesson.completed = true;
        updateLessonUI();
        
        // Mettre à jour l'affichage dans la sidebar
        const lessonEl = document.querySelector(`[data-lesson-id="${currentLesson.lesson_id}"]`);
        if (lessonEl) {
            lessonEl.classList.add('completed');
            if (!lessonEl.querySelector('.lesson-check')) {
                lessonEl.innerHTML += '<span class="lesson-check">✓</span>';
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

// Navigation entre les leçons
function previousLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson.lesson_id.toString()
    );
    
    if (currentIndex > 0) {
        lessons[currentIndex - 1].click();
    } else {
        showInfo('Vous êtes à la première leçon');
    }
}

function nextLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson.lesson_id.toString()
    );
    
    if (currentIndex < lessons.length - 1) {
        lessons[currentIndex + 1].click();
    } else {
        showInfo('Vous avez terminé toutes les leçons !');
    }
}

// Marquer visuellement la leçon active
function markLessonActive(lessonId) {
    document.querySelectorAll('.lesson-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeLesson = document.querySelector(`[data-lesson-id="${lessonId}"]`);
    if (activeLesson) {
        activeLesson.classList.add('active');
        activeLesson.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Basculer en plein écran
function toggleFullscreen() {
    const playerContainer = document.getElementById('player-page');
    
    if (!document.fullscreenElement) {
        playerContainer.requestFullscreen().catch(err => {
            console.error('Erreur fullscreen:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// Raccourcis clavier
function handleKeyboardShortcuts(e) {
    if (AppState.currentPage !== 'player') return;
    
    switch(e.key) {
        case ' ':
            e.preventDefault();
            if (videoPlayer) playPause();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            if (videoPlayer) rewind();
            break;
        case 'ArrowRight':
            e.preventDefault();
            if (videoPlayer) forward();
            break;
        case 'ArrowUp':
            e.preventDefault();
            previousLesson();
            break;
        case 'ArrowDown':
            e.preventDefault();
            nextLesson();
            break;
        case 'f':
            e.preventDefault();
            toggleFullscreen();
            break;
        case 'c':
            e.preventDefault();
            completeCurrentLesson();
            break;
    }
}

// Ouvrir une ressource
window.openResource = async function(mediaId) {
    try {
        const media = await window.electronAPI.db.getMedia(mediaId);
        if (media && media.path) {
            await window.electronAPI.openExternal(`file://${media.path}`);
        }
    } catch (error) {
        console.error('Erreur lors de l\'ouverture de la ressource:', error);
        showError('Impossible d\'ouvrir la ressource');
    }
};

// Quiz functions
function displayQuizQuestions(questions) {
    const container = document.getElementById('quiz-questions');
    container.innerHTML = '';
    
    questions.forEach((question, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'quiz-question';
        
        questionEl.innerHTML = `
            <h4>Question ${index + 1}: ${question.text}</h4>
            <div class="quiz-options">
                ${question.options.map((option, optIndex) => `
                    <label class="quiz-option">
                        <input type="radio" name="question-${index}" value="${optIndex}">
                        <span>${option}</span>
                    </label>
                `).join('')}
            </div>
        `;
        
        container.appendChild(questionEl);
    });
}

async function submitQuiz(quiz) {
    const answers = [];
    
    quiz.questions.forEach((question, index) => {
        const selected = document.querySelector(`input[name="question-${index}"]:checked`);
        answers.push(selected ? parseInt(selected.value) : null);
    });
    
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
        await window.electronAPI.db.saveQuizAttempt(quiz.quiz_id, answers, score);
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du quiz:', error);
    }
    
    // Afficher les résultats
    const resultsEl = document.getElementById('quiz-results');
    resultsEl.innerHTML = `
        <h3>Résultats</h3>
        <p>Score : ${score.toFixed(0)}% (${correctCount}/${quiz.questions.length})</p>
        ${score >= 70 ? 
            '<p class="success">Félicitations ! Vous avez réussi le quiz.</p>' : 
            '<p class="warning">Vous devriez revoir cette leçon.</p>'
        }
    `;
    resultsEl.classList.remove('hidden');
    
    // Marquer comme complété si score suffisant
    if (score >= 70) {
        lessonProgress = 100;
        completeCurrentLesson();
    }
}

// Utilitaires
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function getMediaIcon(type) {
    const icons = {
        'video': '🎥',
        'document': '📄',
        'pdf': '📕',
        'image': '🖼️',
        'audio': '🎵',
        'archive': '📦'
    };
    return icons[type] || '📎';
}

// Export pour utilisation globale
window.loadLesson = loadLesson;
