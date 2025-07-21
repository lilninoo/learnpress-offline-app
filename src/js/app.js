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
