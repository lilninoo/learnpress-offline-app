<?php
/**
 * Gestion de l'authentification
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Auth extends COL_LMS_API_Base {
    
    private static $instance = null;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->register_routes();
    }
    
    /**
     * Enregistrer les routes d'authentification
     */
    private function register_routes() {
        // Login
        register_rest_route($this->namespace, '/auth/login', array(
            'methods' => 'POST',
            'callback' => array($this, 'login'),
            'permission_callback' => '__return_true',
            'args' => array(
                'username' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return !empty($param);
                    }
                ),
                'password' => array(
                    'required' => true,
                    'type' => 'string',
                    'validate_callback' => function($param) {
                        return !empty($param);
                    }
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'validate_callback' => function($param) {
                        return !empty($param) && strlen($param) <= 255;
                    }
                ),
                'device_name' => array(
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'default' => ''
                ),
                'device_type' => array(
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'default' => 'desktop'
                )
            )
        ));
        
        // Refresh token
        register_rest_route($this->namespace, '/auth/refresh', array(
            'methods' => 'POST',
            'callback' => array($this, 'refresh_token'),
            'permission_callback' => '__return_true',
            'args' => array(
                'refresh_token' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field'
                )
            )
        ));
        
        // Logout
        register_rest_route($this->namespace, '/auth/logout', array(
            'methods' => 'POST',
            'callback' => array($this, 'logout'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'all_devices' => array(
                    'type' => 'boolean',
                    'default' => false
                )
            )
        ));
        
        // Verify subscription
        register_rest_route($this->namespace, '/auth/verify', array(
            'methods' => 'GET',
            'callback' => array($this, 'verify_subscription'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Liste des appareils
        register_rest_route($this->namespace, '/auth/devices', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_user_devices'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Révoquer un appareil
        register_rest_route($this->namespace, '/auth/devices/(?P<device_id>[a-zA-Z0-9-_]+)', array(
            'methods' => 'DELETE',
            'callback' => array($this, 'revoke_device'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Login
     */
    public function login($request) {
        $username = $request->get_param('username');
        $password = $request->get_param('password');
        $device_id = $request->get_param('device_id');
        $device_name = $request->get_param('device_name');
        $device_type = $request->get_param('device_type');
        
        // Vérifier le rate limiting
        if (!$this->check_rate_limit($username . '_' . ($_SERVER['REMOTE_ADDR'] ?? ''))) {
            return $this->error_response(
                'rate_limited',
                __('Trop de tentatives de connexion. Veuillez réessayer plus tard.', 'col-lms-offline-api'),
                429
            );
        }
        
        // Authentifier l'utilisateur
        $user = wp_authenticate($username, $password);
        
        if (is_wp_error($user)) {
            $this->log_failed_login($username);
            return $this->error_response(
                'invalid_credentials',
                __('Nom d\'utilisateur ou mot de passe incorrect.', 'col-lms-offline-api'),
                401
            );
        }
        
        // Vérifier que l'utilisateur est actif
        if (!is_user_logged_in() && !wp_validate_auth_cookie('', 'logged_in')) {
            // Simuler l'authentification pour les vérifications
            wp_set_current_user($user->ID);
        }
        
        // Vérifier les permissions
        if (!user_can($user->ID, 'col_lms_use_api')) {
            return $this->error_response(
                'insufficient_permissions',
                __('Vous n\'avez pas la permission d\'utiliser l\'API.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Vérifier l'abonnement si PMPro est actif
        $membership_info = $this->get_membership_info($user->ID);
        
        if (get_option('col_lms_require_membership') && !$membership_info['is_active']) {
            return $this->error_response(
                'no_membership',
                __('Un abonnement actif est requis pour utiliser l\'application.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Vérifier le nombre d'appareils
        if (!$this->check_device_limit($user->ID, $device_id)) {
            return $this->error_response(
                'device_limit_exceeded',
                sprintf(
                    __('Nombre maximum d\'appareils (%d) atteint. Supprimez un appareil existant.', 'col-lms-offline-api'),
                    get_option('col_lms_max_devices_per_user', 5)
                ),
                403
            );
        }
        
        // Générer les tokens
        $token_lifetime = get_option('col_lms_token_lifetime', 3600);
        $refresh_lifetime = get_option('col_lms_refresh_token_lifetime', 604800); // 7 jours
        
        $token = COL_LMS_JWT::instance()->create_token($user->ID, $device_id, $token_lifetime);
        $refresh_token = COL_LMS_JWT::instance()->create_refresh_token($user->ID, $device_id);
        
        // Sauvegarder en base
        $token_id = $this->save_token($user->ID, $device_id, $device_name, $device_type, $token, $refresh_token, $token_lifetime);
        
        // Logger la connexion
        $this->log_action('login', array(
            'user_id' => $user->ID,
            'device_id' => $device_id,
            'device_name' => $device_name,
            'token_id' => $token_id
        ));
        
        // Nettoyer les anciennes tentatives
        $this->clear_failed_attempts($username);
        
        return array(
            'success' => true,
            'token' => $token,
            'refresh_token' => $refresh_token,
            'expires_in' => $token_lifetime,
            'refresh_expires_in' => $refresh_lifetime,
            'user' => array(
                'id' => $user->ID,
                'username' => $user->user_login,
                'email' => $user->user_email,
                'display_name' => $user->display_name,
                'avatar_url' => get_avatar_url($user->ID),
                'membership' => $membership_info,
                'roles' => $user->roles,
                'meta' => array(
                    'first_name' => get_user_meta($user->ID, 'first_name', true),
                    'last_name' => get_user_meta($user->ID, 'last_name', true)
                )
            ),
            'device' => array(
                'id' => $device_id,
                'name' => $device_name,
                'type' => $device_type
            )
        );
    }
    
    /**
     * Rafraîchir le token
     */
    public function refresh_token($request) {
        global $wpdb;
        
        $refresh_token = $request->get_param('refresh_token');
        $device_id = $request->get_param('device_id');
        
        // Rechercher le token
        $token_data = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_tokens 
            WHERE refresh_token_hash = %s
            AND device_id = %s
            AND expires_at > NOW()
        ", wp_hash($refresh_token), $device_id));
        
        if (!$token_data) {
            return $this->error_response(
                'invalid_token',
                __('Token de rafraîchissement invalide ou expiré.', 'col-lms-offline-api'),
                401
            );
        }
        
        // Vérifier que l'utilisateur existe toujours
        $user = get_userdata($token_data->user_id);
        if (!$user) {
            return $this->error_response(
                'user_not_found',
                __('Utilisateur non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Vérifier l'abonnement
        $membership_info = $this->get_membership_info($token_data->user_id);
        
        if (get_option('col_lms_require_membership') && !$membership_info['is_active']) {
            return $this->error_response(
                'membership_expired',
                __('Votre abonnement a expiré.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Générer un nouveau token
        $token_lifetime = get_option('col_lms_token_lifetime', 3600);
        $new_token = COL_LMS_JWT::instance()->create_token(
            $token_data->user_id,
            $token_data->device_id,
            $token_lifetime
        );
        
        // Optionnel: générer un nouveau refresh token pour plus de sécurité
        $new_refresh_token = COL_LMS_JWT::instance()->create_refresh_token(
            $token_data->user_id,
            $token_data->device_id
        );
        
        // Mettre à jour en base
        $wpdb->update(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'token_hash' => wp_hash($new_token),
                'refresh_token_hash' => wp_hash($new_refresh_token),
                'expires_at' => date('Y-m-d H:i:s', time() + $token_lifetime),
                'last_used' => current_time('mysql')
            ),
            array('id' => $token_data->id)
        );
        
        $this->log_action('refresh_token', array(
            'device_id' => $device_id,
            'token_id' => $token_data->id
        ));
        
        return array(
            'success' => true,
            'token' => $new_token,
            'refresh_token' => $new_refresh_token,
            'expires_in' => $token_lifetime,
            'user' => array(
                'id' => $user->ID,
                'membership' => $membership_info
            )
        );
    }
    
    /**
     * Déconnexion
     */
    public function logout($request) {
        global $wpdb;
        
        $user_id = $this->get_current_user_id();
        $all_devices = $request->get_param('all_devices');
        
        if ($all_devices) {
            // Supprimer tous les tokens de l'utilisateur
            $deleted = $wpdb->delete(
                $wpdb->prefix . 'col_lms_tokens',
                array('user_id' => $user_id)
            );
            
            $this->log_action('logout_all_devices', array('tokens_deleted' => $deleted));
            
            return array(
                'success' => true,
                'message' => sprintf(
                    __('%d appareils déconnectés.', 'col-lms-offline-api'),
                    $deleted
                )
            );
        } else {
            // Supprimer seulement le token actuel
            $auth_header = $this->get_auth_header();
            if ($auth_header && strpos($auth_header, 'Bearer ') === 0) {
                $token = substr($auth_header, 7);
                $payload = COL_LMS_JWT::instance()->validate_token($token);
                
                if ($payload) {
                    $deleted = $wpdb->delete(
                        $wpdb->prefix . 'col_lms_tokens',
                        array(
                            'user_id' => $user_id,
                            'device_id' => $payload['device_id']
                        )
                    );
                    
                    $this->log_action('logout', array(
                        'device_id' => $payload['device_id'],
                        'tokens_deleted' => $deleted
                    ));
                }
            }
            
            return array(
                'success' => true,
                'message' => __('Déconnexion réussie.', 'col-lms-offline-api')
            );
        }
    }
    
    /**
     * Vérifier l'abonnement
     */
    public function verify_subscription($request) {
        $user_id = $this->get_current_user_id();
        $membership_info = $this->get_membership_info($user_id);
        
        return array(
            'success' => true,
            'is_active' => $membership_info['is_active'],
            'subscription' => $membership_info,
            'permissions' => array(
                'download_courses' => user_can($user_id, 'col_lms_download_courses'),
                'sync_progress' => user_can($user_id, 'col_lms_sync_progress')
            )
        );
    }
    
    /**
     * Obtenir les appareils de l'utilisateur
     */
    public function get_user_devices($request) {
        global $wpdb;
        
        $user_id = $this->get_current_user_id();
        
        $devices = $wpdb->get_results($wpdb->prepare("
            SELECT device_id, device_name, device_type, last_used, created_at,
                   CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END as is_active
            FROM {$wpdb->prefix}col_lms_tokens
            WHERE user_id = %d
            ORDER BY last_used DESC
        ", $user_id));
        
        $formatted_devices = array();
        foreach ($devices as $device) {
            $formatted_devices[] = array(
                'id' => $device->device_id,
                'name' => $device->device_name ?: __('Appareil sans nom', 'col-lms-offline-api'),
                'type' => $device->device_type ?: 'desktop',
                'is_active' => (bool) $device->is_active,
                'last_used' => $device->last_used,
                'created_at' => $device->created_at,
                'last_used_human' => human_time_diff(strtotime($device->last_used))
            );
        }
        
        return array(
            'success' => true,
            'devices' => $formatted_devices,
            'max_devices' => get_option('col_lms_max_devices_per_user', 5)
        );
    }
    
    /**
     * Révoquer un appareil
     */
    public function revoke_device($request) {
        global $wpdb;
        
        $user_id = $this->get_current_user_id();
        $device_id = $request->get_param('device_id');
        
        $deleted = $wpdb->delete(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'user_id' => $user_id,
                'device_id' => $device_id
            )
        );
        
        if ($deleted > 0) {
            $this->log_action('revoke_device', array('device_id' => $device_id));
            
            return array(
                'success' => true,
                'message' => __('Appareil révoqué avec succès.', 'col-lms-offline-api')
            );
        } else {
            return $this->error_response(
                'device_not_found',
                __('Appareil non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
    }
    
    /**
     * Obtenir les infos d'abonnement
     */
    private function get_membership_info($user_id) {
        $info = array(
            'is_active' => true,
            'level_id' => null,
            'level_name' => __('Accès standard', 'col-lms-offline-api'),
            'expires_at' => null,
            'can_download' => true
        );
        
        // Si PMPro est actif
        if (function_exists('pmpro_getMembershipLevelForUser')) {
            $level = pmpro_getMembershipLevelForUser($user_id);
            
            if ($level) {
                $info['level_id'] = $level->id;
                $info['level_name'] = $level->name;
                $info['expires_at'] = $level->enddate ? date('Y-m-d H:i:s', $level->enddate) : null;
                
                // Vérifier les niveaux autorisés
                $allowed_levels = get_option('col_lms_allowed_membership_levels', array());
                if (!empty($allowed_levels) && !in_array($level->id, $allowed_levels)) {
                    $info['is_active'] = false;
                    $info['can_download'] = false;
                }
                
                // Vérifier l'expiration
                if ($level->enddate && $level->enddate < time()) {
                    $info['is_active'] = false;
                    $info['can_download'] = false;
                }
            } else if (get_option('col_lms_require_membership')) {
                $info['is_active'] = false;
                $info['can_download'] = false;
                $info['level_name'] = __('Aucun abonnement', 'col-lms-offline-api');
            }
        }
        
        return $info;
    }
    
    /**
     * Vérifier la limite d'appareils
     */
    private function check_device_limit($user_id, $device_id) {
        global $wpdb;
        
        $max_devices = get_option('col_lms_max_devices_per_user', 5);
        
        $current_devices = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(DISTINCT device_id) 
            FROM {$wpdb->prefix}col_lms_tokens 
            WHERE user_id = %d 
            AND device_id != %s
            AND expires_at > NOW()
        ", $user_id, $device_id));
        
        return $current_devices < $max_devices;
    }
    
    /**
     * Sauvegarder le token
     */
    private function save_token($user_id, $device_id, $device_name, $device_type, $token, $refresh_token, $lifetime) {
        global $wpdb;
        
        // Supprimer l'ancien token du même appareil
        $wpdb->delete(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'user_id' => $user_id,
                'device_id' => $device_id
            )
        );
        
        // Insérer le nouveau
        $result = $wpdb->insert(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'user_id' => $user_id,
                'device_id' => $device_id,
                'device_name' => $device_name,
                'device_type' => $device_type,
                'token_hash' => wp_hash($token),
                'refresh_token_hash' => wp_hash($refresh_token),
                'expires_at' => date('Y-m-d H:i:s', time() + $lifetime),
                'last_used' => current_time('mysql'),
                'created_at' => current_time('mysql')
            )
        );
        
        return $result ? $wpdb->insert_id : false;
    }
    
    /**
     * Logger une tentative échouée
     */
    private function log_failed_login($username) {
        $key = 'col_lms_login_attempts_' . md5($username . ($_SERVER['REMOTE_ADDR'] ?? ''));
        $attempts = get_transient($key) ?: 0;
        
        set_transient($key, $attempts + 1, 300); // 5 minutes
        
        $this->log_action('failed_login', array(
            'username' => $username,
            'attempts' => $attempts + 1
        ));
    }
    
    /**
     * Nettoyer les tentatives échouées
     */
    private function clear_failed_attempts($username) {
        $key = 'col_lms_login_attempts_' . md5($username . ($_SERVER['REMOTE_ADDR'] ?? ''));
        delete_transient($key);
    }
}
