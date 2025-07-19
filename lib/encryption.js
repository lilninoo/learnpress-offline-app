// encryption.js - Module de chiffrement pour sécuriser les données

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class EncryptionManager {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16;  // 128 bits
        this.saltLength = 32; // 256 bits
        this.tagLength = 16; // 128 bits
        this.iterations = 100000; // PBKDF2 iterations
    }

    // Générer une clé de chiffrement sécurisée
    generateKey() {
        return crypto.randomBytes(this.keyLength).toString('hex');
    }

    // Dériver une clé à partir d'un mot de passe
    deriveKey(password, salt) {
        return crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, 'sha256');
    }

    // Chiffrer des données
    encrypt(data, key) {
        try {
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Générer un IV aléatoire
            const iv = crypto.randomBytes(this.ivLength);
            
            // Créer le cipher
            const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
            
            // Chiffrer les données
            const encrypted = Buffer.concat([
                cipher.update(data, 'utf8'),
                cipher.final()
            ]);
            
            // Obtenir le tag d'authentification
            const authTag = cipher.getAuthTag();
            
            // Combiner toutes les parties
            const combined = Buffer.concat([
                iv,
                authTag,
                encrypted
            ]);
            
            return combined.toString('base64');
        } catch (error) {
            throw new Error(`Erreur de chiffrement: ${error.message}`);
        }
    }

    // Déchiffrer des données
    decrypt(encryptedData, key) {
        try {
            // Convertir depuis base64
            const combined = Buffer.from(encryptedData, 'base64');
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Extraire les composants
            const iv = combined.slice(0, this.ivLength);
            const authTag = combined.slice(this.ivLength, this.ivLength + this.tagLength);
            const encrypted = combined.slice(this.ivLength + this.tagLength);
            
            // Créer le decipher
            const decipher = crypto.createDecipheriv(this.algorithm, keyBuffer, iv);
            decipher.setAuthTag(authTag);
            
            // Déchiffrer
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            return decrypted.toString('utf8');
        } catch (error) {
            throw new Error(`Erreur de déchiffrement: ${error.message}`);
        }
    }

    // Chiffrer un fichier
    async encryptFile(inputPath, outputPath, key) {
        try {
            // Lire le fichier
            const data = await fs.readFile(inputPath);
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Générer un IV aléatoire
            const iv = crypto.randomBytes(this.ivLength);
            
            // Créer le cipher
            const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
            
            // Chiffrer les données
            const encrypted = Buffer.concat([
                cipher.update(data),
                cipher.final()
            ]);
            
            // Obtenir le tag d'authentification
            const authTag = cipher.getAuthTag();
            
            // Écrire le fichier chiffré
            await fs.writeFile(outputPath, Buffer.concat([
                iv,
                authTag,
                encrypted
            ]));
            
            return {
                success: true,
                outputPath,
                size: encrypted.length
            };
        } catch (error) {
            throw new Error(`Erreur lors du chiffrement du fichier: ${error.message}`);
        }
    }

    // Déchiffrer un fichier
    async decryptFile(inputPath, outputPath, key) {
        try {
            // Lire le fichier chiffré
            const encryptedData = await fs.readFile(inputPath);
            
            // Convertir la clé si nécessaire
            const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
            
            // Extraire les composants
            const iv = encryptedData.slice(0, this.ivLength);
            const authTag = encryptedData.slice(this.ivLength, this.ivLength + this.tagLength);
            const encrypted = encryptedData.slice(this.ivLength + this.tagLength);
            
            // Créer le decipher
            const decipher = crypto.createDecipheriv(this.algorithm, keyBuffer, iv);
            decipher.setAuthTag(authTag);
            
            // Déchiffrer
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            // Écrire le fichier déchiffré
            await fs.writeFile(outputPath, decrypted);
            
            return {
                success: true,
                outputPath,
                size: decrypted.length
            };
        } catch (error) {
            throw new Error(`Erreur lors du déchiffrement du fichier: ${error.message}`);
        }
    }

    // Chiffrer un stream (pour les gros fichiers)
    createEncryptStream(key, iv = null) {
        const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
        const initVector = iv || crypto.randomBytes(this.ivLength);
        
        const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, initVector);
        
        return {
            cipher,
            iv: initVector,
            getAuthTag: () => cipher.getAuthTag()
        };
    }

    // Déchiffrer un stream
    createDecryptStream(key, iv, authTag) {
        const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
        
        const decipher = crypto.createDecipheriv(this.algorithm, keyBuffer, iv);
        decipher.setAuthTag(authTag);
        
        return decipher;
    }

    // Hash d'un fichier ou d'une chaîne
    async hash(data, algorithm = 'sha256') {
        if (typeof data === 'string') {
            // Hash d'une chaîne
            return crypto.createHash(algorithm).update(data, 'utf8').digest('hex');
        } else if (Buffer.isBuffer(data)) {
            // Hash d'un buffer
            return crypto.createHash(algorithm).update(data).digest('hex');
        } else {
            // Hash d'un fichier
            const fileData = await fs.readFile(data);
            return crypto.createHash(algorithm).update(fileData).digest('hex');
        }
    }

    // Vérifier l'intégrité d'un fichier
    async verifyIntegrity(filePath, expectedHash, algorithm = 'sha256') {
        const actualHash = await this.hash(filePath, algorithm);
        return actualHash === expectedHash;
    }

    // Générer une paire de clés pour signature
    generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        
        return { publicKey, privateKey };
    }

    // Signer des données
    sign(data, privateKey) {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        sign.end();
        return sign.sign(privateKey, 'hex');
    }

    // Vérifier une signature
    verify(data, signature, publicKey) {
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKey, signature, 'hex');
    }

    // Chiffrement hybride pour les gros fichiers
    async encryptLargeFile(inputPath, outputPath, recipientPublicKey) {
        try {
            // Générer une clé AES aléatoire
            const aesKey = this.generateKey();
            
            // Chiffrer la clé AES avec la clé publique RSA
            const encryptedKey = crypto.publicEncrypt(recipientPublicKey, Buffer.from(aesKey, 'hex'));
            
            // Chiffrer le fichier avec AES
            const result = await this.encryptFile(inputPath, outputPath + '.enc', aesKey);
            
            // Sauvegarder la clé chiffrée
            await fs.writeFile(outputPath + '.key', encryptedKey);
            
            return {
                success: true,
                dataFile: outputPath + '.enc',
                keyFile: outputPath + '.key'
            };
        } catch (error) {
            throw new Error(`Erreur lors du chiffrement hybride: ${error.message}`);
        }
    }

    // Déchiffrement hybride
    async decryptLargeFile(dataPath, keyPath, outputPath, privateKey) {
        try {
            // Lire la clé chiffrée
            const encryptedKey = await fs.readFile(keyPath);
            
            // Déchiffrer la clé AES avec la clé privée RSA
            const aesKey = crypto.privateDecrypt(privateKey, encryptedKey).toString('hex');
            
            // Déchiffrer le fichier avec AES
            return await this.decryptFile(dataPath, outputPath, aesKey);
        } catch (error) {
            throw new Error(`Erreur lors du déchiffrement hybride: ${error.message}`);
        }
    }

    // Nettoyer les données sensibles de la mémoire
    secureClear(buffer) {
        if (Buffer.isBuffer(buffer)) {
            buffer.fill(0);
        }
    }

    // Générer un mot de passe sécurisé
    generatePassword(length = 16, options = {}) {
        const defaults = {
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true
        };
        
        const opts = { ...defaults, ...options };
        let charset = '';
        
        if (opts.uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (opts.lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (opts.numbers) charset += '0123456789';
        if (opts.symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        let password = '';
        const randomBytes = crypto.randomBytes(length);
        
        for (let i = 0; i < length; i++) {
            password += charset[randomBytes[i] % charset.length];
        }
        
        return password;
    }
}

// Singleton
let instance = null;

class EncryptionService {
    constructor() {
        if (!instance) {
            instance = new EncryptionManager();
        }
        return instance;
    }
}

module.exports = new EncryptionService();
