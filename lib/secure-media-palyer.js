// secure-media-player.js - Lecteur multimédia sécurisé avec déchiffrement en temps réel
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');

class SecureMediaPlayer {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.activeStreams = new Map();
        this.decryptionCache = new Map();
        this.server = null;
        this.port = 0;
    }
    
    // Initialiser le serveur de streaming local
    async initialize() {
        const express = require('express');
        const app = express();
        
        // Middleware pour gérer les requêtes de range
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.setHeader('Accept-Ranges', 'bytes');
            next();
        });
        
        // Route pour streamer les médias déchiffrés
        app.get('/stream/:streamId', (req, res) => {
            this.handleStreamRequest(req, res);
        });
        
        // Démarrer le serveur sur un port aléatoire
        return new Promise((resolve, reject) => {
            this.server = app.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                console.log(`[SecureMediaPlayer] Serveur de streaming démarré sur le port ${this.port}`);
                resolve(this.port);
            });
            
            this.server.on('error', reject);
        });
    }
    
    // Créer une URL de streaming pour un fichier chiffré
    async createStreamUrl(encryptedFilePath, mimeType = 'video/mp4') {
        try {
            // Vérifier que le fichier existe
            if (!fs.existsSync(encryptedFilePath)) {
                throw new Error('Fichier non trouvé');
            }
            
            // Générer un ID unique pour ce stream
            const streamId = crypto.randomBytes(16).toString('hex');
            
            // Obtenir les informations du fichier
            const stats = fs.statSync(encryptedFilePath);
            
            // Stocker les informations du stream
            this.activeStreams.set(streamId, {
                filePath: encryptedFilePath,
                mimeType,
                fileSize: stats.size,
                createdAt: Date.now(),
                accessCount: 0
            });
            
            // Nettoyer les anciens streams après 1 heure
            setTimeout(() => {
                this.activeStreams.delete(streamId);
                this.decryptionCache.delete(streamId);
            }, 3600000);
            
            // Retourner l'URL de streaming
            return `http://127.0.0.1:${this.port}/stream/${streamId}`;
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur lors de la création de l\'URL:', error);
            throw error;
        }
    }
    
    // Gérer les requêtes de streaming
    handleStreamRequest(req, res) {
        const { streamId } = req.params;
        const streamInfo = this.activeStreams.get(streamId);
        
        if (!streamInfo) {
            return res.status(404).send('Stream non trouvé');
        }
        
        streamInfo.accessCount++;
        
        try {
            const { filePath, mimeType, fileSize } = streamInfo;
            
            // Parser l'en-tête Range
            const range = req.headers.range;
            
            if (range) {
                // Streaming avec support du seeking
                this.handleRangeRequest(req, res, filePath, fileSize, mimeType, streamId);
            } else {
                // Streaming complet
                this.handleFullRequest(req, res, filePath, fileSize, mimeType, streamId);
            }
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur de streaming:', error);
            res.status(500).send('Erreur de streaming');
        }
    }
    
    // Gérer les requêtes avec Range (pour le seeking)
    handleRangeRequest(req, res, filePath, fileSize, mimeType, streamId) {
        const range = req.headers.range;
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType
        });
        
        // Créer un stream de déchiffrement pour la plage demandée
        this.createDecryptStream(filePath, streamId, start, end)
            .then(stream => {
                stream.pipe(res);
            })
            .catch(error => {
                console.error('[SecureMediaPlayer] Erreur de déchiffrement:', error);
                res.status(500).end();
            });
    }
    
    // Gérer les requêtes complètes
    handleFullRequest(req, res, filePath, fileSize, mimeType, streamId) {
        res.writeHead(200, {
            'Content-Length': fileSize - 32, // Soustraire IV et auth tag
            'Content-Type': mimeType
        });
        
        this.createDecryptStream(filePath, streamId)
            .then(stream => {
                stream.pipe(res);
            })
            .catch(error => {
                console.error('[SecureMediaPlayer] Erreur de déchiffrement:', error);
                res.status(500).end();
            });
    }
    
    // Créer un stream de déchiffrement
    async createDecryptStream(filePath, streamId, start = 0, end = null) {
        return new Promise((resolve, reject) => {
            try {
                // Lire l'IV et l'auth tag depuis le cache ou le fichier
                let cryptoInfo = this.decryptionCache.get(streamId);
                
                if (!cryptoInfo) {
                    const fd = fs.openSync(filePath, 'r');
                    
                    // Lire l'IV (16 premiers octets)
                    const ivBuffer = Buffer.alloc(16);
                    fs.readSync(fd, ivBuffer, 0, 16, 0);
                    
                    // Lire l'auth tag (16 derniers octets)
                    const stats = fs.fstatSync(fd);
                    const authTagBuffer = Buffer.alloc(16);
                    fs.readSync(fd, authTagBuffer, 0, 16, stats.size - 16);
                    
                    fs.closeSync(fd);
                    
                    cryptoInfo = {
                        iv: ivBuffer,
                        authTag: authTagBuffer,
                        dataStart: 16,
                        dataEnd: stats.size - 16
                    };
                    
                    this.decryptionCache.set(streamId, cryptoInfo);
                }
                
                // Créer le déchiffreur
                const decipher = crypto.createDecipheriv(
                    'aes-256-gcm',
                    Buffer.from(this.encryptionKey, 'hex'),
                    cryptoInfo.iv
                );
                decipher.setAuthTag(cryptoInfo.authTag);
                
                // Créer un stream de lecture personnalisé
                const readStream = this.createCustomReadStream(
                    filePath,
                    cryptoInfo.dataStart + start,
                    end ? cryptoInfo.dataStart + end : cryptoInfo.dataEnd
                );
                
                // Pipeline de déchiffrement
                const decryptedStream = readStream.pipe(decipher);
                
                resolve(decryptedStream);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Créer un stream de lecture personnalisé pour supporter le seeking
    createCustomReadStream(filePath, start, end) {
        const stream = new Readable({
            read() {}
        });
        
        const fd = fs.openSync(filePath, 'r');
        const bufferSize = 64 * 1024; // 64KB chunks
        let position = start;
        
        const readNextChunk = () => {
            if (position >= end) {
                fs.closeSync(fd);
                stream.push(null); // EOF
                return;
            }
            
            const chunkSize = Math.min(bufferSize, end - position);
            const buffer = Buffer.alloc(chunkSize);
            
            fs.read(fd, buffer, 0, chunkSize, position, (err, bytesRead) => {
                if (err) {
                    fs.closeSync(fd);
                    stream.destroy(err);
                    return;
                }
                
                if (bytesRead === 0) {
                    fs.closeSync(fd);
                    stream.push(null);
                    return;
                }
                
                position += bytesRead;
                stream.push(buffer.slice(0, bytesRead));
                
                // Continuer la lecture
                setImmediate(readNextChunk);
            });
        };
        
        readNextChunk();
        
        return stream;
    }
    
    // Déchiffrer un fichier complet (pour les petits fichiers)
    async decryptFile(encryptedPath, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                const readStream = fs.createReadStream(encryptedPath);
                const writeStream = fs.createWriteStream(outputPath);
                
                let iv = null;
                let encryptedData = Buffer.alloc(0);
                let authTag = null;
                
                readStream.on('data', (chunk) => {
                    if (!iv) {
                        // Les 16 premiers octets sont l'IV
                        iv = chunk.slice(0, 16);
                        encryptedData = Buffer.concat([encryptedData, chunk.slice(16)]);
                    } else {
                        encryptedData = Buffer.concat([encryptedData, chunk]);
                    }
                });
                
                readStream.on('end', () => {
                    // Les 16 derniers octets sont l'auth tag
                    authTag = encryptedData.slice(-16);
                    const ciphertext = encryptedData.slice(0, -16);
                    
                    // Déchiffrer
                    const decipher = crypto.createDecipheriv(
                        'aes-256-gcm',
                        Buffer.from(this.encryptionKey, 'hex'),
                        iv
                    );
                    decipher.setAuthTag(authTag);
                    
                    const decrypted = Buffer.concat([
                        decipher.update(ciphertext),
                        decipher.final()
                    ]);
                    
                    writeStream.write(decrypted);
                    writeStream.end();
                    
                    resolve({
                        success: true,
                        outputPath,
                        size: decrypted.length
                    });
                });
                
                readStream.on('error', reject);
                writeStream.on('error', reject);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Nettoyer et fermer le serveur
    async cleanup() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('[SecureMediaPlayer] Serveur fermé');
                    resolve();
                });
            });
        }
    }
    
    // Obtenir des informations sur un média chiffré
    async getMediaInfo(encryptedPath) {
        try {
            const stats = fs.statSync(encryptedPath);
            
            // Pour les vidéos, on pourrait utiliser ffprobe sur le fichier déchiffré temporaire
            // Pour l'instant, retourner les infos de base
            return {
                size: stats.size - 32, // Taille réelle sans IV et auth tag
                encryptedSize: stats.size,
                createdAt: stats.birthtime,
                modifiedAt: stats.mtime
            };
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur lors de la récupération des infos:', error);
            return null;
        }
    }
    
    // Créer une miniature pour une vidéo
    async createVideoThumbnail(encryptedVideoPath, outputPath) {
        try {
            // Déchiffrer temporairement une petite partie de la vidéo
            const tempPath = path.join(app.getPath('temp'), `temp-${Date.now()}.mp4`);
            
            // Utiliser ffmpeg pour extraire une frame
            // À implémenter avec fluent-ffmpeg
            
            // Nettoyer
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            
            return outputPath;
            
        } catch (error) {
            console.error('[SecureMediaPlayer] Erreur lors de la création de la miniature:', error);
            return null;
        }
    }
}

// Singleton pour le player
let playerInstance = null;

function getSecureMediaPlayer(encryptionKey) {
    if (!playerInstance) {
        playerInstance = new SecureMediaPlayer(encryptionKey);
    }
    return playerInstance;
}

module.exports = {
    SecureMediaPlayer,
    getSecureMediaPlayer
};
