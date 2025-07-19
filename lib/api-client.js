// api-client.js - Client API pour communiquer avec WordPress LearnPress
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const FormData = require('form-data');

class LearnPressAPIClient {
    constructor(apiUrl, deviceId) {
        this.apiUrl = apiUrl.replace(/\/$/, ''); // Enlever le slash final
        this.deviceId = deviceId;
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
        
        // Configuration axios
        this.client = axios.create({
            baseURL: `${this.apiUrl}/wp-json/col-lms/v1`, // Aligné avec le plugin WordPress
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Device-ID': this.deviceId
            }
        });
        
        // Intercepteur pour ajouter le token
        this.client.interceptors.request.use(
            config => {
                if (this.token) {
                    config.headers['Authorization'] = `Bearer ${this.token}`;
                }
                return config;
            },
            error => Promise.reject(error)
        );
        
        // Intercepteur pour gérer les erreurs
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
                    user: data.user,
                    membership: data.user.membership
                };
            }
            
            return {
                success: false,
                error: 'Token non reçu'
            };
            
        } catch (error) {
            console.error('Erreur de connexion:', error);
            
            if (error.response) {
                const message = error.response.data?.message || error.response.statusText;
                
                // Gérer les erreurs spécifiques
                if (error.response.status === 403 && error.response.data?.code === 'no_membership') {
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
    
    // Rafraîchir le token
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Pas de refresh token disponible');
        }
        
        try {
            const response = await this.client.post('/auth/refresh', {
                refresh_token: this.refreshToken
            });
            
            if (response.data.token) {
                this.token = response.data.token;
                return { success: true };
            }
            
            throw new Error('Token non reçu');
            
        } catch (error) {
            console.error('Erreur de rafraîchissement du token:', error);
            throw error;
        }
    }
    
    // Vérifier l'abonnement
    async verifySubscription() {
        try {
            const response = await this.client.get('/auth/verify');
            
            return {
                success: true,
                isActive: response.data.is_active,
                subscription: response.data.subscription
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
    
    // Déconnexion
    async logout() {
        try {
            await this.client.post('/auth/logout');
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
        }
        
        this.token = null;
        this.refreshToken = null;
        this.userId = null;
    }
    
    // Récupérer les cours
    async getCourses(page = 1, perPage = 20) {
        try {
            const response = await this.client.get('/courses', {
                params: { page, per_page: perPage }
            });
            
            return {
                success: true,
                courses: response.data.courses,
                total: response.data.total,
                pages: response.data.pages
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
    
    // Récupérer les détails d'un cours
    async getCourseDetails(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}`);
            
            return {
                success: true,
                course: response.data.course
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération du cours:', error);
            
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
    
    // Télécharger un cours
    async downloadCourse(courseId, downloadPath, onProgress) {
        try {
            // 1. Créer le package
            const packageResponse = await this.client.post(`/courses/${courseId}/package`, {
                options: {
                    include_videos: true,
                    include_documents: true,
                    compress_images: true,
                    encryption_enabled: true
                }
            });
            
            const packageId = packageResponse.data.package_id;
            
            // 2. Attendre que le package soit prêt
            let packageReady = false;
            let packageData;
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max
            
            while (!packageReady && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Attendre 5 secondes
                
                const statusResponse = await this.client.get(`/packages/${packageId}/status`);
                packageData = statusResponse.data;
                
                if (onProgress) {
                    onProgress({
                        status: packageData.status,
                        progress: packageData.progress || 0,
                        message: `Préparation du package: ${packageData.progress || 0}%`
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
            
            // 3. Télécharger les fichiers
            const files = packageData.files || [];
            await fs.mkdir(downloadPath, { recursive: true });
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = path.join(downloadPath, file.filename);
                
                if (onProgress) {
                    onProgress({
                        status: 'downloading',
                        progress: Math.round((i / files.length) * 100),
                        currentFile: file.filename,
                        message: `Téléchargement: ${file.filename}`
                    });
                }
                
                // Télécharger le fichier
                await this.downloadFile(file.download_url, filePath);
            }
            
            // 4. Sauvegarder le manifeste
            const manifestPath = path.join(downloadPath, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(packageData.manifest, null, 2));
            
            if (onProgress) {
                onProgress({
                    status: 'completed',
                    progress: 100,
                    message: 'Téléchargement terminé'
                });
            }
            
            return {
                success: true,
                packageId: packageId,
                files: files.length,
                path: downloadPath
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
    
    // Télécharger un fichier
    async downloadFile(url, filePath) {
        const writer = require('fs').createWriteStream(filePath);
        
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });
        
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
    
    // Récupérer le contenu d'une leçon
    async getLessonContent(lessonId) {
        try {
            const response = await this.client.get(`/lessons/${lessonId}/content`);
            
            return {
                success: true,
                lesson: response.data.lesson
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération de la leçon:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Synchroniser la progression
    async syncProgress(progressData) {
        try {
            const response = await this.client.post('/progress/sync', {
                progress_data: progressData
            });
            
            return {
                success: true,
                synced: response.data.synced,
                errors: response.data.errors
            };
            
        } catch (error) {
            console.error('Erreur lors de la synchronisation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Récupérer les informations sur les médias
    async getMediaInfo(courseId) {
        try {
            const response = await this.client.get(`/courses/${courseId}/media`);
            
            return {
                success: true,
                media: response.data.media,
                count: response.data.count
            };
            
        } catch (error) {
            console.error('Erreur lors de la récupération des médias:', error);
            return {
                success: false,
                error: error.message,
                media: []
            };
        }
    }
    
    // Télécharger un média
    async downloadMedia(mediaUrl, savePath, onProgress) {
        try {
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            const response = await axios({
                url: mediaUrl,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                onDownloadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.lengthComputable) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress(percentCompleted);
                    }
                }
            });
            
            const writer = require('fs').createWriteStream(savePath);
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
            console.error('Erreur lors du téléchargement du média:', error);
            throw error;
        }
    }
}

module.exports = LearnPressAPIClient;
