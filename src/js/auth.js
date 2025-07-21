// auth.js - Gestion de l'authentification

// État de l'authentification
const AuthState = {
    isLoggingIn: false,
    apiUrl: null
};

// Initialiser l'authentification
document.addEventListener('DOMContentLoaded', async () => {
    // Restaurer les valeurs sauvegardées
    const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
    const savedUsername = await window.electronAPI.store.get('savedUsername');
    const rememberMe = await window.electronAPI.store.get('rememberMe');
    
    if (savedApiUrl) {
        document.getElementById('api-url').value = savedApiUrl;
    }
    
    if (savedUsername && rememberMe) {
        document.getElementById('username').value = savedUsername;
        document.getElementById('remember-me').checked = true;
    }
    
    // Configurer le formulaire
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Focus sur le premier champ vide
    if (!savedApiUrl) {
        document.getElementById('api-url')?.focus();
    } else if (!savedUsername) {
        document.getElementById('username')?.focus();
    } else {
        document.getElementById('password')?.focus();
    }
});

// Gérer la connexion
async function handleLogin(event) {
    event.preventDefault();
    
    if (AuthState.isLoggingIn) return;
    
    const apiUrl = document.getElementById('api-url').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    // Validation
    if (!isValidUrl(apiUrl)) {
        showLoginError('URL invalide. Veuillez entrer une URL complète (https://...)');
        return;
    }
    
    if (!username) {
        showLoginError('Veuillez entrer votre nom d\'utilisateur');
        return;
    }
    
    if (!isValidPassword(password)) {
        showLoginError('Le mot de passe doit contenir au moins 8 caractères');
        return;
    }
    
    AuthState.isLoggingIn = true;
    showLoginLoading(true);
    hideLoginError();
    
    try {
        // Sauvegarder l'URL
        await window.electronAPI.store.set('savedApiUrl', apiUrl);
        
        // Tentative de connexion
        const result = await window.electronAPI.api.login(apiUrl, username, password);
        
        if (result.success) {
            // Sauvegarder les préférences
            if (rememberMe) {
                await window.electronAPI.store.set('savedUsername', username);
                await window.electronAPI.store.set('rememberMe', true);
            } else {
                await window.electronAPI.store.delete('savedUsername');
                await window.electronAPI.store.set('rememberMe', false);
            }
            
            // Sauvegarder les informations utilisateur
            if (window.AppState) {
                window.AppState.user = result.user;
            }
            
            // Vérifier l'abonnement
            if (result.requiresMembership) {
                showLoginError('Un abonnement actif est requis pour utiliser l\'application');
                AuthState.isLoggingIn = false;
                showLoginLoading(false);
                return;
            }
            
            // Rediriger vers le dashboard
            await initializeDashboard();
            
        } else {
            // Gérer les erreurs spécifiques
            let errorMessage = result.error || 'Erreur de connexion';
            
            if (result.requiresMembership) {
                errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
            } else if (errorMessage.includes('Incorrect username')) {
                errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
            } else if (errorMessage.includes('network')) {
                errorMessage = 'Erreur de connexion. Vérifiez votre connexion internet';
            }
            
            showLoginError(errorMessage);
        }
        
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        showLoginError('Erreur inattendue. Veuillez réessayer');
        
    } finally {
        AuthState.isLoggingIn = false;
        showLoginLoading(false);
    }
}

// Afficher/masquer le chargement
function showLoginLoading(show) {
    const btnText = document.querySelector('#login-btn .btn-text');
    const btnLoader = document.querySelector('#login-btn .btn-loader');
    const loginBtn = document.getElementById('login-btn');
    
    if (show) {
        btnText?.classList.add('hidden');
        btnLoader?.classList.remove('hidden');
        loginBtn.disabled = true;
    } else {
        btnText?.classList.remove('hidden');
        btnLoader?.classList.add('hidden');
        loginBtn.disabled = false;
    }
}

// Afficher une erreur de connexion
function showLoginError(message) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }
}

// Masquer l'erreur de connexion
function hideLoginError() {
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.classList.add('hidden');
    }
}

// Vérifier le statut de connexion
async function checkAuthStatus() {
    try {
        const token = await window.electronAPI.store.get('token');
        const refreshToken = await window.electronAPI.store.get('refreshToken');
        
        if (!token || !refreshToken) {
            return false;
        }
        
        // Vérifier si le token est encore valide
        const result = await window.electronAPI.api.verifySubscription();
        
        if (!result.success) {
            // Essayer de rafraîchir le token
            const refreshResult = await window.electronAPI.api.refreshToken();
            return refreshResult.success;
        }
        
        return true;
        
    } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
        return false;
    }
}

// Déconnexion forcée (expiration, etc.)
async function forceLogout(reason) {
    try {
        await window.electronAPI.api.logout();
        
        // Nettoyer l'état
        if (window.AppState) {
            window.AppState.currentCourse = null;
            window.AppState.currentLesson = null;
            window.AppState.user = null;
        }
        
        // Afficher la page de connexion avec un message
        showPage('login-page');
        
        if (reason) {
            showLoginError(reason);
        }
        
    } catch (error) {
        console.error('Erreur lors de la déconnexion forcée:', error);
        // Forcer le retour à la page de connexion
        showPage('login-page');
    }
}

// Gérer l'expiration du token
window.electronAPI.on('token-expired', () => {
    forceLogout('Votre session a expiré. Veuillez vous reconnecter');
});

// Gérer les changements d'abonnement
window.electronAPI.on('membership-expired', () => {
    forceLogout('Votre abonnement a expiré. Veuillez le renouveler pour continuer');
});

// Export des fonctions
window.authManager = {
    checkAuthStatus,
    forceLogout,
    handleLogin
};
