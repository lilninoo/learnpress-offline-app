// auth.js - Gestion de l'authentification côté client

// Gestion du formulaire de connexion
document.addEventListener('DOMContentLoaded', async () => {
    // Restaurer les valeurs sauvegardées
    const savedApiUrl = await window.electronAPI.store.get('savedApiUrl');
    const savedUsername = await window.electronAPI.store.get('savedUsername');
    
    if (savedApiUrl) {
        document.getElementById('api-url').value = savedApiUrl;
    }
    
    if (savedUsername) {
        document.getElementById('username').value = savedUsername;
        document.getElementById('remember-me').checked = true;
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

// Gérer la soumission du formulaire de connexion
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const apiUrl = document.getElementById('api-url').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const rememberMe = document.getElementById('remember-me').checked;
    
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');
    const errorDiv = document.getElementById('login-error');
    
    // Validation basique
    if (!apiUrl || !username || !password) {
        errorDiv.textContent = 'Veuillez remplir tous les champs';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    // Afficher le loader
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    loginBtn.disabled = true;
    errorDiv.classList.add('hidden');
    
    try {
        // Sauvegarder l'URL
        await window.electronAPI.store.set('savedApiUrl', apiUrl);
        
        // Tenter la connexion
        const result = await window.electronAPI.api.login(apiUrl, username, password);
        
        if (result.success) {
            // Sauvegarder les préférences
            if (rememberMe) {
                await window.electronAPI.store.set('savedUsername', username);
            } else {
                await window.electronAPI.store.delete('savedUsername');
            }
            
            // Enregistrer le nom d'utilisateur
            await window.electronAPI.store.set('username', username);
            
            // Masquer la page de login et afficher le dashboard
            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('dashboard-page').classList.remove('hidden');
            
            // Afficher le nom d'utilisateur
            document.getElementById('user-display-name').textContent = username;
            
            // Charger les cours
            if (window.loadCourses) {
                window.loadCourses();
            }
            
            // Initialiser la synchronisation
            if (window.syncManager) {
                window.syncManager.initializeSync();
            }
            
            // Mettre à jour le stockage
            if (window.updateStorageInfo) {
                window.updateStorageInfo();
            }
            
        } else {
            // Afficher l'erreur
            let errorMessage = result.error || 'Erreur de connexion';
            
            if (result.requiresMembership) {
                errorMessage = 'Un abonnement actif est requis pour utiliser l\'application';
            } else if (errorMessage.includes('Invalid username')) {
                errorMessage = 'Nom d\'utilisateur ou mot de passe incorrect';
            } else if (errorMessage.includes('network')) {
                errorMessage = 'Erreur de connexion. Vérifiez votre connexion internet';
            }
            
            errorDiv.textContent = errorMessage;
            errorDiv.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('Erreur de connexion:', error);
        errorDiv.textContent = 'Erreur de connexion au serveur';
        errorDiv.classList.remove('hidden');
    } finally {
        // Masquer le loader
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
        loginBtn.disabled = false;
    }
});
