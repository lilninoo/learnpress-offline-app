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
        this.userSubscription = null;
        
        // Configuration axios
        this.client = axios.create({
            baseURL: `${this.apiUrl}/wp-json/col-lms/v1`, // Namespace correct
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
        // Request interceptor
        this.client.interceptors.request.use(
            config => {
                if (this.token) {
                    config.headers['Authorization'] = `Bearer ${this.token}`;
                }
                
                // Log des requêtes en mode debug
                if (process.env.DEBUG_MODE) {
                    console.log(`[API] ${config.method.toUpperCase()} ${config.url}`);
                }
                
                return config;
            },
            error => Promise.reject(error)
        );
        
        // Response interceptor
        this.client.interceptors.response.use(
            response => response,
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
                        // Token refresh failed
                        this.logout();
                        throw refreshError;
                    }
                }
                
                return Promise.reject(error);
            }
        );
    }
    
    // ==================== AUTHENTIFICATION ====================
    
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
                this.userSubscription = data.user.membership;
                
                return {
                    success: true,
                    user: data.user,
                    membership: data.user.membership,
                    enrolledCourses: data.user.enrolled_courses || []
                };
            }
            
            return {
                success: false,
                error: 'Token non reçu'
            };
            
        } catch (error) {
            console.error('Erreur de connexion:', error);
            return this.handleError(error);
        }
    }
    
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
            console.error('Erreur de rafraîchissement du token:', error);
            throw error;
        }
    }
    
    async verifySubscription() {
        try {
            const response = await this.client.get('/auth/verify');
            
            this.userSubscription = response.data.subscription;
            
            return {
                success: true,
                isActive: response.data.is_active,
                subscription: response.data.subscription,
                canDownload: response.data.subscription?.can_download || false,
                expiresAt: response.data.subscription?.expires_at
            };
            
        } catch (error) {
            console.error('Erreur de vérification de l\'abonnement:', error);
            return {
                success: false,
                isActive: false,
                error: error.message
            };
        }
    }
    
    async logout() {
        try {
            await this.client.post('/auth/logout', {
                device_id: this.deviceId 
            });
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
        }
        
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        this.userSubscription = null;
    }
    
    // ==================== COURS ====================
    
    async getEnrolledCourses(page = 1, perPage = 50) {
        try {
            // Récupérer spécifiquement les cours inscrits
            const response = await this.client.get('/courses', {
                params: { 
                    page, 
                    per_page: perPage,
                    enrolled_only: true // Paramètre important
                }
            });
            
            return {
                success: true,
                courses: response.data.courses || [],
                total: response.data.total || 0,
                pages: response.data.pages || 1,
                hasMore: response.data.has_more || false
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération des cours inscrits:', error);
            return {
                success: false,
                error: error.message,
                courses: []
            };
        }
    }
    
    async getAllCourses(filters = {}) {
        try {
            const params = {
                page: filters.page || 1,
                per_page: filters.perPage || 20,
                category: filters.category,
                level: filters.level,
                search: filters.search,
                sort: filters.sort || 'latest'
            };
            
            const response = await this.client.get('/courses', { params });
            
            return {
                success: true,
                courses: response.data.courses || [],
                total: response.data.total || 0,
                categories: response.data.categories || [],
                levels: response.data.levels || []
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération des cours:', error);
            return {
                success: false,
                error: error.message,
                courses: []
            };
        }
    }
    
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`);
            
            const course = response.data.course;
            
            // Enrichir avec les informations d'inscription
            course.isEnrolled = response.data.is_enrolled || false;
            course.canAccess = response.data.can_access || false;
            course.enrollmentDate = response.data.enrollment_date;
            course.expiryDate = response.data.expiry_date;
            course.progress = response.data.progress || 0;
            
            return {
                success: true,
                course: course
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération du cours:', error);
            
            if (error.response?.status === 403) {
                return {
                    success: false,
                    error: 'Vous n\'avez pas accès à ce cours',
                    requiresEnrollment: true,
                    requiresSubscription: error.response.data?.requires_subscription
                };
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // ==================== TÉLÉCHARGEMENT ====================
    
    async requestCoursePackage(courseId, options = {}) {
        try {
            // Vérifier d'abord si l'utilisateur peut télécharger
            const verifyResult = await this.verifySubscription();
            if (!verifyResult.canDownload) {
                throw new Error('Votre abonnement ne permet pas le téléchargement hors ligne');
            }
            
            const response = await this.client.post(`/courses/${courseId}/package`, {
                options: {
                    include_videos: options.includeVideos !== false,
                    include_documents: options.includeDocuments !== false,
                    video_quality: options.videoQuality || 'high',
                    compress_images: options.compressImages || false,
                    encryption_enabled: true
                }
            });
            
            return {
                success: true,
                packageId: response.data.package_id,
                estimatedSize: response.data.estimated_size,
                expiresAt: response.data.expires_at
            };
            
        } catch (error) {
            console.error('Erreur lors de la création du package:', error);
            return {
                success: false,
                error: error.response?.data?.message || error.message
            };
        }
    }
    
    async getPackageStatus(packageId) {
        try {
            const response = await this.client.get(`/packages/${packageId}/status`);
            
            return {
                success: true,
                status: response.data.status,
                progress: response.data.progress || 0,
                downloadUrl: response.data.download_url,
                manifest: response.data.manifest,
                error: response.data.error
            };
            
        } catch (error) {
            console.error('Erreur lors de la vérification du package:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async downloadCoursePackage(courseId, downloadPath, onProgress) {
        try {
            // 1. Demander la création du package
            const packageResult = await this.requestCoursePackage(courseId);
            
            if (!packageResult.success) {
                throw new Error(packageResult.error);
            }
            
            const packageId = packageResult.packageId;
            
            // 2. Attendre que le package soit prêt
            let packageReady = false;
            let packageData;
            let attempts = 0;
            const maxAttempts = 60;
            
            while (!packageReady && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const statusResult = await this.getPackageStatus(packageId);
                
                if (!statusResult.success) {
                    throw new Error(statusResult.error);
                }
                
                packageData = statusResult;
                
                if (onProgress) {
                    onProgress({
                        status: packageData.status,
                        progress: packageData.progress || 0,
                        message: this.getStatusMessage(packageData.status, packageData.progress)
                    });
                }
                
                if (packageData.status === 'completed') {
                    packageReady = true;
                } else if (packageData.status === 'error') {
                    throw new Error(packageData.error || 'Erreur lors de la création du package');
                }
                
                attempts++;
            }
            
            if (!packageReady) {
                throw new Error('Timeout lors de la création du package');
            }
            
            // 3. Télécharger le package
            if (packageData.downloadUrl) {
                await this.downloadFile(
                    packageData.downloadUrl, 
                    path.join(downloadPath, 'package.zip'),
                    onProgress
                );
                
                // 4. Extraire et organiser les fichiers
                await this.extractPackage(downloadPath, packageData.manifest);
            }
            
            // 5. Retourner les informations
            return {
                success: true,
                packageId: packageId,
                manifest: packageData.manifest,
                path: downloadPath,
                expiresAt: packageResult.expiresAt
            };
            
        } catch (error) {
            console.error('Erreur lors du téléchargement du cours:', error);
            
            if (onProgress) {
                onProgress({
                    status: 'error',
                    progress: 0,
                    error: error.message
                });
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async downloadFile(url, savePath, onProgress) {
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
                        status: 'downloading',
                        progress: percentCompleted,
                        loaded: progressEvent.loaded,
                        total: progressEvent.total,
                        message: `Téléchargement: ${percentCompleted}%`
                    });
                }
            }
        });
        
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
    
    async extractPackage(downloadPath, manifest) {
        // TODO: Implémenter l'extraction du package
        // et l'organisation des fichiers selon le manifest
        console.log('Extraction du package...');
    }
    
    // ==================== PROGRESSION ====================
    
    async syncProgress(progressData) {
        try {
            const response = await this.client.post('/progress/sync', {
                progress_data: progressData,
                device_id: this.deviceId
            });
            
            return {
                success: true,
                synced: response.data.synced || 0,
                errors: response.data.errors || []
            };
            
        } catch (error) {
            console.error('Erreur lors de la synchronisation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async updateLessonProgress(lessonId, progress, completed = false) {
        try {
            const response = await this.client.post(`/lessons/${lessonId}/progress`, {
                progress: Math.min(100, Math.max(0, progress)),
                completed: completed,
                timestamp: new Date().toISOString()
            });
            
            return {
                success: true,
                progress: response.data.progress
            };
            
        } catch (error) {
            console.error('Erreur lors de la mise à jour de la progression:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async completeQuiz(quizId, answers, timeSpent) {
        try {
            const response = await this.client.post(`/quizzes/${quizId}/submit`, {
                answers: answers,
                time_spent: timeSpent,
                submitted_at: new Date().toISOString()
            });
            
            return {
                success: true,
                score: response.data.score,
                passed: response.data.passed,
                correctAnswers: response.data.correct_answers,
                feedback: response.data.feedback
            };
            
        } catch (error) {
            console.error('Erreur lors de la soumission du quiz:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // ==================== CERTIFICATS ====================
    
    async requestCertificate(courseId) {
        try {
            const response = await this.client.post(`/courses/${courseId}/certificate`);
            
            return {
                success: true,
                certificateUrl: response.data.certificate_url,
                certificateId: response.data.certificate_id
            };
            
        } catch (error) {
            console.error('Erreur lors de la demande de certificat:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // ==================== UTILITAIRES ====================
    
    handleError(error) {
        if (error.response) {
            const message = error.response.data?.message || error.response.statusText;
            
            // Gérer les erreurs spécifiques
            if (error.response.status === 403) {
                if (error.response.data?.code === 'no_membership') {
                    return {
                        success: false,
                        error: 'Un abonnement actif est requis',
                        requiresMembership: true
                    };
                }
                if (error.response.data?.code === 'subscription_expired') {
                    return {
                        success: false,
                        error: 'Votre abonnement a expiré',
                        subscriptionExpired: true
                    };
                }
            }
            
            return {
                success: false,
                error: message
            };
        }
        
        if (error.code === 'ENOTFOUND') {
            return {
                success: false,
                error: 'Site non trouvé. Vérifiez l\'URL'
            };
        }
        
        return {
            success: false,
            error: error.message || 'Erreur de connexion'
        };
    }
    
    getStatusMessage(status, progress) {
        const messages = {
            'pending': 'En attente...',
            'preparing': `Préparation du contenu: ${progress}%`,
            'compressing': `Compression des fichiers: ${progress}%`,
            'encrypting': `Chiffrement sécurisé: ${progress}%`,
            'finalizing': 'Finalisation...',
            'completed': 'Package prêt !',
            'error': 'Erreur lors de la création'
        };
        
        return messages[status] || `Traitement: ${progress}%`;
    }
    
    // Vérifier si l'utilisateur a accès à une fonctionnalité
    canAccessFeature(feature) {
        if (!this.userSubscription) return false;
        
        const features = {
            'download': this.userSubscription.can_download,
            'certificates': this.userSubscription.can_get_certificates,
            'unlimited': this.userSubscription.is_unlimited,
            'premium_content': this.userSubscription.level_name !== 'Free'
        };
        
        return features[feature] || false;
    }
}

module.exports = LearnPressAPIClient;
