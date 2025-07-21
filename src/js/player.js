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

// Ouvrir une ressource
window.openResource = async function(mediaId) {
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
};

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
