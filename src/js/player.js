// player.js - Gestionnaire du lecteur de cours

// Variables globales pour le player
let currentLesson = null;
let lessonProgress = 0;
let videoPlayer = null;
let saveProgressInterval = null;

// Charger une leçon
async function loadLesson(lessonId) {
    try {
        showLoader('Chargement de la leçon...');
        
        // Sauvegarder la progression de la leçon précédente
        if (currentLesson) {
            await saveProgress();
        }
        
        // Charger la nouvelle leçon
        const response = await window.electronAPI.db.getLesson(lessonId);
        if (!response.success) {
            throw new Error(response.error);
        }
        
        currentLesson = response.result;
        window.currentLesson = currentLesson; // Export global
        
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

// Charger le contenu de la leçon
async function loadLessonContent() {
    const contentContainer = document.getElementById('lesson-content');
    contentContainer.innerHTML = '';
    
    try {
        // Charger les médias associés
        const mediaResponse = await window.electronAPI.db.getMediaByLesson(currentLesson.lesson_id);
        const mediaList = mediaResponse.success ? mediaResponse.result : [];
        
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
    const videoMedia = mediaList.find(m => m.type === 'video');
    
    if (!videoMedia) {
        container.innerHTML = '<div class="message message-warning">Aucune vidéo disponible pour cette leçon</div>';
        return;
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    videoContainer.innerHTML = `
        <video id="lesson-video" class="video-player" controls>
            <source src="${videoMedia.path}" type="${videoMedia.mime_type || 'video/mp4'}">
            Votre navigateur ne supporte pas la lecture vidéo.
        </video>
        <div class="video-controls">
            <button class="btn btn-icon" onclick="skipBackward()">-10s</button>
            <button class="btn btn-icon" onclick="skipForward()">+10s</button>
            <select class="form-control" onchange="changePlaybackRate(this.value)">
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
    
    // Marquer comme lu après 5 secondes
    setTimeout(() => {
        lessonProgress = 100;
    }, 5000);
}

// Créer le contenu quiz
async function createQuizContent(container) {
    try {
        // Récupérer le quiz depuis la base de données
        const response = await window.electronAPI.db.getQuiz(currentLesson.lesson_id);
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        const quizzes = response.result;
        
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

// Afficher les questions du quiz
function displayQuizQuestions(questions) {
    const container = document.getElementById('quiz-questions');
    container.innerHTML = '';
    
    questions.forEach((question, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'quiz-question';
        
        questionEl.innerHTML = `
            <h4>Question ${index + 1}: ${question.question}</h4>
            <div class="quiz-options">
                ${question.options.map((option, optionIndex) => `
                    <label class="radio-label">
                        <input type="radio" name="question-${index}" value="${optionIndex}">
                        <span>${option}</span>
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
        <iframe src="${pdfMedia.path}" 
                class="pdf-viewer" 
                width="100%" 
                height="600px">
        </iframe>
    `;
    
    container.appendChild(pdfContainer);
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
                    <a href="#" onclick="openResource('${media.media_id}'); return false;">
                        ${media.original_filename || media.filename}
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

// Contrôles vidéo
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
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de la progression:', error);
    }
}

// Marquer la leçon comme complétée
async function completeCurrentLesson() {
    if (!currentLesson) return;
    
    try {
        const response = await window.electronAPI.db.updateLessonProgress(currentLesson.lesson_id, 100, true);
        
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

// Soumettre le quiz
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

// Navigation
function previousLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex > 0) {
        lessons[currentIndex - 1].click();
    }
}

function nextLesson() {
    const lessons = document.querySelectorAll('.lesson-item');
    const currentIndex = Array.from(lessons).findIndex(l => 
        l.dataset.lessonId === currentLesson?.lesson_id?.toString()
    );
    
    if (currentIndex < lessons.length - 1) {
        lessons[currentIndex + 1].click();
    }
}

// Fonctions UI helpers
function updateLessonUI() {
    const completeBtn = document.getElementById('complete-lesson');
    if (completeBtn) {
        if (currentLesson.completed) {
            completeBtn.textContent = 'Leçon terminée ✓';
            completeBtn.disabled = true;
        } else {
            completeBtn.textContent = 'Marquer comme terminé';
            completeBtn.disabled = false;
        }
    }
}

function markLessonActive(lessonId) {
    // Retirer la classe active de toutes les leçons
    document.querySelectorAll('.lesson-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Ajouter la classe active à la leçon sélectionnée
    const lessonEl = document.querySelector(`[data-lesson-id="${lessonId}"]`);
    if (lessonEl) {
        lessonEl.classList.add('active');
    }
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'mp4': '🎥', 'avi': '🎥', 'mov': '🎥',
        'pdf': '📕', 'doc': '📄', 'docx': '📄',
        'jpg': '🖼️', 'png': '🖼️',
        'mp3': '🎵',
        'zip': '📦'
    };
    
    return icons[ext] || '📎';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Événements des boutons
document.getElementById('prev-lesson')?.addEventListener('click', previousLesson);
document.getElementById('next-lesson')?.addEventListener('click', nextLesson);
document.getElementById('complete-lesson')?.addEventListener('click', completeCurrentLesson);
document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
    const playerContainer = document.querySelector('.player-container');
    if (playerContainer.requestFullscreen) {
        playerContainer.requestFullscreen();
    }
});

// Export global
window.loadLesson = loadLesson;
window.openResource = openResource;
window.currentLesson = currentLesson;
