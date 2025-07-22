// auth.js - Gestion de l'authentification côté client

// État d'authentification global
window.AuthState = {
    isLoggedIn: false,
    user: null,
    apiUrl: null
};

// Vérifier l'auto-login au chargement
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Vérification de l\'auto-login...');
    
    try {
        // Vérifier si l'utilisateur est déjà connecté
        const autoLoginResult = await window.electronAPI.checkAutoLogin();
        
        if (autoLoginResult.success) {
            console.log('Auto-login réussi pour:', autoLoginResult.username);
            
            // Mettre à jour l'état
            window.AuthState.isLoggedIn = true;
            window.AuthState.user = { username: autoLoginResult.username };
            window.AuthState.apiUrl = autoLoginResult.apiUrl;
            
            // Passer directement au dashboard
            showDashboard();
            return;
        }
    } catch (error) {
        console.error('Erreur lors de la vérification auto-login:', error);
    }
    
    // Pas d'auto-login, afficher la page de connexion
    console.log('Affichage de la page de connexion');
    showLoginPage();
    
    // Restaurer les valeurs sauvegardées
    await restoreLoginForm();
});

// Écouter les événements d'auto-login depuis le main process
window.electronAPI.on('auto-login-success', () => {
    console.log('Événement auto-login reçu');
    showDashboard();
});

// Restaurer les valeurs du formulaire de connexion
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
        if (!savedApiUrl && apiUrlInput) {
            apiUrlInput.focus();
        } else if (!savedUsername && usernameInput) {
            usernameInput.focus();
        } else {
            const passwordInput = document.getElementById('password');
            if (passwordInput) {
                passwordInput.focus();
            }
        }
    } catch (error) {
        console.error('Erreur lors de la restauration du formulaire:', error);
    }
}

// Afficher la page de connexion
function showLoginPage() {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (loginPage) loginPage.classList.remove('hidden');
    if (dashboardPage) dashboardPage.classList.add('hidden');
    if (playerPage) playerPage.classList.add('hidden');
    
    // Ajouter la classe active pour les animations
    setTimeout(() => {
        if (loginPage) loginPage.classList.add('active');
    }, 10);
}

// Afficher le dashboard
function showDashboard() {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const playerPage = document.getElementById('player-page');
    
    if (loginPage) {
        loginPage.classList.remove('active');
        loginPage.classList.add('hidden');
    }
    if (dashboardPage) dashboardPage.classList.remove('hidden');
    if (playerPage) playerPage.classList.add('hidden');
    
    // Initialiser le dashboard
    initializeDashboard();
}

// Initialiser le dashboard après connexion
// Dans src/js/auth.js, remplacer initializeDashboard() :

async function initializeDashboard() {
    try {
        console.log('Initialisation du dashboard...');
        
        // Afficher le nom d'utilisateur
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName && window.AuthState.user) {
            userDisplayName.textContent = window.AuthState.user.username || 'Utilisateur';
        }
        
        // S'assurer que toutes les fonctions sont disponibles
        await new Promise(resolve => {
            const checkFunctions = () => {
                if (window.loadCourses && window.coursesManager && window.syncManager) {
                    resolve();
                } else {
                    setTimeout(checkFunctions, 100);
                }
            };
            checkFunctions();
        });
        
        // Charger les cours
        console.log('Chargement des cours...');
        await window.loadCourses();
        
        // Initialiser la synchronisation si disponible
        if (window.syncManager) {
            console.log('Initialisation de la synchronisation...');
            window.syncManager.initializeSync();
        }
        
        // Mettre à jour les informations de stockage
        if (window.updateStorageInfo) {
            window.updateStorageInfo();
        }
        
        console.log('Dashboard initialisé avec succès');
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation du dashboard:', error);
        showError('Erreur lors de l\'initialisation de l\'interface');
    }
}

// Gérer la soumission du formulaire de connexion
function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (!loginForm) return;
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const apiUrlInput = document.getElementById('api-url');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const rememberCheckbox = document.getElementById('remember-me');
        
        if (!apiUrlInput || !usernameInput || !passwordInput) {
            showError('Éléments du formulaire manquants');
            return;
        }
        
        const apiUrl = apiUrlInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
        
        const loginBtn = document.getElementById('login-btn');
        const btnText = loginBtn?.querySelector('.btn-text');
        const btnLoader = loginBtn?.querySelector('.btn-loader');
        const errorDiv = document.getElementById('login-error');
        
        // Validation basique
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
            console.log('Tentative de connexion à:', apiUrl);
            
            // Sauvegarder l'URL pour la prochaine fois
            await window.electronAPI.store.set('savedApiUrl', apiUrl);
            
            // Tenter la connexion
            const result = await window.electronAPI.api.login(apiUrl, username, password);
            
            if (result.success) {
                console.log('Connexion réussie');
                
                // Sauvegarder les préférences
                if (rememberMe) {
                    await window.electronAPI.store.set('savedUsername', username);
                } else {
                    await window.electronAPI.store.delete('savedUsername');
                }
                
                // Mettre à jour l'état d'authentification
                window.AuthState.isLoggedIn = true;
                window.AuthState.user = result.user || { username: username };
                window.AuthState.apiUrl = apiUrl;
                
                // Enregistrer le nom d'utilisateur
                await window.electronAPI.store.set('username', username);
                
                // Passer au dashboard
                showDashboard();
                
            } else {
                // Afficher l'erreur
                let errorMessage = result.error || 'Erreur de connexion';
                
                if (result.requiresMembership) {
                    errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
                } else if (errorMessage.includes('Invalid username') || errorMessage.includes('invalid_username')) {
                    errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
                } else if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND')) {
                    errorMessage = 'Erreur de connexion. Vérifiez votre connexion internet et l\'URL du site';
                } else if (errorMessage.includes('404')) {
                    errorMessage = 'API non trouvée. Vérifiez que le plugin LearnPress API est installé sur votre site';
                }
                
                showLoginError(errorMessage);
            }
            
        } catch (error) {
            console.error('Erreur de connexion:', error);
            
            let errorMessage = 'Erreur de connexion au serveur';
            
            if (error.message.includes('ENOTFOUND')) {
                errorMessage = 'Site non trouvé. Vérifiez l\'URL saisie';
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Connexion refusée. Le serveur est peut-être indisponible';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Délai de connexion dépassé. Vérifiez votre connexion internet';
            }
            
            showLoginError(errorMessage);
        } finally {
            // Masquer le loader
            setLoginLoading(false);
        }
    });
}

// Gérer le bouton de déconnexion
function setupLogoutButton() {
    const logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn) return;
    
    logoutBtn.addEventListener('click', async () => {
        if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
            await performLogout();
        }
    });
}

// Effectuer la déconnexion
async function performLogout() {
    try {
        console.log('Déconnexion en cours...');
        
        // Appeler l'API de déconnexion
        const result = await window.electronAPI.api.logout();
        
        if (!result.success) {
            console.warn('Erreur lors de la déconnexion API:', result.error);
        }
        
        // Réinitialiser l'état local
        window.AuthState.isLoggedIn = false;
        window.AuthState.user = null;
        window.AuthState.apiUrl = null;
        
        // Afficher la page de connexion
        showLoginPage();
        
        // Réinitialiser le formulaire
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.reset();
        }
        
        // Restaurer les valeurs sauvegardées
        await restoreLoginForm();
        
        console.log('Déconnexion terminée');
        
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        // Forcer la déconnexion même en cas d'erreur
        showLoginPage();
    }
}

// Utilitaires pour l'interface de connexion
function setLoginLoading(loading) {
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn?.querySelector('.btn-text');
    const btnLoader = loginBtn?.querySelector('.btn-loader');
    
    if (loading) {
        if (btnText) btnText.classList.add('hidden');
        if (btnLoader) btnLoader.classList.remove('hidden');
        if (loginBtn) loginBtn.disabled = true;
    } else {
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
        if (loginBtn) loginBtn.disabled = false;
    }
}

function showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

function hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

// Validation d'URL simple
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// Fonctions utilitaires globales (si pas définies ailleurs)
function showError(message) {
    if (window.showNotification) {
        window.showNotification(message, 'error');
    } else {
        console.error(message);
        alert(message);
    }
}

// Initialiser les gestionnaires d'événements
function initializeAuthEvents() {
    setupLoginForm();
    setupLogoutButton();
    
    // Écouter les événements de déconnexion
    window.electronAPI.on('logout', () => {
        performLogout();
    });
    
    console.log('Gestionnaires d\'authentification initialisés');
}

// Initialiser quand le DOM est prêt
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuthEvents);
} else {
    initializeAuthEvents();
}

// Export des fonctions pour utilisation globale
window.AuthManager = {
    showLoginPage,
    showDashboard,
    performLogout,
    isLoggedIn: () => window.AuthState.isLoggedIn,
    getUser: () => window.AuthState.user
};
