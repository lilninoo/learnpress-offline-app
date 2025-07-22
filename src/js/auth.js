// src/js/auth.js - Version corrigée complète

// État d'authentification global
window.AuthState = {
    isLoggedIn: false,
    user: null,
    apiUrl: null
};

// Écouter l'événement de succès de login depuis le main process
window.electronAPI.on('login-success', (user) => {
    console.log('[Auth] Événement login-success reçu');
    window.AuthState.isLoggedIn = true;
    window.AuthState.user = user;
    showDashboard();
});

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
            return;
        }
    } catch (error) {
        console.error('[Auth] Erreur auto-login:', error);
    }
    
    console.log('[Auth] Affichage de la page de connexion');
    showLoginPage();
    await restoreLoginForm();
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
        
        // Charger les cours après un délai
        setTimeout(async () => {
            if (window.loadCourses) {
                console.log('[Auth] Chargement des cours...');
                await window.loadCourses();
            }
        }, 500);
        
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
        
        const apiUrl = apiUrlInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
        
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
            
            // Sauvegarder l'URL
            await window.electronAPI.store.set('savedApiUrl', apiUrl);
            
            // Tenter la connexion
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
                
                // Mettre à jour l'état local
                window.AuthState.isLoggedIn = true;
                window.AuthState.user = result.user || { username: username };
                window.AuthState.apiUrl = apiUrl;
                
                await window.electronAPI.store.set('username', username);
                
                // IMPORTANT : Forcer la redirection
                console.log('[Auth] Redirection vers le dashboard...');
                setLoginLoading(false);
                showDashboard();
                
            } else {
                // Gérer les erreurs
                console.error('[Auth] Échec de connexion:', result.error);
                setLoginLoading(false);
                
                let errorMessage = result.error || 'Erreur de connexion';
                
                if (result.requiresMembership) {
                    errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
                } else if (errorMessage.includes('Invalid username') || errorMessage.includes('invalid_username')) {
                    errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
                } else if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND')) {
                    errorMessage = 'Erreur de connexion. Vérifiez votre connexion internet et l\'URL du site';
                } else if (errorMessage.includes('404')) {
                    errorMessage = 'API non trouvée. Vérifiez que le plugin est installé sur votre site';
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

// Utilitaires UI
function setLoginLoading(loading) {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.disabled = loading;
        loginBtn.textContent = loading ? 'Connexion en cours...' : 'Se connecter';
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
    
    setupLoginForm();
    
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
