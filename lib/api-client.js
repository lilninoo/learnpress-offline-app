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
        this.refreshInProgress = false; // AJOUTÉ : Éviter les refreshs multiples
        this.requestQueue = []; // AJOUTÉ : File d'attente pendant le refresh
        
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
            // NOUVEAU : Configuration de retry
            retries: 3,
            retryDelay: 1000,
            retryCondition: (error) => {
                return axios.isNetworkOrIdempotentRequestError(error) ||
                       error.response?.status >= 500;
            }
        });
        
        this.setupInterceptors();
        
        // NOUVEAU : Métriques de performance
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
                // NOUVEAU : Métriques
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
                // NOUVEAU : Calcul du temps de réponse
                let responseTime = 0; // Déclaration en dehors du bloc if
                if (response.config.startTime) {
                    responseTime = Date.now() - response.config.startTime;
                    this.updateMetrics(responseTime);
                }
                
                console.log(`[API] Response: ${response.status} (${responseTime}ms)`);
                return response;
            },
            async error => {
                const originalRequest = error.config;
                
                // NOUVEAU : Métriques d'erreur
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
                            
                            // NOUVEAU : Rejouer les requêtes en file d'attente
                            this.processQueuedRequests();
                            
                            return this.client(originalRequest);
                        }
                    } catch (refreshError) {
                        console.error('[API] Échec du refresh, déconnexion forcée');
                        this.forceLogout();
                        throw refreshError;
                    }
                } else if (error.response?.status === 401 && this.refreshInProgress) {
                    // NOUVEAU : Mettre en file d'attente pendant le refresh
                    return new Promise((resolve, reject) => {
                        this.requestQueue.push({ resolve, reject, originalRequest });
                    });
                }
                
                console.error(`[API] Error: ${error.response?.status || error.code} - ${error.message}`);
                return Promise.reject(this.normalizeError(error));
            }
        );
    }
    
    // NOUVEAU : Normaliser les erreurs pour un handling cohérent
    normalizeError(error) {
        if (error.response) {
            // Erreur de réponse HTTP
            return {
                type: 'http_error',
                status: error.response.status,
                message: error.response.data?.message || error.response.statusText,
                code: error.response.data?.code,
                data: error.response.data
            };
        } else if (error.request) {
            // Erreur réseau
            return {
                type: 'network_error',
                message: 'Erreur de connexion réseau',
                code: error.code,
                originalError: error
            };
        } else {
            // Erreur de configuration
            return {
                type: 'config_error',
                message: error.message,
                originalError: error
            };
        }
    }
    
    // NOUVEAU : Mettre à jour les métriques de performance
    updateMetrics(responseTime) {
        const count = this.metrics.requestCount;
        this.metrics.avgResponseTime = ((this.metrics.avgResponseTime * (count - 1)) + responseTime) / count;
    }
    
    // NOUVEAU : Traiter les requêtes en file d'attente après refresh
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
                app_version: '1.0.0' // NOUVEAU
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
                        // NOUVEAU : Informations supplémentaires
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
            
            // Gestion détaillée des erreurs d'authentification
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
            
            // Erreur réseau ou autre
            return {
                success: false,
                error: error.message || 'Erreur de connexion réseau',
                type: 'network_error'
            };
        }
    }
    
    // Modification dans lib/api-client.js - méthode verifySubscription

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
        
        // Si erreur 401 et refresh token invalide, forcer une nouvelle connexion
        if (error.response?.status === 401 && 
            error.response?.data?.code === 'invalid_token') {
            
            console.log('[API] Refresh token invalide, nettoyage des tokens...');
            
            // Nettoyer les tokens invalides
            this.clearTokens();
            
            // Notifier l'interface pour retourner à la page de login
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
        
        // Si erreur 401 normale, l'abonnement n'est pas actif
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
            
            // NOUVEAU : Support des filtres avancés
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
                // NOUVEAU : Métadonnées supplémentaires
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
    
    // NOUVELLE MÉTHODE : Récupérer les cours de l'utilisateur avec pagination
    async getUserCourses(filters = {}) {
        try {
            const params = {
                enrolled_only: true,
                page: filters.page || 1,
                per_page: filters.perPage || 50,
                include_progress: true, // NOUVEAU
                include_certificates: filters.includeCertificates || false,
                ...filters
            };
            
            const response = await this.client.get('/courses', { params });
            
            const courses = this.transformCourses(response.data.courses || []);
            
            return {
                success: true,
                courses: courses,
                total: response.data.total || 0,
                pages: response.data.pages || 1,
                hasMore: response.data.has_more || false,
                // NOUVEAU : Statistiques utilisateur
                stats: {
                    completed: courses.filter(c => c.completed).length,
                    inProgress: courses.filter(c => c.progress > 0 && !c.completed).length,
                    notStarted: courses.filter(c => c.progress === 0).length
                }
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours utilisateur:', error);
            return {
                success: false,
                error: error.message,
                courses: [],
                total: 0
            };
        }
    }
    
    // Transformer les données des cours - VERSION ENRICHIE
    transformCourses(courses) {
        return courses.map(course => {
            const transformedCourse = {
                id: course.id,
                course_id: course.id, // Pour la compatibilité
                title: course.name || course.title,
                description: course.description || '',
                excerpt: course.excerpt || '',
                thumbnail: course.image || course.thumbnail,
                instructor_name: course.instructor?.display_name || course.instructor?.name || 'Instructeur',
                instructor_id: course.instructor?.id,
                instructor_avatar: course.instructor?.avatar_url, // NOUVEAU
                sections_count: course.sections?.length || course.section_count || 0,
                lessons_count: course.total_lessons || course.lesson_count || 0,
                students_count: course.students_count || 0, // NOUVEAU
                duration: course.duration || this.calculateDuration(course.sections),
                difficulty_level: course.level || 'intermediate',
                category: course.categories?.[0]?.name || 'Non catégorisé',
                categories: course.categories || [], // NOUVEAU : Toutes les catégories
                tags: course.tags || [],
                price: parseFloat(course.price || 0),
                currency: course.currency || 'EUR',
                enrolled: course.enrolled || false,
                progress: course.progress || 0,
                completed: course.completed || false,
                completion_date: course.completion_date, // NOUVEAU
                last_accessed: course.last_accessed, // NOUVEAU
                can_download: course.can_download !== false,
                updated_at: course.modified || course.updated_at,
                created_at: course.date_created || course.created_at,
                // NOUVEAU : Informations supplémentaires
                rating: course.rating || 0,
                review_count: course.review_count || 0,
                language: course.language || 'fr',
                requirements: course.requirements || [],
                what_will_learn: course.what_will_learn || [],
                sections: this.transformSections(course.sections || []),
                // NOUVEAU : Métadonnées de téléchargement
                download_info: {
                    estimated_size: course.estimated_download_size || 0,
                    file_count: course.total_files || 0,
                    video_count: course.video_count || 0,
                    document_count: course.document_count || 0
                }
            };
            
            return transformedCourse;
        });
    }
    
    // NOUVELLE MÉTHODE : Transformer les sections avec plus de détails
    transformSections(sections) {
        return sections.map((section, index) => ({
            id: section.id,
            section_id: section.id,
            title: section.title || section.name,
            description: section.description || '',
            order: section.order || index,
            lessons_count: section.lessons?.length || section.lesson_count || 0,
            duration: section.duration || this.calculateSectionDuration(section.lessons),
            lessons: this.transformLessons(section.lessons || [])
        }));
    }
    
    // NOUVELLE MÉTHODE : Transformer les leçons avec métadonnées complètes
    transformLessons(lessons) {
        return lessons.map((lesson, index) => ({
            id: lesson.id,
            lesson_id: lesson.id,
            title: lesson.title || lesson.name,
            description: lesson.description || '',
            type: lesson.type || 'video',
            duration: lesson.duration || 0,
            order: lesson.order || index,
            preview: lesson.preview || false,
            completed: lesson.completed || false,
            progress: lesson.progress || 0,
            content: lesson.content || '',
            // NOUVEAU : Informations sur les médias
            video_url: lesson.video_sources?.[0]?.url,
            video_sources: lesson.video_sources || [],
            attachments: lesson.attachments || [],
            // NOUVEAU : Métadonnées supplémentaires
            estimated_reading_time: lesson.estimated_reading_time || 0,
            difficulty: lesson.difficulty || 'normal',
            points: lesson.points || 0,
            quiz_questions: lesson.quiz_questions || 0
        }));
    }
    
    // Calculer la durée totale - AMÉLIORÉ
    calculateDuration(sections) {
        if (!sections || !Array.isArray(sections)) return 'Durée inconnue';
        
        let totalMinutes = 0;
        sections.forEach(section => {
            if (section.lessons) {
                section.lessons.forEach(lesson => {
                    if (lesson.duration) {
                        // Support de différents formats de durée
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
    
    // NOUVELLE MÉTHODE : Calculer la durée d'une section
    calculateSectionDuration(lessons) {
        if (!lessons || !Array.isArray(lessons)) return 0;
        
        return lessons.reduce((total, lesson) => {
            if (lesson.duration && typeof lesson.duration === 'number') {
                return total + lesson.duration;
            }
            return total;
        }, 0);
    }
    
    // Récupérer les détails d'un cours - VERSION ENRICHIE
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`, {
                params: {
                    include_sections: true,
                    include_lessons: true,
                    include_media: true,
                    include_quiz: true, // NOUVEAU
                    include_assignments: true, // NOUVEAU
                    include_progress: true // NOUVEAU
                }
            });
            
            const courseData = response.data.course || response.data;
            const course = this.transformCourses([courseData])[0];
            
            // NOUVEAU : Enrichir avec des données supplémentaires
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
                // NOUVEAU : Métadonnées supplémentaires
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
    
    // NOUVELLE MÉTHODE : Télécharger un fichier avec progress et resume
    async downloadFile(url, savePath, onProgress, options = {}) {
        try {
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            const {
                timeout = 300000, // 5 minutes
                maxRetries = 3,
                chunkSize = 1024 * 1024, // 1MB
                resumable = true
            } = options;
            
            // NOUVEAU : Support de la reprise de téléchargement
            let startByte = 0;
            if (resumable) {
                try {
                    const stats = await fs.stat(savePath);
                    startByte = stats.size;
                } catch (e) {
                    // Fichier n'existe pas, commencer du début
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
            
            // NOUVEAU : Écriture avec append pour la reprise
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
                    // NOUVEAU : Retry automatique en cas d'erreur
                    if (options.retryCount < maxRetries) {
                        console.log(`[API] Retry téléchargement (${options.retryCount + 1}/${maxRetries})`);
                        setTimeout(() => {
                            this.downloadFile(url, savePath, onProgress, {
                                ...options,
                                retryCount: (options.retryCount || 0) + 1
                            }).then(resolve).catch(reject);
                        }, 2000 * Math.pow(2, options.retryCount || 0)); // Exponential backoff
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
    
    // NOUVELLE MÉTHODE : Calculer la vitesse de téléchargement
    calculateDownloadSpeed(loaded, timestamp) {
        if (!this.downloadStartTime) {
            this.downloadStartTime = timestamp;
            this.downloadStartBytes = 0;
        }
        
        const elapsedTime = (timestamp - this.downloadStartTime) / 1000; // secondes
        const bytesTransferred = loaded - this.downloadStartBytes;
        
        if (elapsedTime > 0) {
            return bytesTransferred / elapsedTime; // bytes/sec
        }
        
        return 0;
    }
    
    // Synchroniser la progression - VERSION AMÉLIORÉE
    async syncProgress(progressData) {
        try {
            const payload = {
                lessons: progressData.lessons || [],
                quizzes: progressData.quizzes || [],
                assignments: progressData.assignments || [], // NOUVEAU
                certificates: progressData.certificates || [], // NOUVEAU
                notes: progressData.notes || [], // NOUVEAU
                bookmarks: progressData.bookmarks || [], // NOUVEAU
                last_sync: progressData.lastSync,
                device_id: this.deviceId,
                sync_version: '2.0' // NOUVEAU : Versioning du sync
            };
            
            const response = await this.client.post('/progress/sync', payload);
            
            return {
                success: true,
                synced: response.data.synced_count || 0,
                conflicts: response.data.conflicts || [],
                serverTime: response.data.server_time,
                // NOUVEAU : Informations détaillées du sync
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
                retryable: error.response?.status >= 500 // NOUVEAU : Indication si retry possible
            };
        }
    }
    
    // NOUVELLE MÉTHODE : Récupérer les informations de média
    async getMediaInfo(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}/media`);
            
            return {
                success: true,
                media: response.data.media || [],
                total_size: response.data.total_size || 0,
                video_count: response.data.video_count || 0,
                document_count: response.data.document_count || 0,
                // NOUVEAU : Informations détaillées
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
    
    // NOUVELLE MÉTHODE : Télécharger un média spécifique
    async downloadMedia(mediaUrl, savePath, onProgress, options = {}) {
        return this.downloadFile(mediaUrl, savePath, onProgress, {
            ...options,
            resumable: true,
            maxRetries: 5 // Plus de retries pour les médias
        });
    }
    
    // Déconnexion - VERSION AMÉLIORÉE
    async logout() {
        try {
            if (this.token) {
                await this.client.post('/auth/logout', {
                    device_id: this.deviceId,
                    token: this.token // NOUVEAU : Envoyer le token pour invalidation
                });
            }
        } catch (error) {
            console.warn('[API] Erreur lors de la déconnexion côté serveur:', error);
        } finally {
            this.clearTokens();
        }
    }
    
    // NOUVELLE MÉTHODE : Forcer la déconnexion (en cas d'erreur)
    forceLogout() {
        console.log('[API] Déconnexion forcée');
        this.clearTokens();
        
        // NOUVEAU : Notifier l'application de la déconnexion forcée
        if (typeof window !== 'undefined' && window.electronAPI) {
            window.electronAPI.emit('force-logout', { reason: 'invalid_token' });
        }
    }
    
    // NOUVELLE MÉTHODE : Nettoyer les tokens
    clearTokens() {
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.refreshInProgress = false;
        this.requestQueue = [];
        this.cachedSubscription = null;
        this.lastSubscriptionCheck = null;
    }
    
    // Rafraîchir le token - VERSION SÉCURISÉE
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Pas de refresh token disponible');
        }
        
        if (this.refreshInProgress) {
            // Attendre que le refresh en cours se termine
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
                timeout: 15000, // Timeout plus court pour le refresh
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-ID': this.deviceId
                }
            });
            
            if (response.data.token) {
                this.token = response.data.token;
                
                // NOUVEAU : Nouveau refresh token si fourni
                if (response.data.refresh_token) {
                    this.refreshToken = response.data.refresh_token;
                }
                
                console.log('[API] Refresh token réussi');
                return { success: true, token: this.token };
            }
            
            throw new Error('Token non reçu lors du refresh');
            
        } catch (error) {
            console.error('[API] Erreur de rafraîchissement du token:', error);
            
            // NOUVEAU : Si le refresh token est invalide, forcer la déconnexion
            if (error.response?.status === 401) {
                this.forceLogout();
            }
            
            throw error;
        } finally {
            this.refreshInProgress = false;
        }
    }
    
    // NOUVELLE MÉTHODE : Créer un package de téléchargement avec options avancées
    async createCoursePackage(courseId, options = {}) {
        try {
            const payload = {
                course_id: courseId,
                include_videos: options.includeVideos !== false,
                include_documents: options.includeDocuments !== false,
                include_quizzes: options.includeQuizzes !== false, // NOUVEAU
                include_assignments: options.includeAssignments !== false, // NOUVEAU
                video_quality: options.videoQuality || 'high',
                video_format: options.videoFormat || 'mp4', // NOUVEAU
                compress: options.compress || false,
                encryption_enabled: options.encryptionEnabled !== false, // NOUVEAU
                // NOUVEAU : Options de packaging
                package_format: options.packageFormat || 'zip',
                include_metadata: options.includeMetadata !== false,
                include_thumbnails: options.includeThumbnails !== false
            };
            
            const response = await this.client.post(`/courses/${courseId}/package`, payload, {
                timeout: 120000 // 2 minutes pour la création du package
            });
            
            if (response.data.success) {
                return {
                    success: true,
                    packageUrl: response.data.package_url,
                    packageId: response.data.package_id,
                    files: response.data.files || [],
                    totalSize: response.data.total_size || 0,
                    estimatedTime: response.data.estimated_time || 0, // NOUVEAU
                    expiresAt: response.data.expires_at,
                    checksums: response.data.checksums || {}, // NOUVEAU : Vérification d'intégrité
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
    
    // NOUVELLE MÉTHODE : Vérifier le statut d'un package
    async getPackageStatus(packageId) {
        try {
            const response = await this.client.get(`/packages/${packageId}/status`);
            
            return {
                success: true,
                status: response.data.status, // 'pending', 'processing', 'ready', 'expired', 'error'
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
    
    // NOUVELLE MÉTHODE : Télécharger un cours complet avec gestion avancée
    async downloadCourse(courseId, downloadPath, onProgress, options = {}) {
        try {
            console.log(`[API] Début du téléchargement du cours ${courseId}`);
            
            // 1. Créer le package
            onProgress && onProgress({ status: 'creating_package', progress: 0 });
            
            const packageResult = await this.createCoursePackage(courseId, options);
            if (!packageResult.success) {
                throw new Error(packageResult.error);
            }
            
            // 2. Attendre que le package soit prêt (si nécessaire)
            if (packageResult.packageId) {
                let packageReady = false;
                let attempts = 0;
                const maxAttempts = 60; // 5 minutes max
                
                while (!packageReady && attempts < maxAttempts) {
                    const statusResult = await this.getPackageStatus(packageResult.packageId);
                    
                    if (statusResult.success) {
                        if (statusResult.status === 'ready') {
                            packageReady = true;
                            packageResult.packageUrl = statusResult.downloadUrl;
                        } else if (statusResult.status === 'error') {
                            throw new Error(statusResult.message || 'Erreur lors de la préparation du package');
                        } else {
                            // En cours de traitement
                            onProgress && onProgress({
                                status: 'preparing_package',
                                progress: statusResult.progress || 0,
                                message: statusResult.message
                            });
                        }
                    }
                    
                    if (!packageReady) {
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Attendre 5 secondes
                        attempts++;
                    }
                }
                
                if (!packageReady) {
                    throw new Error('Timeout lors de la préparation du package');
                }
            }
            
            // 3. Télécharger le package
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
    
    // NOUVELLE MÉTHODE : Obtenir les métriques de performance
    getMetrics() {
        return {
            ...this.metrics,
            isConnected: !!this.token,
            lastRefresh: this.lastSubscriptionCheck,
            hasRefreshToken: !!this.refreshToken
        };
    }
    
    // NOUVELLE MÉTHODE : Test de connectivité
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


    // NOUVELLE MÉTHODE : Télécharger un fichier avec progress et resume
    async downloadFile(url, savePath, onProgress, options = {}) {
        try {
            const path = require('path');
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            const {
                timeout = 300000, // 5 minutes
                maxRetries = 3,
                chunkSize = 1024 * 1024, // 1MB
                resumable = true
            } = options;
            
            // NOUVEAU : Support de la reprise de téléchargement
            let startByte = 0;
            if (resumable) {
                try {
                    const stats = await fs.stat(savePath);
                    startByte = stats.size;
                } catch (e) {
                    // Fichier n'existe pas, commencer du début
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
            
            // NOUVEAU : Écriture avec append pour la reprise
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
                    // NOUVEAU : Retry automatique en cas d'erreur
                    if (options.retryCount < maxRetries) {
                        console.log(`[API] Retry téléchargement (${options.retryCount + 1}/${maxRetries})`);
                        setTimeout(() => {
                            this.downloadFile(url, savePath, onProgress, {
                                ...options,
                                retryCount: (options.retryCount || 0) + 1
                            }).then(resolve).catch(reject);
                        }, 2000 * Math.pow(2, options.retryCount || 0)); // Exponential backoff
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
}

module.exports = LearnPressAPIClient;
