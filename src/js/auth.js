// auth.js - Gestion de l'authentification

// Gestionnaire du formulaire de connexion
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    // Validation des entrées
    if (!apiUrl || !username || !password) {
        showLoginError('Veuillez remplir tous les champs');
        return;
    }
    
    // Valider l'URL
    if (!Utils.isValidUrl(apiUrl)) {
        showLoginError('URL invalide. Veuillez entrer une URL valide (ex: https://votre-site.com)');
        return;
    }
    
    // Afficher le loader
    setLoginLoading(true);
    hideLoginError();
    
    try {
        // Tenter la connexion via l'API exposée par le preload
        const result = await window.electronAPI.api.login(apiUrl, username, password);

        // Par (pour gérer les erreurs d'abonnement)
        const result = await window.electronAPI.api.login(apiUrl, username, password);
        
        if (!result.success && result.requiresMembership) {
            showLoginError('Vous devez avoir un abonnement actif pour utiliser l\'application');
            // Optionnel : Ajouter un lien vers la page d'abonnement
            const subscribeLink = document.createElement('a');
            subscribeLink.href = 'https://teachmemore.fr/nos-tarifs/';
            subscribeLink.textContent = 'Souscrire à un abonnement';
            subscribeLink.onclick = () => window.electronAPI.openExternal(`${apiUrl}/membership-account/membership-checkout/`);
            document.getElementById('login-error').appendChild(subscribeLink);
            return;
        }
                
        
        if (result.success) {
            // Sauvegarder les informations de connexion
            await window.electronAPI.store.set('apiUrl', apiUrl);
            await window.electronAPI.store.set('username', username);
            await window.electronAPI.store.set('userId', result.user.id);
            
            // Se souvenir de l'URL et du nom d'utilisateur si demandé
            if (rememberMe) {
                await window.electronAPI.store.set('savedApiUrl', apiUrl);
                await window.electronAPI.store.set('savedUsername', username);
            } else {
                await window.electronAPI.store.set('savedApiUrl', '');
                await window.electronAPI.store.set('savedUsername', '');
            }
            
            // Mettre à jour l'état global
            AppState.currentUser = result.user;
            AppState.isAuthenticated = true;
            
            // Logger le succès
            Logger.log('Connexion réussie', { userId: result.user.id });
            
            // Afficher le dashboard
            showDashboard();
            
            // Synchronisation initiale après un court délai
            setTimeout(() => {
                window.syncManager.performFullSync();
            }, 1000);
            
        } else {
            showLoginError(result.error || 'Échec de la connexion');
        }
    } catch (error) {
        console.error('Erreur de connexion:', error);
        
        // Gérer les différents types d'erreurs
        let errorMessage = 'Erreur de connexion. Veuillez réessayer.';
        
        if (error.message) {
            if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Impossible de se connecter au serveur. Vérifiez l\'URL et votre connexion internet.';
            } else if (error.message.includes('401')) {
                errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
            } else if (error.message.includes('403')) {
                errorMessage = 'Accès refusé. Vérifiez vos permissions.';
            } else if (error.message.includes('ETIMEDOUT')) {
                errorMessage = 'Délai de connexion dépassé. Vérifiez votre connexion internet.';
            }
        }
        
        showLoginError(errorMessage);
        
        // Logger l'erreur
        window.electronAPI.logError({
            message: 'Erreur de connexion',
            error: error.toString(),
            apiUrl: apiUrl
        });
    } finally {
        setLoginLoading(false);
    }
});

// Charger les informations sauvegardées au démarrage
async function loadSavedCredentials() {
    try {
        const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
        const savedUsername = await window.electronAPI.store.get('savedUsername');
        
        if (savedApiUrl) {
            document.getElementById('api-url').value = savedApiUrl;
        }
        
        if (savedUsername) {
            document.getElementById('username').value = savedUsername;
            document.getElementById('remember-me').checked = true;
        }
        
        // Focus sur le champ approprié
        if (savedApiUrl && savedUsername) {
            document.getElementById('password').focus();
        } else if (savedApiUrl) {
            document.getElementById('username').focus();
        } else {
            document.getElementById('api-url').focus();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des credentials:', error);
    }
}

// Afficher/masquer le loader de connexion
function setLoginLoading(loading) {
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');
    
    if (loading) {
        loginBtn.disabled = true;
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
    } else {
        loginBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }
}

// Afficher une erreur de connexion
function showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // Animation
    errorDiv.style.animation = 'shake 0.5s';
    setTimeout(() => {
        errorDiv.style.animation = '';
    }, 500);
}

// Masquer l'erreur de connexion
function hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    errorDiv.classList.add('hidden');
}

// Gérer la déconnexion forcée (token expiré, etc.)
async function handleAuthError() {
    // Nettoyer les tokens
    await window.electronAPI.store.set('token', '');
    await window.electronAPI.store.set('refreshToken', '');
    
    // Réinitialiser l'état
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
    
    // Afficher la page de connexion avec un message
    showLoginPage();
    showLoginError('Votre session a expiré. Veuillez vous reconnecter.');
    
    // Logger l'événement
    Logger.log('Session expirée, déconnexion forcée');
}

// Rafraîchir le token automatiquement
async function setupTokenRefresh() {
    // Vérifier le token toutes les 30 minutes
    setInterval(async () => {
        if (AppState.isAuthenticated) {
            try {
                const result = await window.electronAPI.api.refreshToken();
                if (result.success) {
                    Logger.log('Token rafraîchi avec succès');
                } else {
                    handleAuthError();
                }
            } catch (error) {
                console.error('Erreur lors du rafraîchissement du token:', error);
                handleAuthError();
            }
        }
    }, 30 * 60 * 1000); // 30 minutes
}

// Vérifier la validité de l'abonnement
async function checkSubscriptionStatus() {
    if (!AppState.isAuthenticated) return null;
    
    try {
        const result = await window.electronAPI.api.verifySubscription();
        
        if (!result.success || !result.isActive) {
            showMessage('Votre abonnement a expiré. Certaines fonctionnalités peuvent être limitées.', 'warning');
        }
        
        return result;
    } catch (error) {
        console.error('Erreur lors de la vérification de l\'abonnement:', error);
        return null;
    }
}

// Gestion du mot de passe
document.getElementById('password')?.addEventListener('keydown', (e) => {
    // Afficher/masquer le mot de passe avec Ctrl+Shift
    if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        const input = e.target;
        input.type = input.type === 'password' ? 'text' : 'password';
        
        // Remasquer après 2 secondes
        setTimeout(() => {
            input.type = 'password';
        }, 2000);
    }
});

// Validation en temps réel
document.getElementById('api-url')?.addEventListener('blur', (e) => {
    const url = e.target.value;
    if (url && !Utils.isValidUrl(url)) {
        e.target.classList.add('error');
        showLoginError('URL invalide');
    } else {
        e.target.classList.remove('error');
        hideLoginError();
    }
});

document.getElementById('username')?.addEventListener('blur', (e) => {
    const username = e.target.value;
    if (username && username.includes('@') && !Utils.isValidEmail(username)) {
        e.target.classList.add('error');
        showLoginError('Email invalide');
    } else {
        e.target.classList.remove('error');
        hideLoginError();
    }
});

// Animation du logo au survol
const loginLogo = document.querySelector('.login-logo');
if (loginLogo) {
    loginLogo.addEventListener('mouseenter', () => {
        loginLogo.style.transform = 'rotate(360deg) scale(1.1)';
    });
    
    loginLogo.addEventListener('mouseleave', () => {
        loginLogo.style.transform = 'rotate(0deg) scale(1)';
    });
}

// Styles CSS pour la page de connexion
const loginStyles = `
<style>
.login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    position: relative;
    overflow: hidden;
}

.login-container::before {
    content: '';
    position: absolute;
    width: 200%;
    height: 200%;
    background-image: 
        radial-gradient(circle at 20% 50%, rgba(255,255,255,0.1) 0%, transparent 50%),
        radial-gradient(circle at 80% 80%, rgba(255,255,255,0.1) 0%, transparent 50%);
    animation: float 20s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    33% { transform: translate(30px, -30px) rotate(120deg); }
    66% { transform: translate(-20px, 20px) rotate(240deg); }
}

.login-box {
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    width: 100%;
    max-width: 400px;
    position: relative;
    z-index: 1;
    animation: slideIn 0.5s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.login-header {
    text-align: center;
    margin-bottom: 30px;
}

.login-logo {
    width: 80px;
    height: 80px;
    margin: 0 auto 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    border-radius: 20px;
    transition: transform 0.5s ease;
    cursor: pointer;
}

.login-logo svg {
    width: 50px;
    height: 50px;
}

.app-title {
    font-size: 28px;
    font-weight: 700;
    color: var(--primary-color);
    margin-bottom: 8px;
}

.app-subtitle {
    color: var(--text-secondary);
    font-size: 16px;
}

.form-control.error {
    border-color: var(--danger-color);
}

.checkbox-label {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
}

.checkbox-label input {
    margin-right: 8px;
}

.btn-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
}
</style>
`;

// Ajouter les styles au document
document.head.insertAdjacentHTML('beforeend', loginStyles);

// Charger les credentials sauvegardés au démarrage
document.addEventListener('DOMContentLoaded', () => {
    loadSavedCredentials();
    setupTokenRefresh();
});

// Export des fonctions pour utilisation externe
window.authManager = {
    handleAuthError,
    checkSubscriptionStatus,
    setupTokenRefresh
};
