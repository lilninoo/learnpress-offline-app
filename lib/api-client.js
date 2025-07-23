// lib/api-client.js - Client API corrigé et robuste
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const FormData = require('form-data');

class LearnPressAPIClient {
    constructor(apiUrl, deviceId) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.deviceId = deviceId;
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.refreshInProgress = false;
        this.requestQueue = [];
        
        // Configuration axios avec le bon namespace
        this.client = axios.create({
            baseURL: `${this.apiUrl}/wp-json/col-lms/v1`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Device-ID': this.deviceId,
                'User-Agent': 'LearnPress-Offline/1.0.0'
            },
            retries: 3,
            retryDelay: 1000,
            retryCondition: (error) => {
                return axios.isNetworkOrIdempotentRequestError(error) ||
                       error.response?.status >= 500;
            }
        });
        
        this.setupInterceptors();
        
        // Métriques de performance
        this.metrics = {
            requestCount: 0,
            errorCount: 0,
            avgResponseTime: 0
        };
    }
    
    setupInterceptors() {
        // Intercepteur de requête
        this.client.interceptors.request.use(
            config => {
                config.startTime = Date.now();
                this.metrics.requestCount++;
                
                if (this.token) {
                    config.headers['Authorization'] = `Bearer ${this.token}`;
                }
                
                console.log(`[API] ${config.method.toUpperCase()} ${config.url}`);
                return config;
            },
            error => {
                console.error('[API] Request error:', error);
                return Promise.reject(error);
            }
        );
        
        // Intercepteur de réponse avec gestion du refresh améliorée
        this.client.interceptors.response.use(
            response => {
                let responseTime = 0;
                if (response.config.startTime) {
                    responseTime = Date.now() - response.config.startTime;
                    this.updateMetrics(responseTime);
                }
                
                console.log(`[API] Response: ${response.status} (${responseTime}ms)`);
                return response;
            },
            async error => {
                const originalRequest = error.config;
                
                this.metrics.errorCount++;
                
                // Gestion du token expiré avec protection contre les boucles
                if (error.response?.status === 401 && 
                    !originalRequest._retry && 
                    this.refreshToken &&
                    !this.refreshInProgress) {
                    
                    originalRequest._retry = true;
                    
                    try {
                        console.log('[API] Token expiré, tentative de refresh...');
                        const result = await this.refreshAccessToken();
                        
                        if (result.success) {
                            originalRequest.headers['Authorization'] = `Bearer ${this.token}`;
                            this.processQueuedRequests();
                            return this.client(originalRequest);
                        }
                    } catch (refreshError) {
                        console.error('[API] Échec du refresh, déconnexion forcée');
                        this.forceLogout();
                        throw refreshError;
                    }
                } else if (error.response?.status === 401 && this.refreshInProgress) {
                    // Mettre en file d'attente pendant le refresh
                    return new Promise((resolve, reject) => {
                        this.requestQueue.push({ resolve, reject, originalRequest });
                    });
                }
                
                console.error(`[API] Error: ${error.response?.status || error.code} - ${error.message}`);
                return Promise.reject(this.normalizeError(error));
            }
        );
    }
    
    // Normaliser les erreurs pour un handling cohérent
    normalizeError(error) {
        if (error.response) {
            return {
                type: 'http_error',
                status: error.response.status,
                message: error.response.data?.message || error.response.statusText,
                code: error.response.data?.code,
                data: error.response.data
            };
        } else if (error.request) {
            return {
                type: 'network_error',
                message: 'Erreur de connexion réseau',
                code: error.code,
                originalError: error
            };
        } else {
            return {
                type: 'config_error',
                message: error.message,
                originalError: error
            };
        }
    }
    
    // Mettre à jour les métriques de performance
    updateMetrics(responseTime) {
        const count = this.metrics.requestCount;
        this.metrics.avgResponseTime = ((this.metrics.avgResponseTime * (count - 1)) + responseTime) / count;
    }
    
    // Traiter les requêtes en file d'attente après refresh
    processQueuedRequests() {
        while (this.requestQueue.length > 0) {
            const { resolve, reject, originalRequest } = this.requestQueue.shift();
            
            if (this.token) {
                originalRequest.headers['Authorization'] = `Bearer ${this.token}`;
                this.client(originalRequest).then(resolve).catch(reject);
            } else {
                reject(new Error('Token non disponible après refresh'));
            }
        }
    }
    
    // Authentification - VERSION AMÉLIORÉE
    async login(username, password) {
        try {
            console.log('[API] Début de l\'authentification...');
            
            const response = await this.client.post('/auth/login', {
                username,
                password,
                device_id: this.deviceId,
                app_version: '1.0.0'
            });
            
            const data = response.data;
            
            if (data.token) {
                this.token = data.token;
                this.refreshToken = data.refresh_token;
                this.userId = data.user.id;
                
                console.log('[API] Authentification réussie');
                
                return {
                    success: true,
                    user: {
                        id: data.user.id,
                        username: data.user.username,
                        email: data.user.email,
                        displayName: data.user.display_name || data.user.username,
                        avatar: data.user.avatar_url,
                        membership: data.user.membership || null,
                        roles: data.user.roles || [],
                        capabilities: data.user.capabilities || {},
                        profile: data.user.profile || {}
                    },
                    token: data.token,
                    expiresIn: data.expires_in || 3600
                };
            }
            
            throw new Error('Token non reçu du serveur');
            
        } catch (error) {
            console.error('[API] Erreur de connexion:', error);
            
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data || {};
                
                let errorMessage = data.message || 'Erreur de connexion';
                let errorCode = data.code;
                
                switch (status) {
                    case 400:
                        errorMessage = 'Données d\'authentification invalides';
                        break;
                    case 401:
                        errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
                        break;
                    case 403:
                        if (data.code === 'no_active_membership') {
                            errorMessage = 'Un abonnement actif est requis';
                            errorCode = 'no_active_membership';
                        } else {
                            errorMessage = 'Accès refusé';
                        }
                        break;
                    case 404:
                        errorMessage = 'API non trouvée. Vérifiez l\'URL du site et que le plugin est installé.';
                        break;
                    case 429:
                        errorMessage = 'Trop de tentatives de connexion. Veuillez patienter.';
                        break;
                    case 500:
                    case 502:
                    case 503:
                        errorMessage = 'Erreur du serveur. Réessayez plus tard.';
                        break;
                }
                
                return {
                    success: false,
                    error: errorMessage,
                    code: errorCode,
                    status: status,
                    requiresMembership: errorCode === 'no_active_membership'
                };
            }
            
            return {
                success: false,
                error: error.message || 'Erreur de connexion réseau',
                type: 'network_error'
            };
        }
    }
    
    // Vérifier l'abonnement
    async verifySubscription() {
        try {
            const response = await this.client.get('/auth/verify');
            
            const subscriptionData = {
                success: true,
                isActive: response.data.subscription?.is_active || false,
                subscription: response.data.subscription || null,
                user: response.data.user || null,
                features: response.data.features || {},
                limits: response.data.limits || {},
                expiresAt: response.data.subscription?.expires_at || null
            };
            
            // Cache local pour réduire les appels API
            this.lastSubscriptionCheck = Date.now();
            this.cachedSubscription = subscriptionData;
            
            return subscriptionData;
            
        } catch (error) {
            console.error('[API] Erreur de vérification d\'abonnement:', error);
            
            if (error.response?.status === 401 && 
                error.response?.data?.code === 'invalid_token') {
                
                console.log('[API] Refresh token invalide, nettoyage des tokens...');
                
                this.clearTokens();
                
                if (typeof window !== 'undefined' && window.electronAPI) {
                    window.electronAPI.emit('force-logout', { 
                        reason: 'refresh_token_expired',
                        message: 'Votre session a expiré. Veuillez vous reconnecter.'
                    });
                }
                
                return {
                    success: false,
                    isActive: false,
                    subscription: null,
                    reason: 'refresh_token_expired'
                };
            }
            
            // Utiliser le cache si disponible et récent (< 5 minutes)
            if (this.cachedSubscription && 
                Date.now() - this.lastSubscriptionCheck < 300000) {
                console.log('[API] Utilisation du cache pour l\'abonnement');
                return this.cachedSubscription;
            }
            
            if (error.response?.status === 401) {
                return {
                    success: true,
                    isActive: false,
                    subscription: null,
                    reason: 'unauthorized'
                };
            }
            
            return {
                success: false,
                error: error.message,
                isActive: false,
                type: error.type || 'unknown'
            };
        }
    }
    
    // Récupérer les cours - VERSION AMÉLIORÉE
    async getCourses(page = 1, perPage = 50, filters = {}) {
        try {
            const params = {
                page,
                per_page: perPage,
                ...filters
            };
            
            if (filters.category) params.category = filters.category;
            if (filters.difficulty) params.difficulty = filters.difficulty;
            if (filters.search) params.search = filters.search;
            if (filters.instructor) params.instructor = filters.instructor;
            if (filters.date_from) params.date_from = filters.date_from;
            if (filters.date_to) params.date_to = filters.date_to;
            
            const response = await this.client.get('/courses', { params });
            
            const courses = this.transformCourses(response.data.courses || []);
            
            return {
                success: true,
                courses: courses,
                total: response.data.total || 0,
                pages: response.data.pages || Math.ceil((response.data.total || 0) / perPage),
                currentPage: page,
                hasMore: response.data.has_more || false,
                categories: response.data.categories || [],
                instructors: response.data.instructors || [],
                filters: response.data.active_filters || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours:', error);
            return {
                success: false,
                error: error.message,
                courses: [],
                total: 0,
                pages: 0
            };
        }
    }
    
    // Récupérer les cours de l'utilisateur - VERSION CORRIGÉE
    async getUserCourses(filters = {}) {
        try {
            const params = {
                enrolled_only: true,
                page: filters.page || 1,
                per_page: filters.perPage || 50,
                include_progress: true,
                include_certificates: filters.includeCertificates || false,
                ...filters
            };
            
            console.log('[API] Récupération des cours utilisateur avec params:', params);
            
            const response = await this.client.get('/courses', { params });
            
            console.log('[API] Réponse brute:', response.data);
            
            // Gérer différents formats de réponse possibles
            let courses = [];
            
            // Format 1: { courses: [...] }
            if (response.data.courses && Array.isArray(response.data.courses)) {
                courses = response.data.courses;
            }
            // Format 2: Tableau direct
            else if (Array.isArray(response.data)) {
                courses = response.data;
            }
            // Format 3: { data: [...] }
            else if (response.data.data && Array.isArray(response.data.data)) {
                courses = response.data.data;
            }
            // Format 4: Objet avec items
            else if (response.data.items && Array.isArray(response.data.items)) {
                courses = response.data.items;
            }
            
            console.log('[API] Nombre de cours trouvés:', courses.length);
            
            // Transformer les cours pour uniformiser le format
            const transformedCourses = this.transformLearnPressCourses(courses);
            
            return {
                success: true,
                courses: transformedCourses,
                total: response.data.total || courses.length,
                pages: response.data.pages || Math.ceil((response.data.total || courses.length) / params.per_page),
                hasMore: response.data.has_more || false,
                stats: {
                    completed: transformedCourses.filter(c => c.completed).length,
                    inProgress: transformedCourses.filter(c => c.progress > 0 && !c.completed).length,
                    notStarted: transformedCourses.filter(c => c.progress === 0).length
                }
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours utilisateur:', error);
            
            if (error.response?.status === 404) {
                console.error('[API] Endpoint /courses non trouvé. Vérifiez que le plugin est installé.');
            }
            
            return {
                success: false,
                error: error.message,
                courses: [],
                total: 0
            };
        }
    }
    
    // Transformer les cours (ancienne méthode pour compatibilité)
    transformCourses(courses) {
        return this.transformLearnPressCourses(courses);
    }
    
    // Nouvelle méthode pour transformer les cours LearnPress
    transformLearnPressCourses(courses) {
        return courses.map(course => {
            // Gérer les différents formats possibles de LearnPress
            const courseId = course.id || course.ID || course.course_id;
            
            // Extraire les informations de l'instructeur
            let instructorName = 'Instructeur';
            let instructorId = null;
            
            if (course.instructor) {
                if (typeof course.instructor === 'string') {
                    instructorName = course.instructor;
                } else if (course.instructor.display_name) {
                    instructorName = course.instructor.display_name;
                    instructorId = course.instructor.id || course.instructor.ID;
                } else if (course.instructor.name) {
                    instructorName = course.instructor.name;
                    instructorId = course.instructor.id;
                }
            } else if (course.author) {
                instructorName = course.author.display_name || course.author.name || 'Instructeur';
                instructorId = course.author.id || course.author.ID;
            }
            
            // Calculer le nombre de leçons
            let lessonsCount = 0;
            let sectionsCount = 0;
            
            if (course.sections && Array.isArray(course.sections)) {
                sectionsCount = course.sections.length;
                course.sections.forEach(section => {
                    if (section.items) {
                        lessonsCount += section.items.length;
                    } else if (section.lessons) {
                        lessonsCount += section.lessons.length;
                    }
                });
            }
            
            // Si pas de sections mais un compteur direct
            if (lessonsCount === 0) {
                lessonsCount = course.count_items || course.total_lessons || course.lesson_count || 0;
            }
            
            // Gérer la progression
            let progress = 0;
            let completed = false;
            
            if (course.course_data) {
                progress = course.course_data.result?.percent || 0;
                completed = course.course_data.status === 'finished' || progress >= 100;
            } else if (course.progress !== undefined) {
                progress = course.progress;
                completed = course.completed || progress >= 100;
            }
            
            // Gérer la miniature
            let thumbnail = null;
            if (course.image) {
                thumbnail = course.image;
            } else if (course.thumbnail) {
                thumbnail = course.thumbnail;
            } else if (course.featured_image) {
                thumbnail = course.featured_image;
            } else if (course._embedded && course._embedded['wp:featuredmedia']) {
                thumbnail = course._embedded['wp:featuredmedia'][0]?.source_url;
            }
            
            return {
                id: courseId,
                course_id: courseId,
                title: course.title?.rendered || course.title || course.name || 'Sans titre',
                description: course.content?.rendered || course.description || course.excerpt?.rendered || '',
                excerpt: course.excerpt?.rendered || course.excerpt || '',
                thumbnail: thumbnail,
                instructor_name: instructorName,
                instructor_id: instructorId,
                instructor_avatar: course.instructor?.avatar_url,
                sections_count: sectionsCount,
                lessons_count: lessonsCount,
                students_count: course.students || course.count_students || 0,
                duration: course.duration || this.calculateDuration(course.sections),
                difficulty_level: course.level || 'intermediate',
                category: this.extractCategory(course),
                categories: course.categories || [],
                tags: course.tags || [],
                price: parseFloat(course.price || course.regular_price || 0),
                sale_price: parseFloat(course.sale_price || 0),
                currency: course.currency || 'EUR',
                enrolled: course.enrolled || course.is_enrolled || false,
                progress: progress,
                completed: completed,
                completion_date: course.completion_date,
                last_accessed: course.last_accessed,
                can_download: course.can_download !== false,
                updated_at: course.modified || course.updated_at || course.date_modified,
                created_at: course.date || course.created_at || course.date_created,
                rating: parseFloat(course.rating || course.average_rating || 0),
                review_count: course.rating_count || course.count_rating || 0,
                language: course.language || 'fr',
                requirements: course.requirements || [],
                what_will_learn: course.what_will_learn || [],
                sections: this.transformLearnPressSections(course.sections || course.curriculum?.sections || []),
                download_info: {
                    estimated_size: course.estimated_download_size || 0,
                    file_count: course.total_files || 0,
                    video_count: course.video_count || 0,
                    document_count: course.document_count || 0
                }
            };
        });
    }
    
    // Transformer les sections LearnPress
    transformLearnPressSections(sections) {
        if (!Array.isArray(sections)) return [];
        
        return sections.map((section, index) => ({
            id: section.id || section.ID || `section-${index}`,
            section_id: section.id || section.ID || `section-${index}`,
            title: section.title || section.name || `Section ${index + 1}`,
            description: section.description || '',
            order: section.order || index,
            lessons_count: section.items?.length || section.lessons?.length || 0,
            duration: section.duration || this.calculateSectionDuration(section.items || section.lessons),
            lessons: this.transformLearnPressLessons(section.items || section.lessons || [])
        }));
    }
    
    // Transformer les leçons LearnPress
    transformLearnPressLessons(lessons) {
        if (!Array.isArray(lessons)) return [];
        
        return lessons.map((lesson, index) => ({
            id: lesson.id || lesson.ID,
            lesson_id: lesson.id || lesson.ID,
            title: lesson.title || lesson.name || 'Sans titre',
            description: lesson.description || '',
            type: lesson.type || lesson.item_type || 'lp_lesson',
            duration: lesson.duration || 0,
            order: lesson.order || index,
            preview: lesson.preview || false,
            completed: lesson.status === 'completed' || lesson.completed || false,
            progress: lesson.progress || 0,
            locked: lesson.locked || false,
            content: lesson.content || '',
            video_url: lesson.video_sources?.[0]?.url || lesson.video || null,
            video_sources: lesson.video_sources || [],
            attachments: lesson.attachments || [],
            estimated_reading_time: lesson.estimated_reading_time || 0,
            difficulty: lesson.difficulty || 'normal',
            points: lesson.points || 0,
            quiz_questions: lesson.quiz_questions || 0
        }));
    }
    
    // Extraire la catégorie principale
    extractCategory(course) {
        if (course.categories && course.categories.length > 0) {
            return course.categories[0].name || course.categories[0].title || 'Non catégorisé';
        }
        if (course.category) {
            return course.category;
        }
        if (course.course_category && course.course_category.length > 0) {
            return course.course_category[0];
        }
        return 'Non catégorisé';
    }
    
    // Calculer la durée totale
    calculateDuration(sections) {
        if (!sections || !Array.isArray(sections)) return 'Durée inconnue';
        
        let totalMinutes = 0;
        sections.forEach(section => {
            if (section.lessons || section.items) {
                const lessons = section.lessons || section.items;
                lessons.forEach(lesson => {
                    if (lesson.duration) {
                        if (typeof lesson.duration === 'number') {
                            totalMinutes += lesson.duration;
                        } else if (typeof lesson.duration === 'string') {
                            const parts = lesson.duration.split(':');
                            if (parts.length === 2) {
                                totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
                            } else if (parts.length === 3) {
                                totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]) + parseInt(parts[2]) / 60;
                            }
                        }
                    }
                });
            }
        });
        
        if (totalMinutes === 0) return 'Durée inconnue';
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }
    
    // Calculer la durée d'une section
    calculateSectionDuration(lessons) {
        if (!lessons || !Array.isArray(lessons)) return 0;
        
        return lessons.reduce((total, lesson) => {
            if (lesson.duration && typeof lesson.duration === 'number') {
                return total + lesson.duration;
            }
            return total;
        }, 0);
    }
    
    // Récupérer les détails d'un cours
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`, {
                params: {
                    include_sections: true,
                    include_lessons: true,
                    include_media: true,
                    include_quiz: true,
                    include_assignments: true,
                    include_progress: true
                }
            });
            
            const courseData = response.data.course || response.data;
            const course = this.transformLearnPressCourses([courseData])[0];
            
            if (response.data.prerequisites) {
                course.prerequisites = response.data.prerequisites;
            }
            
            if (response.data.faq) {
                course.faq = response.data.faq;
            }
            
            if (response.data.announcements) {
                course.announcements = response.data.announcements;
            }
            
            return {
                success: true,
                course: course,
                access_info: response.data.access_info || {},
                download_permissions: response.data.download_permissions || {},
                expiration_info: response.data.expiration_info || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération du cours:', error);
            
            if (error.response?.status === 403) {
                return {
                    success: false,
                    error: 'Vous n\'avez pas accès à ce cours',
                    code: 'access_denied',
                    requiresEnrollment: true
                };
            }
            
            if (error.response?.status === 404) {
                return {
                    success: false,
                    error: 'Cours non trouvé',
                    code: 'course_not_found'
                };
            }
            
            return {
                success: false,
                error: error.message,
                type: error.type || 'unknown'
            };
        }
    }
    
    // Télécharger un fichier avec progress et resume
    async downloadFile(url, savePath, onProgress, options = {}) {
        try {
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            const {
                timeout = 300000,
                maxRetries = 3,
                chunkSize = 1024 * 1024,
                resumable = true
            } = options;
            
            // Support de la reprise de téléchargement
            let startByte = 0;
            if (resumable) {
                try {
                    const stats = await fs.stat(savePath);
                    startByte = stats.size;
                } catch (e) {
                    startByte = 0;
                }
            }
            
            const headers = {};
            if (this.token) {
                headers['Authorization'] = `Bearer ${this.token}`;
            }
            if (startByte > 0) {
                headers['Range'] = `bytes=${startByte}-`;
            }
            
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers,
                timeout,
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.lengthComputable) {
                        const total = progressEvent.total + startByte;
                        const loaded = progressEvent.loaded + startByte;
                        const percent = Math.round((loaded * 100) / total);
                        
                        onProgress({
                            percent: percent,
                            loaded: loaded,
                            total: total,
                            speed: this.calculateDownloadSpeed(loaded, progressEvent.timeStamp)
                        });
                    }
                }
            });
            
            // Écriture avec append pour la reprise
            const writer = require('fs').createWriteStream(savePath, { 
                flags: startByte > 0 ? 'a' : 'w' 
            });
            
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    resolve({
                        success: true,
                        path: savePath,
                        size: writer.bytesWritten + startByte,
                        resumed: startByte > 0
                    });
                });
                
                writer.on('error', (error) => {
                    // Retry automatique en cas d'erreur
                    if (options.retryCount < maxRetries) {
                        console.log(`[API] Retry téléchargement (${options.retryCount + 1}/${maxRetries})`);
                        setTimeout(() => {
                            this.downloadFile(url, savePath, onProgress, {
                                ...options,
                                retryCount: (options.retryCount || 0) + 1
                            }).then(resolve).catch(reject);
                        }, 2000 * Math.pow(2, options.retryCount || 0));
                    } else {
                        reject(error);
                    }
                });
            });
            
        } catch (error) {
            console.error('[API] Erreur lors du téléchargement:', error);
            throw error;
        }
    }
    
    // Calculer la vitesse de téléchargement
    calculateDownloadSpeed(loaded, timestamp) {
        if (!this.downloadStartTime) {
            this.downloadStartTime = timestamp;
            this.downloadStartBytes = 0;
        }
        
        const elapsedTime = (timestamp - this.downloadStartTime) / 1000;
        const bytesTransferred = loaded - this.downloadStartBytes;
        
        if (elapsedTime > 0) {
            return bytesTransferred / elapsedTime;
        }
        
        return 0;
    }
    
    // Synchroniser la progression
    async syncProgress(progressData) {
        try {
            const payload = {
                lessons: progressData.lessons || [],
                quizzes: progressData.quizzes || [],
                assignments: progressData.assignments || [],
                certificates: progressData.certificates || [],
                notes: progressData.notes || [],
                bookmarks: progressData.bookmarks || [],
                last_sync: progressData.lastSync,
                device_id: this.deviceId,
                sync_version: '2.0'
            };
            
            const response = await this.client.post('/progress/sync', payload);
            
            return {
                success: true,
                synced: response.data.synced_count || 0,
                conflicts: response.data.conflicts || [],
                serverTime: response.data.server_time,
                sync_id: response.data.sync_id,
                next_sync_recommended: response.data.next_sync_recommended,
                server_changes: response.data.server_changes || []
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la synchronisation:', error);
            return {
                success: false,
                error: error.message,
                type: error.type || 'sync_error',
                retryable: error.response?.status >= 500
            };
        }
    }
    
    // Récupérer les informations de média
    async getMediaInfo(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}/media`);
            
            return {
                success: true,
                media: response.data.media || [],
                total_size: response.data.total_size || 0,
                video_count: response.data.video_count || 0,
                document_count: response.data.document_count || 0,
                formats_available: response.data.formats_available || [],
                quality_options: response.data.quality_options || [],
                download_urls: response.data.download_urls || {}
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des médias:', error);
            return {
                success: false,
                error: error.message,
                media: []
            };
        }
    }
    
    // Télécharger un média spécifique
    async downloadMedia(mediaUrl, savePath, onProgress, options = {}) {
        return this.downloadFile(mediaUrl, savePath, onProgress, {
            ...options,
            resumable: true,
            maxRetries: 5
        });
    }
    
    // Déconnexion
    async logout() {
        try {
            if (this.token) {
                await this.client.post('/auth/logout', {
                    device_id: this.deviceId,
                    token: this.token
                });
            }
        } catch (error) {
            console.warn('[API] Erreur lors de la déconnexion côté serveur:', error);
        } finally {
            this.clearTokens();
        }
    }
    
    // Forcer la déconnexion
    forceLogout() {
        console.log('[API] Déconnexion forcée');
        this.clearTokens();
        
        if (typeof window !== 'undefined' && window.electronAPI) {
            window.electronAPI.emit('force-logout', { reason: 'invalid_token' });
        }
    }
    
    // Nettoyer les tokens
    clearTokens() {
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.refreshInProgress = false;
        this.requestQueue = [];
        this.cachedSubscription = null;
        this.lastSubscriptionCheck = null;
    }
    
    // Rafraîchir le token
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Pas de refresh token disponible');
        }
        
        if (this.refreshInProgress) {
            return new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (!this.refreshInProgress) {
                        clearInterval(checkInterval);
                        if (this.token) {
                            resolve({ success: true });
                        } else {
                            reject(new Error('Refresh token échoué'));
                        }
                    }
                }, 100);
            });
        }
        
        this.refreshInProgress = true;
        
        try {
            console.log('[API] Tentative de refresh token...');
            
            const response = await axios.post(`${this.apiUrl}/wp-json/col-lms/v1/auth/refresh`, {
                refresh_token: this.refreshToken,
                device_id: this.deviceId
            }, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                }
            });
            
            if (response.data.token) {
                this.token = response.data.token;
                
                if (response.data.refresh_token) {
                    this.refreshToken = response.data.refresh_token;
                }
                
                console.log('[API] Refresh token réussi');
                return { success: true, token: this.token };
            }
            
            throw new Error('Token non reçu lors du refresh');
            
        } catch (error) {
            console.error('[API] Erreur de rafraîchissement du token:', error);
            
            if (error.response?.status === 401) {
                this.forceLogout();
            }
            
            throw error;
        } finally {
            this.refreshInProgress = false;
        }
    }
    
    // Créer un package de téléchargement
    async createCoursePackage(courseId, options = {}) {
        try {
            const payload = {
                course_id: courseId,
                include_videos: options.includeVideos !== false,
                include_documents: options.includeDocuments !== false,
                include_quizzes: options.includeQuizzes !== false,
                include_assignments: options.includeAssignments !== false,
                video_quality: options.videoQuality || 'high',
                video_format: options.videoFormat || 'mp4',
                compress: options.compress || false,
                encryption_enabled: options.encryptionEnabled !== false,
                package_format: options.packageFormat || 'zip',
                include_metadata: options.includeMetadata !== false,
                include_thumbnails: options.includeThumbnails !== false
            };
            
            const response = await this.client.post(`/courses/${courseId}/package`, payload, {
                timeout: 120000
            });
            
            if (response.data.success) {
                return {
                    success: true,
                    packageUrl: response.data.package_url,
                    packageId: response.data.package_id,
                    files: response.data.files || [],
                    totalSize: response.data.total_size || 0,
                    estimatedTime: response.data.estimated_time || 0,
                    expiresAt: response.data.expires_at,
                    checksums: response.data.checksums || {},
                    metadata: response.data.metadata || {}
                };
            }
            
            throw new Error(response.data.message || 'Erreur lors de la création du package');
            
        } catch (error) {
            console.error('[API] Erreur lors de la création du package:', error);
            return {
                success: false,
                error: error.message,
                type: error.type || 'package_error',
                retryable: error.response?.status >= 500
            };
        }
    }
    
    // Vérifier le statut d'un package
    async getPackageStatus(packageId) {
        try {
            const response = await this.client.get(`/packages/${packageId}/status`);
            
            return {
                success: true,
                status: response.data.status,
                progress: response.data.progress || 0,
                message: response.data.message || '',
                downloadUrl: response.data.download_url,
                expiresAt: response.data.expires_at,
                estimatedTimeRemaining: response.data.estimated_time_remaining || 0
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la vérification du package:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Télécharger un cours complet
    async downloadCourse(courseId, downloadPath, onProgress, options = {}) {
        try {
            console.log(`[API] Début du téléchargement du cours ${courseId}`);
            
            onProgress && onProgress({ status: 'creating_package', progress: 0 });
            
            const packageResult = await this.createCoursePackage(courseId, options);
            if (!packageResult.success) {
                throw new Error(packageResult.error);
            }
            
            if (packageResult.packageId) {
                let packageReady = false;
                let attempts = 0;
                const maxAttempts = 60;
                
                while (!packageReady && attempts < maxAttempts) {
                    const statusResult = await this.getPackageStatus(packageResult.packageId);
                    
                    if (statusResult.success) {
                        if (statusResult.status === 'ready') {
                            packageReady = true;
                            packageResult.packageUrl = statusResult.downloadUrl;
                        } else if (statusResult.status === 'error') {
                            throw new Error(statusResult.message || 'Erreur lors de la préparation du package');
                        } else {
                            onProgress && onProgress({
                                status: 'preparing_package',
                                progress: statusResult.progress || 0,
                                message: statusResult.message
                            });
                        }
                    }
                    
                    if (!packageReady) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        attempts++;
                    }
                }
                
                if (!packageReady) {
                    throw new Error('Timeout lors de la préparation du package');
                }
            }
            
            onProgress && onProgress({ status: 'downloading', progress: 0 });
            
            const packagePath = path.join(downloadPath, `course-${courseId}.zip`);
            
            const downloadResult = await this.downloadFile(
                packageResult.packageUrl,
                packagePath,
                (progress) => {
                    onProgress && onProgress({
                        status: 'downloading',
                        progress: progress.percent,
                        loaded: progress.loaded,
                        total: progress.total,
                        speed: progress.speed
                    });
                },
                {
                    ...options,
                    resumable: true,
                    maxRetries: 3
                }
            );
            
            onProgress && onProgress({ status: 'completed', progress: 100 });
            
            return {
                success: true,
                packagePath: downloadResult.path,
                packageId: packageResult.packageId,
                size: downloadResult.size,
                files: packageResult.files,
                checksums: packageResult.checksums
            };
            
        } catch (error) {
            console.error('[API] Erreur lors du téléchargement du cours:', error);
            onProgress && onProgress({ status: 'error', error: error.message });
            
            return {
                success: false,
                error: error.message,
                type: error.type || 'download_error'
            };
        }
    }
    
    // Obtenir les métriques de performance
    getMetrics() {
        return {
            ...this.metrics,
            isConnected: !!this.token,
            lastRefresh: this.lastSubscriptionCheck,
            hasRefreshToken: !!this.refreshToken
        };
    }
    
    // Test de connectivité
    async testConnection() {
        try {
            const startTime = Date.now();
            
            const response = await axios.get(`${this.apiUrl}/wp-json/col-lms/v1/ping`, {
                timeout: 5000
            });
            
            const responseTime = Date.now() - startTime;
            
            return {
                success: true,
                responseTime,
                serverTime: response.data.server_time,
                version: response.data.version || '1.0.0',
                status: response.data.status || 'ok'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                type: error.type || 'connection_error'
            };
        }
    }
}

module.exports = LearnPressAPIClient;
