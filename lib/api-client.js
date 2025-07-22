// lib/api-client.js - Client API corrigé et complet
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
            baseURL: `${this.apiUrl}/wp-json/col-lms/v1`,
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
        
        // Intercepteur pour gérer les erreurs
        this.client.interceptors.response.use(
            response => {
                console.log(`[API] Response:`, response.status);
                return response;
            },
            async error => {
                const originalRequest = error.config;
                
                if (error.response?.status === 401 && !originalRequest._retry && this.refreshToken) {
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
    
    // Authentification
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
                        id: data.user.id,
                        username: data.user.username,
                        email: data.user.email,
                        displayName: data.user.display_name || data.user.username,
                        avatar: data.user.avatar_url,
                        membership: data.user.membership || null
                    }
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
                
                return {
                    success: false,
                    error: message,
                    code: code,
                    requiresMembership: code === 'no_active_membership'
                };
            }
            
            return {
                success: false,
                error: error.message || 'Erreur de connexion'
            };
        }
    }
    
    // AJOUT DE LA MÉTHODE MANQUANTE : Vérifier l'abonnement
    async verifySubscription() {
        try {
            const response = await this.client.get('/auth/verify');
            
            return {
                success: true,
                isActive: response.data.subscription?.is_active || false,
                subscription: response.data.subscription || null
            };
            
        } catch (error) {
            console.error('[API] Erreur de vérification d\'abonnement:', error);
            
            // Si erreur 401, l'abonnement n'est pas actif
            if (error.response?.status === 401) {
                return {
                    success: true,
                    isActive: false,
                    subscription: null
                };
            }
            
            return {
                success: false,
                error: error.message,
                isActive: false
            };
        }
    }
    
    // Récupérer les cours (corrigé)
    async getCourses(page = 1, perPage = 50) {
        try {
            const response = await this.client.get('/courses', {
                params: {
                    page,
                    per_page: perPage
                }
            });
            
            return {
                success: true,
                courses: this.transformCourses(response.data.courses || []),
                total: response.data.total || 0,
                pages: response.data.pages || 1
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
    
    // Récupérer les cours de l'utilisateur (méthode corrigée)
    async getUserCourses(filters = {}) {
        try {
            const params = {
                enrolled_only: true,
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
            course_id: course.id, // Pour la compatibilité
            title: course.name || course.title,
            description: course.description,
            thumbnail: course.image || course.thumbnail,
            instructor_name: course.instructor?.display_name || course.instructor?.name || 'Instructeur',
            instructor_id: course.instructor?.id,
            sections_count: course.sections?.length || course.section_count || 0,
            lessons_count: course.total_lessons || course.lesson_count || 0,
            duration: course.duration || this.calculateDuration(course.sections),
            difficulty_level: course.level || 'intermediate',
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
    
    // Calculer la durée totale
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
    
    // Récupérer les détails d'un cours
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`);
            const course = this.transformCourses([response.data.course || response.data])[0];
            
            // Enrichir avec les sections et leçons
            if (response.data.course?.sections || response.data.sections) {
                const sections = response.data.course?.sections || response.data.sections;
                course.sections = sections.map(section => ({
                    id: section.id,
                    section_id: section.id,
                    title: section.title,
                    description: section.description,
                    order: section.order || 0,
                    lessons: section.lessons?.map(lesson => ({
                        id: lesson.id,
                        lesson_id: lesson.id,
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
    
    // Télécharger un fichier
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
    
    // Créer un package de téléchargement
    async createCoursePackage(courseId, options = {}) {
        try {
            const response = await this.client.post(`/courses/${courseId}/package`, {
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
    
    // Télécharger un cours complet
    async downloadCourse(courseId, downloadPath, onProgress) {
        try {
            // 1. Créer le package
            const packageResult = await this.createCoursePackage(courseId);
            if (!packageResult.success) {
                throw new Error(packageResult.error);
            }
            
            // 2. Télécharger le package
            const packagePath = path.join(downloadPath, 'package.zip');
            await this.downloadFile(packageResult.packageUrl, packagePath, onProgress);
            
            return {
                success: true,
                packagePath,
                packageId: packageResult.packageId
            };
            
        } catch (error) {
            console.error('[API] Erreur lors du téléchargement du cours:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = LearnPressAPIClient;
