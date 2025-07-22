// api-client.js - Client API corrigé pour LearnPress
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
        
        // Configuration axios avec le bon namespace
        this.client = axios.create({
            baseURL: `${this.apiUrl}/wp-json/col-lp/v1`, // Namespace corrigé
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Device-ID': this.deviceId
            }
        });
        
        this.setupInterceptors();
    }
    
    setupInterceptors() {
        // Intercepteur pour ajouter le token
        this.client.interceptors.request.use(
            config => {
                if (this.token) {
                    config.headers['Authorization'] = `Bearer ${this.token}`;
                }
                console.log(`[API] ${config.method.toUpperCase()} ${config.url}`);
                return config;
            },
            error => Promise.reject(error)
        );
        
        // Intercepteur pour gérer les erreurs et le refresh token
        this.client.interceptors.response.use(
            response => {
                console.log(`[API] Response:`, response.status);
                return response;
            },
            async error => {
                const originalRequest = error.config;
                
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    
                    try {
                        const result = await this.refreshAccessToken();
                        if (result.success) {
                            originalRequest.headers['Authorization'] = `Bearer ${this.token}`;
                            return this.client(originalRequest);
                        }
                    } catch (refreshError) {
                        this.logout();
                        throw refreshError;
                    }
                }
                
                console.error(`[API] Error:`, error.response?.status, error.message);
                return Promise.reject(error);
            }
        );
    }
    
    // Authentification corrigée
    async login(username, password) {
        try {
            const response = await this.client.post('/auth/login', {
                username,
                password,
                device_id: this.deviceId
            });
            
            const data = response.data;
            
            if (data.token) {
                this.token = data.token;
                this.refreshToken = data.refresh_token;
                this.userId = data.user.id;
                
                return {
                    success: true,
                    user: {
                        ...data.user,
                        displayName: data.user.display_name || data.user.username,
                        avatar: data.user.avatar_url
                    },
                    membership: data.user.membership || null
                };
            }
            
            return {
                success: false,
                error: 'Token non reçu'
            };
            
        } catch (error) {
            console.error('[API] Erreur de connexion:', error);
            
            if (error.response) {
                const message = error.response.data?.message || error.response.statusText;
                const code = error.response.data?.code;
                
                if (code === 'no_active_membership') {
                    return {
                        success: false,
                        error: 'Vous devez avoir un abonnement actif pour utiliser l\'application',
                        requiresMembership: true
                    };
                }
                
                return {
                    success: false,
                    error: message
                };
            }
            
            return {
                success: false,
                error: error.message || 'Erreur de connexion'
            };
        }
    }
    
    // Récupérer les cours de l'utilisateur
    async getUserCourses(filters = {}) {
        try {
            const params = {
                enrolled_only: true, // Seulement les cours inscrits
                page: filters.page || 1,
                per_page: filters.perPage || 50,
                ...filters
            };
            
            const response = await this.client.get('/courses', { params });
            
            return {
                success: true,
                courses: this.transformCourses(response.data.courses || []),
                total: response.data.total || 0,
                pages: response.data.pages || 1,
                hasMore: response.data.has_more || false
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération des cours:', error);
            return {
                success: false,
                error: error.message,
                courses: []
            };
        }
    }
    
    // Transformer les données des cours
    transformCourses(courses) {
        return courses.map(course => ({
            id: course.id,
            title: course.name || course.title,
            description: course.description,
            thumbnail: course.image || course.thumbnail,
            instructor: {
                id: course.instructor?.id,
                name: course.instructor?.display_name || course.instructor?.name || 'Instructeur',
                avatar: course.instructor?.avatar
            },
            sections_count: course.sections?.length || course.section_count || 0,
            lessons_count: course.total_lessons || course.lesson_count || 0,
            duration: course.duration || this.calculateDuration(course.sections),
            difficulty: course.level || 'intermediate',
            category: course.categories?.[0]?.name || 'Non catégorisé',
            tags: course.tags || [],
            price: parseFloat(course.price || 0),
            currency: course.currency || 'EUR',
            enrolled: course.enrolled || false,
            progress: course.progress || 0,
            completed: course.completed || false,
            can_download: course.can_download !== false,
            updated_at: course.modified || course.updated_at,
            sections: course.sections || []
        }));
    }
    
    // Calculer la durée totale d'un cours
    calculateDuration(sections) {
        if (!sections || !Array.isArray(sections)) return 'Durée inconnue';
        
        let totalMinutes = 0;
        sections.forEach(section => {
            if (section.lessons) {
                section.lessons.forEach(lesson => {
                    if (lesson.duration) {
                        const parts = lesson.duration.split(':');
                        if (parts.length === 2) {
                            totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        }
                    }
                });
            }
        });
        
        if (totalMinutes === 0) return 'Durée inconnue';
        
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    
    // Récupérer les détails complets d'un cours
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`);
            const course = this.transformCourses([response.data.course])[0];
            
            // Enrichir avec les sections et leçons
            if (response.data.course.sections) {
                course.sections = response.data.course.sections.map(section => ({
                    id: section.id,
                    title: section.title,
                    description: section.description,
                    order: section.order || 0,
                    lessons: section.lessons?.map(lesson => ({
                        id: lesson.id,
                        title: lesson.title,
                        type: lesson.type || 'video',
                        duration: lesson.duration,
                        preview: lesson.preview || false,
                        completed: lesson.completed || false,
                        content: lesson.content,
                        video_url: lesson.video_sources?.[0]?.url,
                        attachments: lesson.attachments || []
                    })) || []
                }));
            }
            
            return {
                success: true,
                course
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération du cours:', error);
            
            if (error.response?.status === 403) {
                return {
                    success: false,
                    error: 'Vous n\'avez pas accès à ce cours',
                    requiresEnrollment: true
                };
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Créer un package de téléchargement pour un cours
    async createCoursePackage(courseId, options = {}) {
        try {
            const response = await this.client.post(`/courses/${courseId}/download`, {
                include_videos: options.includeVideos !== false,
                include_documents: options.includeDocuments !== false,
                video_quality: options.videoQuality || 'high',
                compress: options.compress || false
            });
            
            if (response.data.success) {
                return {
                    success: true,
                    packageUrl: response.data.package_url,
                    files: response.data.files || [],
                    totalSize: response.data.total_size || 0,
                    expiresAt: response.data.expires_at
                };
            }
            
            throw new Error(response.data.message || 'Erreur lors de la création du package');
            
        } catch (error) {
            console.error('[API] Erreur lors de la création du package:', error);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }
    
    // Télécharger un fichier avec progression
    async downloadFile(url, savePath, onProgress) {
        try {
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            const writer = require('fs').createWriteStream(savePath);
            
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.lengthComputable) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress({
                            percent: percentCompleted,
                            loaded: progressEvent.loaded,
                            total: progressEvent.total
                        });
                    }
                }
            });
            
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    resolve({
                        success: true,
                        path: savePath,
                        size: writer.bytesWritten
                    });
                });
                writer.on('error', reject);
            });
            
        } catch (error) {
            console.error('[API] Erreur lors du téléchargement:', error);
            throw error;
        }
    }
    
    // Synchroniser la progression
    async syncProgress(progressData) {
        try {
            const response = await this.client.post('/progress/sync', {
                lessons: progressData.lessons || [],
                quizzes: progressData.quizzes || [],
                last_sync: progressData.lastSync
            });
            
            return {
                success: true,
                synced: response.data.synced_count || 0,
                conflicts: response.data.conflicts || [],
                serverTime: response.data.server_time
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la synchronisation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Récupérer la progression d'un cours
    async getCourseProgress(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}/progress`);
            
            return {
                success: true,
                progress: {
                    completed_lessons: response.data.completed_lessons || [],
                    total_lessons: response.data.total_lessons || 0,
                    percentage: response.data.percentage || 0,
                    last_lesson_id: response.data.last_lesson_id,
                    quiz_scores: response.data.quiz_scores || {}
                }
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la récupération de la progression:', error);
            return {
                success: false,
                error: error.message,
                progress: null
            };
        }
    }
    
    // Marquer une leçon comme complétée
    async completeLesson(lessonId, data = {}) {
        try {
            const response = await this.client.post(`/lessons/${lessonId}/complete`, {
                progress: data.progress || 100,
                time_spent: data.timeSpent || 0,
                completed_at: new Date().toISOString()
            });
            
            return {
                success: true,
                points_earned: response.data.points_earned || 0
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la complétion de la leçon:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Soumettre un quiz
    async submitQuiz(quizId, answers) {
        try {
            const response = await this.client.post(`/quizzes/${quizId}/submit`, {
                answers,
                submitted_at: new Date().toISOString()
            });
            
            return {
                success: true,
                score: response.data.score,
                passed: response.data.passed,
                correct_answers: response.data.correct_answers,
                certificate_url: response.data.certificate_url
            };
            
        } catch (error) {
            console.error('[API] Erreur lors de la soumission du quiz:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Déconnexion
    async logout() {
        try {
            await this.client.post('/auth/logout', {
                device_id: this.deviceId
            });
        } catch (error) {
            console.warn('[API] Erreur lors de la déconnexion:', error);
        }
        
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
    }
    
    // Rafraîchir le token
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Pas de refresh token disponible');
        }
        
        try {
            const response = await this.client.post('/auth/refresh', {
                refresh_token: this.refreshToken,
                device_id: this.deviceId
            });
            
            if (response.data.token) {
                this.token = response.data.token;
                if (response.data.refresh_token) {
                    this.refreshToken = response.data.refresh_token;
                }
                return { success: true };
            }
            
            throw new Error('Token non reçu');
            
        } catch (error) {
            console.error('[API] Erreur de rafraîchissement du token:', error);
            throw error;
        }
    }
}

module.exports = LearnPressAPIClient;
