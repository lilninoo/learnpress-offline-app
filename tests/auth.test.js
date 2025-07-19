// auth.test.js - Tests pour le module d'authentification

const { expect } = require('chai');
const sinon = require('sinon');
const { BrowserWindow } = require('electron');

// Mock des APIs Electron
const mockElectronAPI = {
    store: {
        get: sinon.stub(),
        set: sinon.stub()
    },
    api: {
        login: sinon.stub(),
        logout: sinon.stub(),
        verifySubscription: sinon.stub()
    }
};

// Mock du DOM
const { JSDOM } = require('jsdom');
const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
        <form id="login-form">
            <input id="api-url" value="https://test.com">
            <input id="username" value="testuser">
            <input id="password" value="testpass">
            <input id="remember-me" type="checkbox">
            <button id="login-btn">
                <span class="btn-text">Login</span>
                <span class="btn-loader hidden">Loading...</span>
            </button>
        </form>
        <div id="login-error" class="hidden"></div>
    </body>
    </html>
`);

global.window = dom.window;
global.document = dom.window.document;
global.window.electronAPI = mockElectronAPI;

// Utilitaires globaux
global.Utils = {
    isValidUrl: (url) => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
};

global.Logger = {
    log: sinon.stub(),
    error: sinon.stub()
};

global.AppState = {
    currentUser: null,
    isAuthenticated: false
};

// Fonctions globales mockées
global.showDashboard = sinon.stub();
global.showError = sinon.stub();
global.showInfo = sinon.stub();

describe('Module d\'authentification', () => {
    
    beforeEach(() => {
        // Réinitialiser les stubs
        sinon.reset();
        
        // État initial
        AppState.currentUser = null;
        AppState.isAuthenticated = false;
    });
    
    describe('Formulaire de connexion', () => {
        
        it('devrait valider les champs requis', (done) => {
            // Vider les champs
            document.getElementById('api-url').value = '';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            
            // Simuler la soumission
            const form = document.getElementById('login-form');
            const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
            
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                
                // Vérifier que l'erreur est affichée
                const errorDiv = document.getElementById('login-error');
                expect(errorDiv.textContent).to.equal('Veuillez remplir tous les champs');
                expect(errorDiv.classList.contains('hidden')).to.be.false;
                
                done();
            });
            
            form.dispatchEvent(event);
        });
        
        it('devrait valider l\'URL', (done) => {
            // URL invalide
            document.getElementById('api-url').value = 'invalid-url';
            document.getElementById('username').value = 'user';
            document.getElementById('password').value = 'pass';
            
            const form = document.getElementById('login-form');
            const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
            
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                
                const errorDiv = document.getElementById('login-error');
                expect(errorDiv.textContent).to.include('URL invalide');
                
                done();
            });
            
            form.dispatchEvent(event);
        });
        
        it('devrait se connecter avec succès', async () => {
            // Configuration des valeurs
            document.getElementById('api-url').value = 'https://test.com';
            document.getElementById('username').value = 'testuser';
            document.getElementById('password').value = 'testpass';
            document.getElementById('remember-me').checked = true;
            
            // Mock de la réponse API
            mockElectronAPI.api.login.resolves({
                success: true,
                user: {
                    id: 1,
                    username: 'testuser',
                    email: 'test@example.com'
                }
            });
            
            // Simuler la soumission
            const form = document.getElementById('login-form');
            const submitHandler = require('../src/js/auth.js').submitHandler;
            
            await submitHandler({
                preventDefault: () => {},
                target: form
            });
            
            // Vérifications
            expect(mockElectronAPI.api.login.calledOnce).to.be.true;
            expect(mockElectronAPI.api.login.calledWith(
                'https://test.com',
                'testuser',
                'testpass'
            )).to.be.true;
            
            expect(mockElectronAPI.store.set.calledWith('apiUrl', 'https://test.com')).to.be.true;
            expect(mockElectronAPI.store.set.calledWith('username', 'testuser')).to.be.true;
            expect(mockElectronAPI.store.set.calledWith('userId', 1)).to.be.true;
            
            expect(AppState.isAuthenticated).to.be.true;
            expect(AppState.currentUser).to.deep.equal({
                id: 1,
                username: 'testuser',
                email: 'test@example.com'
            });
            
            expect(global.showDashboard.calledOnce).to.be.true;
        });
        
        it('devrait gérer les erreurs de connexion', async () => {
            // Mock d'une erreur
            mockElectronAPI.api.login.resolves({
                success: false,
                error: 'Identifiants incorrects'
            });
            
            const form = document.getElementById('login-form');
            const submitHandler = require('../src/js/auth.js').submitHandler;
            
            await submitHandler({
                preventDefault: () => {},
                target: form
            });
            
            // Vérifications
            const errorDiv = document.getElementById('login-error');
            expect(errorDiv.textContent).to.equal('Identifiants incorrects');
            expect(errorDiv.classList.contains('hidden')).to.be.false;
            
            expect(AppState.isAuthenticated).to.be.false;
            expect(global.showDashboard.called).to.be.false;
        });
        
        it('devrait sauvegarder les credentials si "Se souvenir" est coché', async () => {
            document.getElementById('remember-me').checked = true;
            
            mockElectronAPI.api.login.resolves({
                success: true,
                user: { id: 1 }
            });
            
            const form = document.getElementById('login-form');
            const submitHandler = require('../src/js/auth.js').submitHandler;
            
            await submitHandler({
                preventDefault: () => {},
                target: form
            });
            
            expect(mockElectronAPI.store.set.calledWith('savedApiUrl', 'https://test.com')).to.be.true;
            expect(mockElectronAPI.store.set.calledWith('savedUsername', 'testuser')).to.be.true;
        });
    });
    
    describe('Gestion du token', () => {
        
        it('devrait rafraîchir le token automatiquement', async () => {
            // Mock du rafraîchissement réussi
            mockElectronAPI.api.refreshToken.resolves({
                success: true,
                token: 'new-token'
            });
            
            AppState.isAuthenticated = true;
            
            const { setupTokenRefresh } = require('../src/js/auth.js');
            const clock = sinon.useFakeTimers();
            
            setupTokenRefresh();
            
            // Avancer le temps de 31 minutes
            clock.tick(31 * 60 * 1000);
            
            await Promise.resolve(); // Attendre les promesses
            
            expect(mockElectronAPI.api.refreshToken.calledOnce).to.be.true;
            expect(Logger.log.calledWith('Token rafraîchi avec succès')).to.be.true;
            
            clock.restore();
        });
        
        it('devrait gérer l\'expiration du token', async () => {
            mockElectronAPI.api.refreshToken.rejects(new Error('Token expiré'));
            
            const { handleAuthError } = require('../src/js/auth.js');
            await handleAuthError();
            
            expect(mockElectronAPI.store.set.calledWith('token', '')).to.be.true;
            expect(mockElectronAPI.store.set.calledWith('refreshToken', '')).to.be.true;
            expect(AppState.isAuthenticated).to.be.false;
            expect(AppState.currentUser).to.be.null;
        });
    });
    
    describe('Vérification de l\'abonnement', () => {
        
        it('devrait afficher un avertissement si l\'abonnement est expiré', async () => {
            mockElectronAPI.api.verifySubscription.resolves({
                success: true,
                isActive: false
            });
            
            AppState.isAuthenticated = true;
            
            const { checkSubscriptionStatus } = require('../src/js/auth.js');
            const result = await checkSubscriptionStatus();
            
            expect(result.isActive).to.be.false;
            expect(global.showMessage.calledWith(
                'Votre abonnement a expiré. Certaines fonctionnalités peuvent être limitées.',
                'warning'
            )).to.be.true;
        });
    });
});

// Tests d'intégration
describe('Tests d\'intégration - Authentification', () => {
    
    let app;
    let window;
    
    before(async () => {
        // Démarrer l'application Electron
        const { app: electronApp } = require('electron');
        app = electronApp;
        
        await app.whenReady();
    });
    
    beforeEach(async () => {
        // Créer une nouvelle fenêtre
        window = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, '../preload.js')
            }
        });
        
        await window.loadFile('src/index.html');
    });
    
    afterEach(() => {
        if (window && !window.isDestroyed()) {
            window.close();
        }
    });
    
    after(() => {
        app.quit();
    });
    
    it('devrait charger la page de connexion au démarrage', async () => {
        const title = await window.webContents.executeJavaScript('document.title');
        expect(title).to.equal('LearnPress Offline');
        
        const loginPageVisible = await window.webContents.executeJavaScript(
            'document.getElementById("login-page").classList.contains("active")'
        );
        expect(loginPageVisible).to.be.true;
    });
    
    it('devrait naviguer vers le dashboard après connexion', async () => {
        // Simuler une connexion réussie
        await window.webContents.executeJavaScript(`
            window.electronAPI.api.login = () => Promise.resolve({
                success: true,
                user: { id: 1, username: 'test' }
            });
        `);
        
        // Remplir et soumettre le formulaire
        await window.webContents.executeJavaScript(`
            document.getElementById('api-url').value = 'https://teachmemore.fr';
            document.getElementById('username').value = 'test';
            document.getElementById('password').value = 'test';
            document.getElementById('login-form').dispatchEvent(new Event('submit'));
        `);
        
        // Attendre la navigation
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const dashboardVisible = await window.webContents.executeJavaScript(
            '!document.getElementById("dashboard-page").classList.contains("hidden")'
        );
        expect(dashboardVisible).to.be.true;
    });
});
