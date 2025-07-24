// src/js/auth.js - Gestion complète de l'authentification

// État d'authentification global
window.AuthState = {
    isLoggedIn: false,
    user: null,
    apiUrl: null
};

// IMPORTANT : Configurer l'écouteur AVANT le DOMContentLoaded pour ne pas rater l'événement
window.electronAPI.on('login-success', (user) => {
    console.log('[Auth] Événement login-success reçu depuis le main process');
    window.AuthState.isLoggedIn = true;
    window.AuthState.user = user;
    
    // S'assurer que le DOM est prêt avant de manipuler l'interface
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            showDashboard();
            initializeDashboardAfterLogin();
        });
    } else {
        showDashboard();
        initializeDashboardAfterLogin();
    }
});

// Fonction pour initialiser le dashboard après login
function initializeDashboardAfterLogin() {
    console.log('[Auth] Initialisation du dashboard après login...');
    
    // S'assurer que l'utilisateur est affiché
    const userDisplayName = document.getElementById('user-display-name');
    if (userDisplayName && window.AuthState.user) {
        userDisplayName.textContent = window.AuthState.user.displayName || 
                                     window.AuthState.user.username || 
                                     'Utilisateur';
    }
    
    // Attendre que tous les modules soient chargés
    let checkInterval;
    let attempts = 0;
    const maxAttempts = 50;
    const maxWaitTime = 30000; // 30 secondes max
    const startTime = Date.now();

    
    const checkAndLoadCourses = async () => {
        attempts++;


                // ⏱ Timeout absolu
        if (Date.now() - startTime > maxWaitTime) {
            clearInterval(checkInterval);
            console.error('[Auth] Timeout - Abandon du chargement');

            const container = document.getElementById('courses-container');
            if (container) {
                container.innerHTML = `
                    <div class="message message-error">
                        <p>Le chargement des cours a dépassé le délai imparti.</p>
                        <button class="btn btn-primary" onclick="retryLoadCourses()">
                            Réessayer
                        </button>
                    </div>
                `;
            }
            return;
        }
        
        // Vérifier si les modules sont prêts
        const modulesReady = !!(
            window.coursesManager && 
            window.electronAPI && 
            document.getElementById('courses-container')
        );
        
        console.log(`[Auth] Tentative ${attempts}/${maxAttempts} - Modules prêts: ${modulesReady}`);
        
        if (modulesReady) {
            clearInterval(checkInterval);
            
            try {
                // Utiliser directement coursesManager.loadCourses qui est plus robuste
                if (window.coursesManager && window.coursesManager.loadCourses) {
                    console.log('[Auth] Chargement des cours via coursesManager...');
                    await window.coursesManager.loadCourses();
                } else if (window.loadCourses) {
                    console.log('[Auth] Chargement des cours via loadCourses global...');
                    await window.loadCourses();
                }
                
                // Charger aussi les statistiques
                if (window.updateStats) {
                    await window.updateStats();
                }
                
                // Initialiser la synchronisation
                if (window.syncManager) {
                    window.syncManager.initializeSync();
                }
                
                console.log('[Auth] Dashboard complètement initialisé');
                
            } catch (error) {
                console.error('[Auth] Erreur lors du chargement des cours:', error);
                
                // Afficher un message d'erreur dans l'interface
                const container = document.getElementById('courses-container');
                if (container) {
                    container.innerHTML = `
                        <div class="message message-error">
                            <p>Impossible de charger les cours</p>
                            <p style="font-size: 0.9em; margin-top: 8px;">Erreur: ${error.message}</p>
                            <button class="btn btn-primary" style="margin-top: 12px;" onclick="retryLoadCourses()">
                                Réessayer
                            </button>
                        </div>
                    `;
                }
            }
        } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            console.error('[Auth] Timeout - Impossible de charger les modules');
            
            // Afficher un message d'erreur
            const container = document.getElementById('courses-container');
            if (container) {
                container.innerHTML = `
                    <div class="message message-error">
                        <p>Les modules n'ont pas pu être chargés</p>
                        <button class="btn btn-primary" onclick="location.reload()">
                            Recharger l'application
                        </button>
                    </div>
                `;
            }
        }
    };
    
    // Vérifier toutes les 200ms
    checkInterval = setInterval(checkAndLoadCourses, 200);
    
    // Première vérification immédiate
    checkAndLoadCourses();
}

// Fonction globale pour le retry
window.retryLoadCourses = function() {
    console.log('[Auth] Nouvelle tentative de chargement des cours...');

    const container = document.getElementById('courses-container');
    if (container) {
        container.innerHTML = `
            <div class="loading" style="padding: 40px 0; text-align: center;">
                <div class="spinner"></div>
                <p style="margin-top: 16px;">Nouvelle tentative de chargement...</p>
            </div>
        `;
    }

    // On relance entièrement l'initialisation du dashboard (modules + cours + stats + sync)
    initializeDashboardAfterLogin();
};


// Vérifier l'auto-login au chargement
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Auth] Vérification de l\'auto-login...');
    
    try {
        const autoLoginResult = await window.electronAPI.checkAutoLogin();
        
        if (autoLoginResult.success) {
            console.log('[Auth] Auto-login réussi');
            
            window.AuthState.isLoggedIn = true;
            window.AuthState.user = { username: autoLoginResult.username };
            window.AuthState.apiUrl = autoLoginResult.apiUrl;
            
            showDashboard();
            initializeDashboardAfterLogin();
            return;
        }
    } catch (error) {
        console.error('[Auth] Erreur auto-login:', error);
    }
    
    console.log('[Auth] Affichage de la page de connexion');
    showLoginPage();
    await restoreLoginForm();
    setupLoginForm();
});

// Restaurer les valeurs du formulaire
async function restoreLoginForm() {
    try {
        const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
        const savedUsername = await window.electronAPI.store.get('savedUsername');
        
        const apiUrlInput = document.getElementById('api-url');
        const usernameInput = document.getElementById('username');
        const rememberCheckbox = document.getElementById('remember-me');
        
        if (savedApiUrl && apiUrlInput) {
            apiUrlInput.value = savedApiUrl;
        }
        
        if (savedUsername && usernameInput) {
            usernameInput.value = savedUsername;
            if (rememberCheckbox) {
                rememberCheckbox.checked = true;
            }
        }
        
        // Focus sur le premier champ vide
        const passwordInput = document.getElementById('password');
        if (!apiUrlInput.value && apiUrlInput) {
            apiUrlInput.focus();
        } else if (!usernameInput.value && usernameInput) {
            usernameInput.focus();
        } else if (passwordInput) {
            passwordInput.focus();
        }
    } catch (error) {
        console.error('[Auth] Erreur restauration formulaire:', error);
    }
}

// Afficher la page de connexion
function showLoginPage() {
    console.log('[Auth] Affichage page de connexion');
    
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (loginPage) {
        loginPage.style.display = 'block';
        loginPage.classList.remove('hidden');
        loginPage.classList.add('active');
    }
    
    if (dashboardPage) {
        dashboardPage.style.display = 'none';
        dashboardPage.classList.add('hidden');
        dashboardPage.classList.remove('active');
    }
    
    if (playerPage) {
        playerPage.style.display = 'none';
        playerPage.classList.add('hidden');
    }
}

// Afficher le dashboard
function showDashboard() {
    console.log('[Auth] Affichage du dashboard');
    
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (loginPage) {
        loginPage.style.display = 'none';
        loginPage.classList.remove('active');
        loginPage.classList.add('hidden');
    }
    
    if (dashboardPage) {
        dashboardPage.style.display = 'block';
        dashboardPage.classList.remove('hidden');
        dashboardPage.classList.add('active');
    }
    
    if (playerPage) {
        playerPage.style.display = 'none';
        playerPage.classList.add('hidden');
    }
    
    // Initialiser le dashboard
    setTimeout(() => {
        initializeDashboard();
    }, 100);
}

// Initialiser le dashboard
async function initializeDashboard() {
    try {
        console.log('[Auth] Initialisation du dashboard...');
        
        // Afficher le nom d'utilisateur
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName && window.AuthState.user) {
            userDisplayName.textContent = window.AuthState.user.username || 
                                         window.AuthState.user.displayName || 
                                         'Utilisateur';
        }
        
        // NE PAS charger les cours ici, laisser initializeDashboardAfterLogin le faire
        
        // Initialiser la synchronisation
        if (window.syncManager) {
            window.syncManager.initializeSync();
        }
        
        console.log('[Auth] Dashboard initialisé');
        
    } catch (error) {
        console.error('[Auth] Erreur initialisation dashboard:', error);
    }
}

// Gérer la soumission du formulaire
function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (!loginForm) {
        console.error('[Auth] Formulaire de login non trouvé');
        return;
    }
    
    console.log('[Auth] Configuration du formulaire de login');
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[Auth] Soumission du formulaire');
        
        const apiUrlInput = document.getElementById('api-url');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const rememberCheckbox = document.getElementById('remember-me');
        
        if (!apiUrlInput || !usernameInput || !passwordInput) {
            showLoginError('Éléments du formulaire manquants');
            return;
        }
        
        let apiUrl = apiUrlInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
        
        // Normaliser l'URL
        if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
            apiUrl = 'https://' + apiUrl;
        }
        // Retirer le slash final
        apiUrl = apiUrl.replace(/\/$/, '');
        
        // Validation
        if (!apiUrl || !username || !password) {
            showLoginError('Veuillez remplir tous les champs');
            return;
        }
        
        if (!isValidUrl(apiUrl)) {
            showLoginError('L\'URL du site n\'est pas valide');
            return;
        }
        
        // Afficher le loader
        setLoginLoading(true);
        hideLoginError();
        
        try {
            console.log('[Auth] Tentative de connexion à:', apiUrl);
            
            // Sauvegarder l'URL normalisée
            await window.electronAPI.store.set('savedApiUrl', apiUrl);
            
            // Tenter la connexion avec l'URL normalisée
            const result = await window.electronAPI.api.login(apiUrl, username, password);
            console.log('[Auth] Résultat de connexion:', result);
            
            if (result.success) {
                console.log('[Auth] Connexion réussie !');
                
                // Sauvegarder les préférences
                if (rememberMe) {
                    await window.electronAPI.store.set('savedUsername', username);
                } else {
                    await window.electronAPI.store.delete('savedUsername');
                }
                
                // Mettre à jour l'état local IMMÉDIATEMENT
                window.AuthState.isLoggedIn = true;
                window.AuthState.user = result.user || { username: username };
                window.AuthState.apiUrl = apiUrl;
                
                await window.electronAPI.store.set('username', username);
                
                // IMPORTANT : Masquer le loader AVANT de changer de page
                setLoginLoading(false);
                
                // L'événement login-success gérera la redirection, mais on fait aussi une redirection directe
                // au cas où l'événement ne serait pas reçu
                setTimeout(() => {
                    if (document.getElementById('login-page').classList.contains('active')) {
                        console.log('[Auth] Redirection manuelle vers le dashboard...');
                        showDashboard();
                        initializeDashboardAfterLogin();
                    }
                }, 1000);
                
            } else {
                // Gérer les erreurs
                console.error('[Auth] Échec de connexion:', result.error);
                setLoginLoading(false);
                
                let errorMessage = result.error || 'Erreur de connexion';
                
                // Messages d'erreur plus détaillés
                if (result.code === 'no_active_membership') {
                    errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
                } else if (result.status === 404) {
                    errorMessage = 'API non trouvée. Vérifiez l\'URL du site et que le plugin col-lms-api est activé';
                } else if (errorMessage.includes('Invalid username') || errorMessage.includes('invalid_username')) {
                    errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
                } else if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND')) {
                    errorMessage = 'Erreur de connexion. Vérifiez votre connexion internet et l\'URL du site';
                }
                
                showLoginError(errorMessage);
            }
            
        } catch (error) {
            console.error('[Auth] Erreur de connexion:', error);
            setLoginLoading(false);
            showLoginError('Erreur de connexion au serveur: ' + error.message);
        }
    });
}

// Déconnexion
async function performLogout() {
    try {
        console.log('[Auth] Déconnexion...');
        
        await window.electronAPI.api.logout();
        
        window.AuthState.isLoggedIn = false;
        window.AuthState.user = null;
        window.AuthState.apiUrl = null;
        
        showLoginPage();
        
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.reset();
        }
        
        await restoreLoginForm();
        
        console.log('[Auth] Déconnexion terminée');
        
    } catch (error) {
        console.error('[Auth] Erreur déconnexion:', error);
        showLoginPage();
    }
}

// Écouter l'événement de déconnexion forcée
window.electronAPI.on('force-logout', async (data) => {
    console.log('[Auth] Déconnexion forcée reçue:', data);
    
    // Nettoyer l'état local
    window.AuthState.isLoggedIn = false;
    window.AuthState.user = null;
    window.AuthState.apiUrl = null;
    
    // Nettoyer le stockage
    try {
        await window.electronAPI.store.delete('token');
        await window.electronAPI.store.delete('refreshToken');
    } catch (error) {
        console.error('[Auth] Erreur lors du nettoyage:', error);
    }
    
    // Afficher un message approprié
    if (data.reason === 'invalid_token') {
        showLoginError('Votre session a expiré. Veuillez vous reconnecter.');
    } else if (data.reason === 'refresh_token_expired') {
        showLoginError(data.message || 'Votre session a expiré. Veuillez vous reconnecter.');
    } else {
        showLoginError('Vous avez été déconnecté.');
    }
    
    // Retourner à la page de connexion
    showLoginPage();
    
    // Restaurer le formulaire
    await restoreLoginForm();
});

// Utilitaires UI
function setLoginLoading(loading) {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.disabled = loading;
        
        const btnText = loginBtn.querySelector('.btn-text');
        const btnLoader = loginBtn.querySelector('.btn-loader');
        
        if (btnText && btnLoader) {
            if (loading) {
                btnText.classList.add('hidden');
                btnLoader.classList.remove('hidden');
            } else {
                btnText.classList.remove('hidden');
                btnLoader.classList.add('hidden');
            }
        } else {
            // Fallback si la structure n'est pas trouvée
            loginBtn.textContent = loading ? 'Connexion en cours...' : 'Se connecter';
        }
    }
}

function showLoginError(message) {
    console.error('[Auth] Erreur:', message);
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        errorDiv.style.display = 'block';
    }
}

function hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.style.display = 'none';
    }
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Initialiser les événements au chargement
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Auth] Configuration des événements');
    
    // Bouton de déconnexion
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
                await performLogout();
            }
        });
    }
});

// Export global
window.AuthManager = {
    showLoginPage,
    showDashboard,
    performLogout,
    isLoggedIn: () => window.AuthState.isLoggedIn,
    getUser: () => window.AuthState.user
};

console.log('[Auth] Module auth.js chargé');
