markdown# API LearnPress Offline

## Authentification

### Login
POST /wp-json/col-lms/v1/auth/login
Body: {
"username": "string",
"password": "string",
"device_id": "string"
}

##
Response: {
"token": "string",
"refresh_token": "string",
"expires_in": 3600,
"user": {
"id": 1,
"username": "string",
"email": "string",
"membership": {
"level_id": 1,
"level_name": "Premium",
"expires_at": "2024-12-31"
}
}
}

### Vérifier l'abonnement
GET /wp-json/col-lms/v1/auth/verify
Headers: Authorization: Bearer {token}
Response: {
"is_active": true,
"subscription": {
"status": "active",
"level_name": "Premium",
"expires_at": "2024-12-31"
}
}
