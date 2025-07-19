<?php
/**
 * Plugin Name: COL LMS Offline API
 * Plugin URI: https://votre-site.com/
 * Description: API REST complète pour l'application LearnPress Offline avec support Paid Memberships Pro
 * Version: 1.0.0
 * Author: Votre Nom
 * License: GPL v2 or later
 * Text Domain: col-lms-offline-api
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

// Constantes du plugin
define('COL_LMS_API_VERSION', '1.0.0');
define('COL_LMS_API_PATH', plugin_dir_path(__FILE__));
define('COL_LMS_API_URL', plugin_dir_url(__FILE__));
define('COL_LMS_API_NAMESPACE', 'col-lms/v1');
define('COL_LMS_API_BASENAME', plugin_basename(__FILE__));

// Charger les dépendances
require_once COL_LMS_API_PATH . 'includes/class-jwt.php';
require_once COL_LMS_API_PATH . 'includes/class-api.php';
require_once COL_LMS_API_PATH . 'includes/class-auth.php';
require_once COL_LMS_API_PATH . 'includes/class-courses.php';
require_once COL_LMS_API_PATH . 'includes/class-sync.php';
require_once COL_LMS_API_PATH . 'includes/class-packages.php';
require_once COL_LMS_API_PATH . 'includes/class-migration.php';
require_once COL_LMS_API_PATH . 'includes/class-logger.php';

if (is_admin()) {
    require_once COL_LMS_API_PATH . 'includes/class-admin.php';
}

/**
 * Classe principale du plugin
 */
class COL_LMS_Offline_API {
    
    private static $instance = null;
    
    /**
     * Instance singleton
     */
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    /**
     * Constructeur
     */
    private function __construct() {
        $this->init_hooks();
    }
    
    /**
     * Initialiser les hooks
     */
    private function init_hooks() {
        add_action('init', array($this, 'init'));
        add_action('rest_api_init', array($this, 'init_api'));
        
        // Activation/Désactivation
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
        
        // Tâches CRON
        add_action('col_lms_cleanup_expired', array($this, 'cleanup_expired_data'));
        add_action('col_lms_process_packages', array($this, 'process_pending_packages'));
    }
    
    /**
     * Initialisation
     */
    public function init() {
        // Vérifications des dépendances
        if (!$this->check_dependencies()) {
            return;
        }
        
        // Charger les traductions
        load_plugin_textdomain('col-lms-offline-api', false, dirname(plugin_basename(__FILE__)) . '/languages');
        
        // Initialiser les composants
        COL_LMS_Migration::instance();
        COL_LMS_Logger::instance();
        
        if (is_admin()) {
            COL_LMS_Admin::instance();
        }
    }
    
    /**
     * Initialiser l'API
     */
    public function init_api() {
        COL_LMS_API::instance();
        COL_LMS_Auth::instance();
        COL_LMS_Courses::instance();
        COL_LMS_Sync::instance();
        COL_LMS_Packages::instance();
    }
    
    /**
     * Vérifier les dépendances
     */
    private function check_dependencies() {
        $errors = array();
        
        if (!class_exists('LearnPress')) {
            $errors[] = __('LearnPress est requis pour utiliser ce plugin.', 'col-lms-offline-api');
        }
        
        if (!empty($errors)) {
            add_action('admin_notices', function() use ($errors) {
                foreach ($errors as $error) {
                    echo '<div class="notice notice-error"><p>' . esc_html($error) . '</p></div>';
                }
            });
            return false;
        }
        
        return true;
    }
    
    /**
     * Activation du plugin
     */
    public function activate() {
        // Vérifier les prérequis
        if (!$this->check_dependencies()) {
            wp_die(__('Les dépendances requises ne sont pas satisfaites.', 'col-lms-offline-api'));
        }
        
        // Exécuter la migration
        COL_LMS_Migration::instance()->run();
        
        // Programmer les tâches CRON
        if (!wp_next_scheduled('col_lms_cleanup_expired')) {
            wp_schedule_event(time(), 'hourly', 'col_lms_cleanup_expired');
        }
        
        if (!wp_next_scheduled('col_lms_process_packages')) {
            wp_schedule_event(time(), 'col_lms_every_5_minutes', 'col_lms_process_packages');
        }
        
        // Ajouter les capacités
        $this->add_capabilities();
        
        // Flush les règles de réécriture
        flush_rewrite_rules();
    }
    
    /**
     * Désactivation du plugin
     */
    public function deactivate() {
        // Supprimer les tâches CRON
        wp_clear_scheduled_hook('col_lms_cleanup_expired');
        wp_clear_scheduled_hook('col_lms_process_packages');
        
        // Flush les règles
        flush_rewrite_rules();
    }
    
    /**
     * Ajouter les capacités
     */
    private function add_capabilities() {
        $capabilities = array(
            'col_lms_use_api',
            'col_lms_download_courses',
            'col_lms_sync_progress'
        );
        
        // Admin a toutes les capacités
        $admin = get_role('administrator');
        if ($admin) {
            foreach ($capabilities as $cap) {
                $admin->add_cap($cap);
            }
        }
        
        // Les abonnés ont accès à l'API
        $subscriber = get_role('subscriber');
        if ($subscriber) {
            foreach ($capabilities as $cap) {
                $subscriber->add_cap($cap);
            }
        }
    }
    
    /**
     * Nettoyer les données expirées
     */
    public function cleanup_expired_data() {
        global $wpdb;
        
        // Nettoyer les tokens expirés
        $wpdb->query("
            DELETE FROM {$wpdb->prefix}col_lms_tokens 
            WHERE expires_at < NOW()
        ");
        
        // Nettoyer les packages anciens
        $wpdb->query("
            DELETE FROM {$wpdb->prefix}col_lms_packages 
            WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
            AND status IN ('completed', 'error')
        ");
        
        // Nettoyer les logs anciens
        $wpdb->query("
            DELETE FROM {$wpdb->prefix}col_lms_logs 
            WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        
        COL_LMS_Logger::log('Nettoyage des données expirées effectué');
    }
    
    /**
     * Traiter les packages en attente
     */
    public function process_pending_packages() {
        COL_LMS_Packages::instance()->process_queue();
    }
}

// Ajouter un intervalle CRON personnalisé
add_filter('cron_schedules', function($schedules) {
    $schedules['col_lms_every_5_minutes'] = array(
        'interval' => 300,
        'display' => __('Toutes les 5 minutes', 'col-lms-offline-api')
    );
    return $schedules;
});

// Initialiser le plugin
function col_lms_offline_api() {
    return COL_LMS_Offline_API::instance();
}

// Hook d'initialisation
add_action('plugins_loaded', 'col_lms_offline_api');

// Gérer les téléchargements sécurisés
add_action('init', function() {
    if (isset($_GET['col_lms_download'])) {
        COL_LMS_Packages::instance()->handle_download();
    }
});

// === FICHIER: includes/class-jwt.php ===
<?php
/**
 * Gestion des tokens JWT
 */

class COL_LMS_JWT {
    
    private static $instance = null;
    private $secret_key;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->secret_key = $this->get_secret_key();
    }
    
    /**
     * Obtenir la clé secrète
     */
    private function get_secret_key() {
        $key = get_option('col_lms_jwt_secret');
        
        if (!$key) {
            $key = wp_generate_password(64, true, true);
            update_option('col_lms_jwt_secret', $key);
        }
        
        return $key;
    }
    
    /**
     * Créer un token
     */
    public function create_token($user_id, $device_id, $expiry = 3600) {
        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        
        $payload = json_encode([
            'iss' => get_site_url(),
            'aud' => 'col-lms-offline',
            'iat' => time(),
            'exp' => time() + $expiry,
            'user_id' => $user_id,
            'device_id' => $device_id,
            'nonce' => wp_generate_password(12, false)
        ]);
        
        $base64_header = $this->base64url_encode($header);
        $base64_payload = $this->base64url_encode($payload);
        
        $signature = hash_hmac(
            'sha256', 
            $base64_header . '.' . $base64_payload, 
            $this->secret_key, 
            true
        );
        
        $base64_signature = $this->base64url_encode($signature);
        
        return $base64_header . '.' . $base64_payload . '.' . $base64_signature;
    }
    
    /**
     * Valider un token
     */
    public function validate_token($token) {
        $parts = explode('.', $token);
        
        if (count($parts) !== 3) {
            return false;
        }
        
        list($header, $payload, $signature) = $parts;
        
        // Vérifier la signature
        $expected_signature = $this->base64url_encode(hash_hmac(
            'sha256', 
            $header . '.' . $payload, 
            $this->secret_key, 
            true
        ));
        
        if ($signature !== $expected_signature) {
            return false;
        }
        
        // Décoder le payload
        $payload_data = json_decode($this->base64url_decode($payload), true);
        
        // Vérifier l'expiration
        if (!isset($payload_data['exp']) || $payload_data['exp'] < time()) {
            return false;
        }
        
        // Vérifier l'émetteur
        if (!isset($payload_data['iss']) || $payload_data['iss'] !== get_site_url()) {
            return false;
        }
        
        return $payload_data;
    }
    
    /**
     * Créer un refresh token
     */
    public function create_refresh_token($user_id, $device_id) {
        return wp_hash($user_id . $device_id . wp_generate_password(32, true, true) . time());
    }
    
    /**
     * Base64 URL encode
     */
    private function base64url_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
    
    /**
     * Base64 URL decode
     */
    private function base64url_decode($data) {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}

// === FICHIER: includes/class-api.php ===
<?php
/**
 * Classe de base pour l'API
 */

abstract class COL_LMS_API_Base {
    
    protected $namespace = COL_LMS_API_NAMESPACE;
    
    /**
     * Obtenir l'utilisateur actuel depuis le token
     */
    protected function get_current_user_id() {
        $auth_header = $this->get_auth_header();
        
        if (!$auth_header || strpos($auth_header, 'Bearer ') !== 0) {
            return false;
        }
        
        $token = substr($auth_header, 7);
        $payload = COL_LMS_JWT::instance()->validate_token($token);
        
        if (!$payload) {
            return false;
        }
        
        // Vérifier que le token existe en base
        global $wpdb;
        $exists = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}col_lms_tokens 
            WHERE user_id = %d 
            AND device_id = %s 
            AND token_hash = %s 
            AND expires_at > NOW()
        ", $payload['user_id'], $payload['device_id'], wp_hash($token)));
        
        if (!$exists) {
            return false;
        }
        
        // Mettre à jour la dernière utilisation
        $wpdb->update(
            $wpdb->prefix . 'col_lms_tokens',
            ['last_used' => current_time('mysql')],
            [
                'user_id' => $payload['user_id'],
                'device_id' => $payload['device_id']
            ]
        );
        
        return $payload['user_id'];
    }
    
    /**
     * Obtenir le header d'autorisation
     */
    protected function get_auth_header() {
        $headers = getallheaders();
        
        if (isset($headers['Authorization'])) {
            return $headers['Authorization'];
        }
        
        if (isset($headers['authorization'])) {
            return $headers['authorization'];
        }
        
        // Fallback pour certains serveurs
        if (function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            if (isset($headers['Authorization'])) {
                return $headers['Authorization'];
            }
        }
        
        return false;
    }
    
    /**
     * Vérifier l'authentification
     */
    public function check_auth($request) {
        return $this->get_current_user_id() !== false;
    }
    
    /**
     * Vérifier les permissions
     */
    protected function check_permission($capability = 'col_lms_use_api') {
        $user_id = $this->get_current_user_id();
        
        if (!$user_id) {
            return false;
        }
        
        return user_can($user_id, $capability);
    }
    
    /**
     * Réponse d'erreur standard
     */
    protected function error_response($code, $message, $status = 400) {
        return new WP_Error($code, $message, array('status' => $status));
    }
    
    /**
     * Logger une action
     */
    protected function log_action($action, $data = array()) {
        $user_id = $this->get_current_user_id();
        
        COL_LMS_Logger::log($action, array_merge($data, [
            'user_id' => $user_id,
            'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? ''
        ]));
    }
}

class COL_LMS_API extends COL_LMS_API_Base {
    
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
     * Enregistrer les routes générales
     */
    private function register_routes() {
        // Route de test
        register_rest_route($this->namespace, '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_status'),
            'permission_callback' => '__return_true'
        ));
        
        // Route de vérification avec auth
        register_rest_route($this->namespace, '/verify', array(
            'methods' => 'GET',
            'callback' => array($this, 'verify_access'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Obtenir le statut de l'API
     */
    public function get_status($request) {
        return array(
            'status' => 'active',
            'version' => COL_LMS_API_VERSION,
            'endpoints' => array(
                'auth' => home_url('/wp-json/' . $this->namespace . '/auth'),
                'courses' => home_url('/wp-json/' . $this->namespace . '/courses'),
                'sync' => home_url('/wp-json/' . $this->namespace . '/sync')
            )
        );
    }
    
    /**
     * Vérifier l'accès
     */
    public function verify_access($request) {
        $user_id = $this->get_current_user_id();
        $user = get_userdata($user_id);
        
        return array(
            'success' => true,
            'user' => array(
                'id' => $user->ID,
                'username' => $user->user_login,
                'email' => $user->user_email,
                'display_name' => $user->display_name
            )
        );
    }
}

// === FICHIER: includes/class-auth.php ===
<?php
/**
 * Gestion de l'authentification
 */

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
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'password' => array(
                    'required' => true,
                    'type' => 'string'
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'device_name' => array(
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field'
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
                )
            )
        ));
        
        // Logout
        register_rest_route($this->namespace, '/auth/logout', array(
            'methods' => 'POST',
            'callback' => array($this, 'logout'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Verify subscription
        register_rest_route($this->namespace, '/auth/verify', array(
            'methods' => 'GET',
            'callback' => array($this, 'verify_subscription'),
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
        
        // Limiter les tentatives de connexion
        if ($this->is_rate_limited($username)) {
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
                __('Nombre maximum d\'appareils atteint.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Générer les tokens
        $token_lifetime = get_option('col_lms_token_lifetime', 3600);
        $token = COL_LMS_JWT::instance()->create_token($user->ID, $device_id, $token_lifetime);
        $refresh_token = COL_LMS_JWT::instance()->create_refresh_token($user->ID, $device_id);
        
        // Sauvegarder en base
        $this->save_token($user->ID, $device_id, $device_name, $token, $refresh_token, $token_lifetime);
        
        // Logger la connexion
        $this->log_action('login', array(
            'user_id' => $user->ID,
            'device_id' => $device_id
        ));
        
        return array(
            'token' => $token,
            'refresh_token' => $refresh_token,
            'expires_in' => $token_lifetime,
            'user' => array(
                'id' => $user->ID,
                'username' => $user->user_login,
                'email' => $user->user_email,
                'display_name' => $user->display_name,
                'membership' => $membership_info
            )
        );
    }
    
    /**
     * Rafraîchir le token
     */
    public function refresh_token($request) {
        global $wpdb;
        $refresh_token = $request->get_param('refresh_token');
        
        // Rechercher le token
        $token_data = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_tokens 
            WHERE refresh_token_hash = %s
        ", wp_hash($refresh_token)));
        
        if (!$token_data) {
            return $this->error_response(
                'invalid_token',
                __('Token de rafraîchissement invalide.', 'col-lms-offline-api'),
                401
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
        
        // Mettre à jour en base
        $wpdb->update(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'token_hash' => wp_hash($new_token),
                'expires_at' => date('Y-m-d H:i:s', time() + $token_lifetime),
                'last_used' => current_time('mysql')
            ),
            array('id' => $token_data->id)
        );
        
        return array(
            'token' => $new_token,
            'expires_in' => $token_lifetime
        );
    }
    
    /**
     * Déconnexion
     */
    public function logout($request) {
        global $wpdb;
        $user_id = $this->get_current_user_id();
        
        // Supprimer tous les tokens de l'utilisateur
        $wpdb->delete(
            $wpdb->prefix . 'col_lms_tokens',
            array('user_id' => $user_id)
        );
        
        $this->log_action('logout');
        
        return array('success' => true);
    }
    
    /**
     * Vérifier l'abonnement
     */
    public function verify_subscription($request) {
        $user_id = $this->get_current_user_id();
        $membership_info = $this->get_membership_info($user_id);
        
        return array(
            'is_active' => $membership_info['is_active'],
            'subscription' => $membership_info
        );
    }
    
    /**
     * Obtenir les infos d'abonnement
     */
    private function get_membership_info($user_id) {
        $info = array(
            'is_active' => true,
            'level_id' => null,
            'level_name' => __('Accès standard', 'col-lms-offline-api'),
            'expires_at' => null
        );
        
        // Si PMPro est actif
        if (function_exists('pmpro_getMembershipLevelForUser')) {
            $level = pmpro_getMembershipLevelForUser($user_id);
            
            if ($level) {
                $info['level_id'] = $level->id;
                $info['level_name'] = $level->name;
                $info['expires_at'] = $level->enddate;
                
                // Vérifier les niveaux autorisés
                $allowed_levels = get_option('col_lms_allowed_membership_levels', array());
                if (!empty($allowed_levels) && !in_array($level->id, $allowed_levels)) {
                    $info['is_active'] = false;
                }
                
                // Vérifier l'expiration
                if ($level->enddate && strtotime($level->enddate) < time()) {
                    $info['is_active'] = false;
                }
            } else {
                $info['is_active'] = false;
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
    private function save_token($user_id, $device_id, $device_name, $token, $refresh_token, $lifetime) {
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
        $wpdb->insert(
            $wpdb->prefix . 'col_lms_tokens',
            array(
                'user_id' => $user_id,
                'device_id' => $device_id,
                'device_name' => $device_name,
                'token_hash' => wp_hash($token),
                'refresh_token_hash' => wp_hash($refresh_token),
                'expires_at' => date('Y-m-d H:i:s', time() + $lifetime),
                'last_used' => current_time('mysql'),
                'created_at' => current_time('mysql')
            )
        );
    }
    
    /**
     * Vérifier le rate limiting
     */
    private function is_rate_limited($username) {
        if (!get_option('col_lms_enable_rate_limiting')) {
            return false;
        }
        
        $key = 'col_lms_login_attempts_' . md5($username . $_SERVER['REMOTE_ADDR']);
        $attempts = get_transient($key) ?: 0;
        
        if ($attempts >= 5) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Logger une tentative échouée
     */
    private function log_failed_login($username) {
        $key = 'col_lms_login_attempts_' . md5($username . $_SERVER['REMOTE_ADDR']);
        $attempts = get_transient($key) ?: 0;
        
        set_transient($key, $attempts + 1, 300); // 5 minutes
        
        $this->log_action('failed_login', array('username' => $username));
    }
}

// === FICHIER: includes/class-courses.php ===
<?php
/**
 * Gestion des cours
 */

class COL_LMS_Courses extends COL_LMS_API_Base {
    
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
     * Enregistrer les routes
     */
    private function register_routes() {
        // Liste des cours
        register_rest_route($this->namespace, '/courses', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_courses'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'page' => array(
                    'default' => 1,
                    'sanitize_callback' => 'absint'
                ),
                'per_page' => array(
                    'default' => 20,
                    'sanitize_callback' => 'absint'
                ),
                'search' => array(
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'category' => array(
                    'sanitize_callback' => 'absint'
                )
            )
        ));
        
        // Détails d'un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_details'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'id' => array(
                    'validate_callback' => function($param) {
                        return is_numeric($param);
                    }
                )
            )
        ));
        
        // Médias d'un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/media', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_media'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Créer un package
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/package', array(
            'methods' => 'POST',
            'callback' => array($this, 'create_package'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'options' => array(
                    'type' => 'object',
                    'default' => array()
                )
            )
        ));
        
        // Contenu d'une leçon
        register_rest_route($this->namespace, '/lessons/(?P<id>\d+)/content', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_lesson_content'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Obtenir la liste des cours
     */
    public function get_courses($request) {
        $user_id = $this->get_current_user_id();
        
        $args = array(
            'post_type' => 'lp_course',
            'posts_per_page' => $request->get_param('per_page'),
            'paged' => $request->get_param('page'),
            'post_status' => 'publish'
        );
        
        // Recherche
        if ($search = $request->get_param('search')) {
            $args['s'] = $search;
        }
        
        // Catégorie
        if ($category = $request->get_param('category')) {
            $args['tax_query'] = array(
                array(
                    'taxonomy' => 'course_category',
                    'field' => 'term_id',
                    'terms' => $category
                )
            );
        }
        
        // Appliquer les filtres selon l'abonnement
        $args = $this->apply_membership_filters($args, $user_id);
        
        $query = new WP_Query($args);
        $courses = array();
        
        foreach ($query->posts as $post) {
            // Vérifier l'accès
            if (!$this->user_can_access_course($user_id, $post->ID)) {
                continue;
            }
            
            $courses[] = $this->format_course_data($post->ID);
        }
        
        return array(
            'courses' => $courses,
            'total' => $query->found_posts,
            'pages' => $query->max_num_pages
        );
    }
    
    /**
     * Obtenir les détails d'un cours
     */
    public function get_course_details($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return $this->error_response(
                'not_found',
                __('Cours non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Formater les données complètes
        $course_data = $this->format_course_data($course_id, true);
        
        // Ajouter le curriculum
        $course_data['sections'] = $this->get_course_curriculum($course_id);
        
        $this->log_action('view_course', array('course_id' => $course_id));
        
        return array('course' => $course_data);
    }
    
    /**
     * Obtenir les médias d'un cours
     */
    public function get_course_media($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        $media = $this->collect_course_media($course_id);
        
        return array(
            'media' => $media,
            'count' => count($media),
            'total_size' => array_sum(array_column($media, 'size'))
        );
    }
    
    /**
     * Créer un package de téléchargement
     */
    public function create_package($request) {
        $course_id = $request->get_param('id');
        $options = $request->get_param('options');
        $user_id = $this->get_current_user_id();
        
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à ce cours.', 'col-lms-offline-api'),
                403
            );
        }
        
        // Créer le package
        $package_id = COL_LMS_Packages::instance()->create($course_id, $user_id, $options);
        
        if (is_wp_error($package_id)) {
            return $package_id;
        }
        
        $this->log_action('create_package', array(
            'course_id' => $course_id,
            'package_id' => $package_id
        ));
        
        return array(
            'package_id' => $package_id,
            'status' => 'processing',
            'message' => __('Package en cours de création.', 'col-lms-offline-api')
        );
    }
    
    /**
     * Obtenir le contenu d'une leçon
     */
    public function get_lesson_content($request) {
        $lesson_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès via le cours parent
        $course_id = $this->get_lesson_course($lesson_id);
        
        if (!$course_id || !$this->user_can_access_course($user_id, $course_id)) {
            return $this->error_response(
                'no_access',
                __('Vous n\'avez pas accès à cette leçon.', 'col-lms-offline-api'),
                403
            );
        }
        
        $lesson = learn_press_get_lesson($lesson_id);
        if (!$lesson) {
            return $this->error_response(
                'not_found',
                __('Leçon non trouvée.', 'col-lms-offline-api'),
                404
            );
        }
        
        $lesson_data = array(
            'id' => $lesson_id,
            'title' => $lesson->get_title(),
            'content' => apply_filters('the_content', $lesson->get_content()),
            'duration' => $lesson->get_duration(),
            'attachments' => $this->get_lesson_attachments($lesson_id),
            'video_url' => get_post_meta($lesson_id, '_lp_lesson_video_url', true),
            'materials' => $this->get_lesson_materials($lesson_id)
        );
        
        $this->log_action('view_lesson', array('lesson_id' => $lesson_id));
        
        return array('lesson' => $lesson_data);
    }
    
    /**
     * Formater les données d'un cours
     */
    private function format_course_data($course_id, $detailed = false) {
        $course = learn_press_get_course($course_id);
        $post = get_post($course_id);
        $instructor = get_userdata($post->post_author);
        
        $data = array(
            'id' => $course_id,
            'title' => $course->get_title(),
            'description' => $course->get_description(),
            'thumbnail' => get_the_post_thumbnail_url($course_id, 'large'),
            'instructor' => array(
                'id' => $instructor->ID,
                'name' => $instructor->display_name,
                'avatar' => get_avatar_url($instructor->ID)
            ),
            'lessons_count' => $course->count_items('lp_lesson'),
            'quizzes_count' => $course->count_items('lp_quiz'),
            'sections_count' => count($course->get_sections()),
            'duration' => $course->get_duration(),
            'level' => get_post_meta($course_id, '_lp_level', true) ?: 'all',
            'students' => $course->get_users_enrolled(),
            'price' => $course->get_price(),
            'is_free' => $course->is_free(),
            'categories' => wp_get_post_terms($course_id, 'course_category', array('fields' => 'names')),
            'tags' => wp_get_post_terms($course_id, 'course_tag', array('fields' => 'names')),
            'version' => get_post_meta($course_id, '_lp_course_version', true) ?: 1,
            'last_updated' => $post->post_modified
        );
        
        if ($detailed) {
            $data['content'] = apply_filters('the_content', $course->get_content());
            $data['requirements'] = get_post_meta($course_id, '_lp_requirements', true);
            $data['key_features'] = get_post_meta($course_id, '_lp_key_features', true);
            $data['target_audiences'] = get_post_meta($course_id, '_lp_target_audiences', true);
            $data['faqs'] = get_post_meta($course_id, '_lp_faqs', true);
        }
        
        // Ajouter la progression de l'utilisateur
        $user_id = $this->get_current_user_id();
        if ($user_id) {
            $user = learn_press_get_user($user_id);
            $course_data = $user->get_course_data($course_id);
            
            if ($course_data) {
                $data['user_progress'] = array(
                    'status' => $course_data->get_status(),
                    'progress' => $course_data->get_results('result'),
                    'start_time' => $course_data->get_start_time(),
                    'expiration_time' => $course_data->get_expiration_time()
                );
            }
        }
        
        return $data;
    }
    
    /**
     * Obtenir le curriculum d'un cours
     */
    private function get_course_curriculum($course_id) {
        $course = learn_press_get_course($course_id);
        $curriculum = $course->get_curriculum();
        $sections_data = array();
        
        if (!$curriculum) {
            return $sections_data;
        }
        
        foreach ($curriculum as $section) {
            $section_data = array(
                'id' => $section->get_id(),
                'title' => $section->get_title(),
                'description' => $section->get_description(),
                'order' => $section->get_order(),
                'items' => array()
            );
            
            $items = $section->get_items();
            if ($items) {
                foreach ($items as $item) {
                    $item_data = array(
                        'id' => $item->get_id(),
                        'title' => $item->get_title(),
                        'type' => $item->get_item_type(),
                        'duration' => $item->get_duration(),
                        'preview' => $item->is_preview(),
                        'order' => $item->get_order()
                    );
                    
                    // Ajouter des données spécifiques selon le type
                    if ($item->get_item_type() === 'lp_quiz') {
                        $quiz = learn_press_get_quiz($item->get_id());
                        $item_data['questions_count'] = $quiz->count_questions();
                        $item_data['passing_grade'] = $quiz->get_passing_grade();
                        $item_data['retake_count'] = $quiz->get_retake_count();
                    }
                    
                    $section_data['items'][] = $item_data;
                }
            }
            
            $sections_data[] = $section_data;
        }
        
        return $sections_data;
    }
    
    /**
     * Collecter les médias d'un cours
     */
    private function collect_course_media($course_id) {
        $media = array();
        $course = learn_press_get_course($course_id);
        
        // Image principale
        if ($thumbnail_id = get_post_thumbnail_id($course_id)) {
            $media[] = $this->format_media_data($thumbnail_id, 'course_thumbnail');
        }
        
        // Parcourir le curriculum
        $curriculum = $course->get_curriculum();
        if ($curriculum) {
            foreach ($curriculum as $section) {
                $items = $section->get_items();
                if ($items) {
                    foreach ($items as $item) {
                        if ($item->get_item_type() === 'lp_lesson') {
                            $lesson_media = $this->get_lesson_media($item->get_id());
                            $media = array_merge($media, $lesson_media);
                        }
                    }
                }
            }
        }
        
        return $media;
    }
    
    /**
     * Obtenir les médias d'une leçon
     */
    private function get_lesson_media($lesson_id) {
        $media = array();
        
        // Vidéo externe
        $video_url = get_post_meta($lesson_id, '_lp_lesson_video_url', true);
        if ($video_url) {
            $media[] = array(
                'id' => 'video_' . $lesson_id,
                'type' => 'video_external',
                'url' => $video_url,
                'lesson_id' => $lesson_id
            );
        }
        
        // Pièces jointes
        $attachments = get_posts(array(
            'post_type' => 'attachment',
            'posts_per_page' => -1,
            'post_parent' => $lesson_id
        ));
        
        foreach ($attachments as $attachment) {
            $media[] = $this->format_media_data($attachment->ID, 'lesson_attachment', $lesson_id);
        }
        
        // Matériaux supplémentaires
        $materials = get_post_meta($lesson_id, '_lp_lesson_materials', true);
        if ($materials && is_array($materials)) {
            foreach ($materials as $index => $material) {
                if (!empty($material['file_id'])) {
                    $media[] = $this->format_media_data($material['file_id'], 'lesson_material', $lesson_id);
                }
            }
        }
        
        return $media;
    }
    
    /**
     * Formater les données d'un média
     */
    private function format_media_data($attachment_id, $context = '', $parent_id = 0) {
        $file_path = get_attached_file($attachment_id);
        $url = wp_get_attachment_url($attachment_id);
        $metadata = wp_get_attachment_metadata($attachment_id);
        
        return array(
            'id' => $attachment_id,
            'title' => get_the_title($attachment_id),
            'filename' => basename($file_path),
            'url' => $url,
            'type' => get_post_mime_type($attachment_id),
            'size' => filesize($file_path),
            'context' => $context,
            'parent_id' => $parent_id,
            'metadata' => $metadata
        );
    }
    
    /**
     * Obtenir les pièces jointes d'une leçon
     */
    private function get_lesson_attachments($lesson_id) {
        $attachments = array();
        
        // Récupérer les attachments WordPress
        $media = get_posts(array(
            'post_type' => 'attachment',
            'posts_per_page' => -1,
            'post_parent' => $lesson_id
        ));
        
        foreach ($media as $attachment) {
            $attachments[] = array(
                'id' => $attachment->ID,
                'title' => $attachment->post_title,
                'filename' => basename(get_attached_file($attachment->ID)),
                'url' => wp_get_attachment_url($attachment->ID),
                'type' => $attachment->post_mime_type,
                'size' => filesize(get_attached_file($attachment->ID))
            );
        }
        
        return $attachments;
    }
    
    /**
     * Obtenir les matériaux d'une leçon
     */
    private function get_lesson_materials($lesson_id) {
        $materials = get_post_meta($lesson_id, '_lp_lesson_materials', true);
        
        if (!$materials || !is_array($materials)) {
            return array();
        }
        
        $formatted_materials = array();
        
        foreach ($materials as $material) {
            if (isset($material['file_id']) && $material['file_id']) {
                $formatted_materials[] = array(
                    'id' => $material['file_id'],
                    'title' => $material['title'] ?? get_the_title($material['file_id']),
                    'url' => wp_get_attachment_url($material['file_id']),
                    'type' => get_post_mime_type($material['file_id'])
                );
            }
        }
        
        return $formatted_materials;
    }
    
    /**
     * Vérifier l'accès à un cours
     */
    private function user_can_access_course($user_id, $course_id) {
        // Admin a toujours accès
        if (user_can($user_id, 'manage_options')) {
            return true;
        }
        
        // Instructeur du cours
        if (get_post_field('post_author', $course_id) == $user_id) {
            return true;
        }
        
        // Vérifier l'inscription LearnPress
        $user = learn_press_get_user($user_id);
        $course_data = $user->get_course_data($course_id);
        
        if ($course_data && in_array($course_data->get_status(), array('enrolled', 'finished'))) {
            return true;
        }
        
        // Vérifier avec PMPro si actif
        if (function_exists('pmpro_has_membership_access')) {
            $hasaccess = pmpro_has_membership_access($course_id, $user_id, true);
            if ($hasaccess[0]) {
                return true;
            }
        }
        
        // Cours gratuit ou preview
        $course = learn_press_get_course($course_id);
        if ($course && ($course->is_free() || $course->is_preview())) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Obtenir le cours d'une leçon
     */
    private function get_lesson_course($lesson_id) {
        global $wpdb;
        
        $course_id = $wpdb->get_var($wpdb->prepare("
            SELECT s.section_course_id 
            FROM {$wpdb->prefix}learnpress_section_items si
            JOIN {$wpdb->prefix}learnpress_sections s ON si.section_id = s.section_id
            WHERE si.item_id = %d
            LIMIT 1
        ", $lesson_id));
        
        return $course_id;
    }
    
    /**
     * Appliquer les filtres d'abonnement
     */
    private function apply_membership_filters($args, $user_id) {
        if (!function_exists('pmpro_getMembershipLevelForUser')) {
            return $args;
        }
        
        $level = pmpro_getMembershipLevelForUser($user_id);
        
        if (!$level) {
            // Utilisateur sans abonnement - montrer seulement les cours gratuits
            $args['meta_query'] = array(
                array(
                    'key' => '_lp_price',
                    'value' => '0',
                    'compare' => '='
                )
            );
        } else {
            // Filtrer selon les catégories autorisées du niveau
            $allowed_categories = get_option('pmpro_level_' . $level->id . '_categories', array());
            
            if (!empty($allowed_categories)) {
                $args['tax_query'][] = array(
                    'taxonomy' => 'course_category',
                    'field' => 'term_id',
                    'terms' => $allowed_categories
                );
            }
        }
        
        return $args;
    }
}

// === FICHIER: includes/class-sync.php ===
<?php
/**
 * Gestion de la synchronisation
 */

class COL_LMS_Sync extends COL_LMS_API_Base {
    
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
     * Enregistrer les routes
     */
    private function register_routes() {
        // Synchronisation de la progression
        register_rest_route($this->namespace, '/progress/sync', array(
            'methods' => 'POST',
            'callback' => array($this, 'sync_progress'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'progress_data' => array(
                    'required' => true,
                    'type' => 'object'
                )
            )
        ));
        
        // Obtenir les données à synchroniser
        register_rest_route($this->namespace, '/sync/pull', array(
            'methods' => 'GET',
            'callback' => array($this, 'pull_sync_data'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'since' => array(
                    'type' => 'string',
                    'format' => 'date-time'
                )
            )
        ));
        
        // Statut de synchronisation
        register_rest_route($this->namespace, '/sync/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_sync_status'),
            'permission_callback' => array($this, 'check_auth')
        ));
    }
    
    /**
     * Synchroniser la progression
     */
    public function sync_progress($request) {
        $user_id = $this->get_current_user_id();
        $progress_data = $request->get_param('progress_data');
        
        $results = array(
            'synced' => array(),
            'errors' => array()
        );
        
        // Synchroniser les leçons
        if (!empty($progress_data['lessons'])) {
            $lesson_results = $this->sync_lessons($user_id, $progress_data['lessons']);
            $results['synced'] = array_merge($results['synced'], $lesson_results['synced']);
            $results['errors'] = array_merge($results['errors'], $lesson_results['errors']);
        }
        
        // Synchroniser les quiz
        if (!empty($progress_data['quizzes'])) {
            $quiz_results = $this->sync_quizzes($user_id, $progress_data['quizzes']);
            $results['synced'] = array_merge($results['synced'], $quiz_results['synced']);
            $results['errors'] = array_merge($results['errors'], $quiz_results['errors']);
        }
        
        // Synchroniser les devoirs
        if (!empty($progress_data['assignments'])) {
            $assignment_results = $this->sync_assignments($user_id, $progress_data['assignments']);
            $results['synced'] = array_merge($results['synced'], $assignment_results['synced']);
            $results['errors'] = array_merge($results['errors'], $assignment_results['errors']);
        }
        
        // Enregistrer la synchronisation
        $this->record_sync($user_id, $results);
        
        $this->log_action('sync_progress', array(
            'synced_count' => count($results['synced']),
            'error_count' => count($results['errors'])
        ));
        
        return array(
            'success' => true,
            'synced' => $results['synced'],
            'errors' => $results['errors'],
            'message' => sprintf(
                __('%d éléments synchronisés, %d erreurs', 'col-lms-offline-api'),
                count($results['synced']),
                count($results['errors'])
            )
        );
    }
    
    /**
     * Récupérer les données à synchroniser
     */
    public function pull_sync_data($request) {
        $user_id = $this->get_current_user_id();
        $since = $request->get_param('since');
        
        $data = array(
            'courses' => $this->get_user_courses_data($user_id, $since),
            'progress' => $this->get_user_progress_data($user_id, $since),
            'quizzes' => $this->get_user_quiz_data($user_id, $since),
            'certificates' => $this->get_user_certificates($user_id, $since),
            'last_sync' => current_time('mysql')
        );
        
        return $data;
    }
    
    /**
     * Obtenir le statut de synchronisation
     */
    public function get_sync_status($request) {
        $user_id = $this->get_current_user_id();
        
        $last_sync = get_user_meta($user_id, '_col_lms_last_sync', true);
        $pending_items = $this->get_pending_sync_items($user_id);
        
        return array(
            'last_sync' => $last_sync,
            'pending_items' => count($pending_items),
            'sync_enabled' => get_option('col_lms_enable_progress_sync', true)
        );
    }
    
    /**
     * Synchroniser les leçons
     */
    private function sync_lessons($user_id, $lessons_data) {
        $results = array(
            'synced' => array(),
            'errors' => array()
        );
        
        foreach ($lessons_data as $lesson_data) {
            try {
                $lesson_id = intval($lesson_data['id']);
                
                // Vérifier l'accès
                $course_id = $this->get_lesson_course($lesson_id);
                if (!$this->user_can_access_course($user_id, $course_id)) {
                    throw new Exception(__('Accès non autorisé', 'col-lms-offline-api'));
                }
                
                // Obtenir les données utilisateur
                $user = learn_press_get_user($user_id);
                $user_item = $user->get_item($lesson_id, $course_id);
                
                if (!$user_item) {
                    // Créer l'item s'il n'existe pas
                    $user_item = $user->start_item($lesson_id, $course_id);
                }
                
                if ($user_item) {
                    // Mettre à jour la progression
                    if (isset($lesson_data['progress'])) {
                        $user_item->update_meta('progress', intval($lesson_data['progress']));
                    }
                    
                    // Mettre à jour le statut
                    if (isset($lesson_data['completed']) && $lesson_data['completed']) {
                        $user_item->complete();
                    }
                    
                    // Mettre à jour le temps passé
                    if (isset($lesson_data['time_spent'])) {
                        $current_time = $user_item->get_meta('time_spent', 0);
                        $user_item->update_meta('time_spent', $current_time + intval($lesson_data['time_spent']));
                    }
                    
                    $results['synced'][] = array(
                        'type' => 'lesson',
                        'id' => $lesson_id
                    );
                }
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => 'lesson',
                    'id' => $lesson_data['id'],
                    'error' => $e->getMessage()
                );
            }
        }
        
        return $results;
    }
    
    /**
     * Synchroniser les quiz
     */
    private function sync_quizzes($user_id, $quizzes_data) {
        $results = array(
            'synced' => array(),
            'errors' => array()
        );
        
        foreach ($quizzes_data as $quiz_data) {
            try {
                $quiz_id = intval($quiz_data['id']);
                
                // Vérifier l'accès
                $course_id = $this->get_lesson_course($quiz_id);
                if (!$this->user_can_access_course($user_id, $course_id)) {
                    throw new Exception(__('Accès non autorisé', 'col-lms-offline-api'));
                }
                
                // Obtenir les données utilisateur
                $user = learn_press_get_user($user_id);
                $user_item = $user->get_item($quiz_id, $course_id);
                
                if (!$user_item) {
                    $user_item = $user->start_item($quiz_id, $course_id);
                }
                
                if ($user_item && isset($quiz_data['answers'])) {
                    // Sauvegarder les réponses
                    foreach ($quiz_data['answers'] as $question_id => $answer) {
                        $user_item->add_question_answer($question_id, $answer);
                    }
                    
                    // Calculer et sauvegarder le résultat
                    if (isset($quiz_data['end_time'])) {
                        $user_item->finish();
                    }
                    
                    $results['synced'][] = array(
                        'type' => 'quiz',
                        'id' => $quiz_id,
                        'score' => $user_item->get_results('result')
                    );
                }
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => 'quiz',
                    'id' => $quiz_data['id'],
                    'error' => $e->getMessage()
                );
            }
        }
        
        return $results;
    }
    
    /**
     * Synchroniser les devoirs
     */
    private function sync_assignments($user_id, $assignments_data) {
        $results = array(
            'synced' => array(),
            'errors' => array()
        );
        
        // Implémentation selon votre configuration des devoirs
        // Cette partie dépend de comment les devoirs sont gérés dans votre LearnPress
        
        return $results;
    }
    
    /**
     * Obtenir les données des cours de l'utilisateur
     */
    private function get_user_courses_data($user_id, $since = null) {
        $user = learn_press_get_user($user_id);
        $courses = $user->get_enrolled_courses();
        $courses_data = array();
        
        foreach ($courses as $course_id) {
            $course_data = $user->get_course_data($course_id);
            
            if ($course_data) {
                $data = array(
                    'course_id' => $course_id,
                    'status' => $course_data->get_status(),
                    'start_time' => $course_data->get_start_time(),
                    'end_time' => $course_data->get_end_time(),
                    'expiration_time' => $course_data->get_expiration_time(),
                    'progress' => $course_data->get_results('result')
                );
                
                // Filtrer par date si nécessaire
                if ($since && strtotime($course_data->get_start_time()) < strtotime($since)) {
                    continue;
                }
                
                $courses_data[] = $data;
            }
        }
        
        return $courses_data;
    }
    
    /**
     * Obtenir les données de progression
     */
    private function get_user_progress_data($user_id, $since = null) {
        global $wpdb;
        
        $query = "
            SELECT ui.*, uim.meta_value as progress
            FROM {$wpdb->prefix}learnpress_user_items ui
            LEFT JOIN {$wpdb->prefix}learnpress_user_itemmeta uim 
                ON ui.user_item_id = uim.learnpress_user_item_id 
                AND uim.meta_key = 'progress'
            WHERE ui.user_id = %d
            AND ui.item_type IN ('lp_lesson', 'lp_quiz')
        ";
        
        $params = array($user_id);
        
        if ($since) {
            $query .= " AND ui.start_time >= %s";
            $params[] = $since;
        }
        
        $items = $wpdb->get_results($wpdb->prepare($query, $params));
        
        $progress_data = array();
        
        foreach ($items as $item) {
            $progress_data[] = array(
                'item_id' => $item->item_id,
                'item_type' => $item->item_type,
                'status' => $item->status,
                'progress' => $item->progress ?: 0,
                'start_time' => $item->start_time,
                'end_time' => $item->end_time
            );
        }
        
        return $progress_data;
    }
    
    /**
     * Obtenir les données des quiz
     */
    private function get_user_quiz_data($user_id, $since = null) {
        global $wpdb;
        
        $query = "
            SELECT ui.*, q.questions
            FROM {$wpdb->prefix}learnpress_user_items ui
            JOIN {$wpdb->prefix}learnpress_quiz_questions q ON ui.item_id = q.quiz_id
            WHERE ui.user_id = %d
            AND ui.item_type = 'lp_quiz'
            AND ui.status IN ('completed', 'passed', 'failed')
        ";
        
        $params = array($user_id);
        
        if ($since) {
            $query .= " AND ui.end_time >= %s";
            $params[] = $since;
        }
        
        $quizzes = $wpdb->get_results($wpdb->prepare($query, $params));
        
        $quiz_data = array();
        
        foreach ($quizzes as $quiz) {
            $quiz_data[] = array(
                'quiz_id' => $quiz->item_id,
                'status' => $quiz->status,
                'questions' => unserialize($quiz->questions),
                'start_time' => $quiz->start_time,
                'end_time' => $quiz->end_time
            );
        }
        
        return $quiz_data;
    }
    
    /**
     * Obtenir les certificats
     */
    private function get_user_certificates($user_id, $since = null) {
        // Implémentation selon votre système de certificats
        return array();
    }
    
    /**
     * Enregistrer la synchronisation
     */
    private function record_sync($user_id, $results) {
        global $wpdb;
        
        // Mettre à jour la dernière synchronisation
        update_user_meta($user_id, '_col_lms_last_sync', current_time('mysql'));
        
        // Enregistrer dans la table de synchronisation
        $wpdb->insert(
            $wpdb->prefix . 'col_lms_sync_log',
            array(
                'user_id' => $user_id,
                'sync_type' => 'progress',
                'items_synced' => count($results['synced']),
                'items_failed' => count($results['errors']),
                'sync_data' => json_encode($results),
                'created_at' => current_time('mysql')
            )
        );
    }
    
    /**
     * Obtenir les éléments en attente de synchronisation
     */
    private function get_pending_sync_items($user_id) {
        global $wpdb;
        
        return $wpdb->get_results($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_sync_queue
            WHERE user_id = %d
            AND status = 'pending'
            ORDER BY created_at ASC
        ", $user_id));
    }
    
    /**
     * Obtenir le cours d'une leçon
     */
    private function get_lesson_course($item_id) {
        global $wpdb;
        
        return $wpdb->get_var($wpdb->prepare("
            SELECT s.section_course_id
            FROM {$wpdb->prefix}learnpress_section_items si
            JOIN {$wpdb->prefix}learnpress_sections s ON si.section_id = s.section_id
            WHERE si.item_id = %d
        ", $item_id));
    }
    
    /**
     * Vérifier l'accès au cours
     */
    private function user_can_access_course($user_id, $course_id) {
        $user = learn_press_get_user($user_id);
        $course_data = $user->get_course_data($course_id);
        
        return $course_data && in_array(
            $course_data->get_status(),
            array('enrolled', 'finished')
        );
    }
}

// === FICHIER: includes/class-packages.php ===
<?php
/**
 * Gestion des packages de cours
 */

class COL_LMS_Packages extends COL_LMS_API_Base {
    
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
     * Enregistrer les routes
     */
    private function register_routes() {
        // Statut d'un package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_package_status'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Télécharger un fichier du package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/download', array(
            'methods' => 'GET',
            'callback' => array($this, 'download_package_file'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'file' => array(
                    'required' => true,
                    'type' => 'string'
                )
            )
        ));
    }
    
    /**
     * Créer un package
     */
    public function create($course_id, $user_id, $options = array()) {
        global $wpdb;
        
        // Options par défaut
        $default_options = array(
            'include_videos' => true,
            'include_documents' => true,
            'compress_images' => true,
            'encryption_enabled' => true
        );
        
        $options = wp_parse_args($options, $default_options);
        
        // Générer un ID unique
        $package_id = wp_generate_uuid4();
        
        // Insérer dans la base
        $wpdb->insert(
            $wpdb->prefix . 'col_lms_packages',
            array(
                'package_id' => $package_id,
                'user_id' => $user_id,
                'course_id' => $course_id,
                'status' => 'pending',
                'progress' => 0,
                'options' => json_encode($options),
                'created_at' => current_time('mysql')
            )
        );
        
        // Ajouter à la queue de traitement
        wp_schedule_single_event(time(), 'col_lms_process_package', array($package_id));
        
        return $package_id;
    }
    
    /**
     * Obtenir le statut d'un package
     */
    public function get_package_status($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
            AND user_id = %d
        ", $package_id, $user_id));
        
        if (!$package) {
            return $this->error_response(
                'not_found',
                __('Package non trouvé.', 'col-lms-offline-api'),
                404
            );
        }
        
        $response = array(
            'package_id' => $package_id,
            'status' => $package->status,
            'progress' => intval($package->progress)
        );
        
        if ($package->status === 'completed') {
            $response['files'] = json_decode($package->files, true);
            $response['manifest'] = $this->get_package_manifest($package_id);
        }
        
        if ($package->status === 'error') {
            $response['error'] = $package->error_message;
        }
        
        return $response;
    }
    
    /**
     * Télécharger un fichier du package
     */
    public function download_package_file($request) {
        global $wpdb;
        
        $package_id = $request->get_param('id');
        $file_name = $request->get_param('file');
        $user_id = $this->get_current_user_id();
        
        // Vérifier le package
        $package = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
            AND user_id = %d
            AND status = 'completed'
        ", $package_id, $user_id));
        
        if (!$package) {
            return $this->error_response(
                'not_found',
                __('Package non trouvé ou non disponible.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Vérifier que le fichier est dans la liste
        $files = json_decode($package->files, true);
        $file_info = null;
        
        foreach ($files as $file) {
            if ($file['filename'] === $file_name) {
                $file_info = $file;
                break;
            }
        }
        
        if (!$file_info) {
            return $this->error_response(
                'file_not_found',
                __('Fichier non trouvé dans le package.', 'col-lms-offline-api'),
                404
            );
        }
        
        // Créer un token de téléchargement temporaire
        $download_token = wp_generate_password(32, false);
        set_transient(
            'col_lms_download_' . $download_token,
            array(
                'file_path' => $file_info['path'],
                'package_id' => $package_id,
                'user_id' => $user_id,
                'expires' => time() + 3600
            ),
            3600
        );
        
        return array(
            'download_url' => add_query_arg(
                array('col_lms_download' => $download_token),
                home_url()
            ),
            'expires_in' => 3600
        );
    }
    
    /**
     * Traiter la queue de packages
     */
    public function process_queue() {
        global $wpdb;
        
        // Récupérer les packages en attente
        $pending_packages = $wpdb->get_results("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 5
        ");
        
        foreach ($pending_packages as $package) {
            $this->process_package($package->package_id);
        }
    }
    
    /**
     * Traiter un package
     */
    public function process_package($package_id) {
        global $wpdb;
        
        // Récupérer le package
        $package = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM {$wpdb->prefix}col_lms_packages
            WHERE package_id = %s
        ", $package_id));
        
        if (!$package || $package->status !== 'pending') {
            return;
        }
        
        try {
            // Marquer comme en cours
            $this->update_package_status($package_id, 'processing', 0);
            
            $options = json_decode($package->options, true);
            $course = learn_press_get_course($package->course_id);
            
            if (!$course) {
                throw new Exception(__('Cours non trouvé.', 'col-lms-offline-api'));
            }
            
            // Créer le dossier du package
            $upload_dir = wp_upload_dir();
            $package_dir = $upload_dir['basedir'] . '/col-lms-packages/' . $package_id;
            
            if (!wp_mkdir_p($package_dir)) {
                throw new Exception(__('Impossible de créer le dossier du package.', 'col-lms-offline-api'));
            }
            
            $files = array();
            $manifest = array(
                'course_id' => $package->course_id,
                'title' => $course->get_title(),
                'version' => get_post_meta($package->course_id, '_lp_course_version', true) ?: 1,
                'created_at' => current_time('mysql'),
                'sections' => array()
            );
            
            // Progression : 10%
            $this->update_package_status($package_id, 'processing', 10);
            
            // Traiter l'image principale
            if ($thumbnail_id = get_post_thumbnail_id($package->course_id)) {
                $thumbnail_file = $this->copy_media_to_package($thumbnail_id, $package_dir, 'thumbnail');
                if ($thumbnail_file) {
                    $files[] = $thumbnail_file;
                    $manifest['thumbnail'] = $thumbnail_file['filename'];
                }
            }
            
            // Progression : 20%
            $this->update_package_status($package_id, 'processing', 20);
            
            // Traiter le curriculum
            $curriculum = $course->get_curriculum();
            $total_items = 0;
            $processed_items = 0;
            
            if ($curriculum) {
                foreach ($curriculum as $section) {
                    $items = $section->get_items();
                    if ($items) {
                        $total_items += count($items);
                    }
                }
            }
            
            if ($curriculum) {
                foreach ($curriculum as $section_index => $section) {
                    $section_data = array(
                        'id' => $section->get_id(),
                        'title' => $section->get_title(),
                        'items' => array()
                    );
                    
                    $items = $section->get_items();
                    if ($items) {
                        foreach ($items as $item) {
                            $processed_items++;
                            
                            $item_data = array(
                                'id' => $item->get_id(),
                                'title' => $item->get_title(),
                                'type' => $item->get_item_type()
                            );
                            
                            // Traiter selon le type
                            if ($item->get_item_type() === 'lp_lesson') {
                                $lesson_files = $this->process_lesson_for_package(
                                    $item->get_id(),
                                    $package_dir,
                                    $options
                                );
                                
                                $files = array_merge($files, $lesson_files);
                                $item_data['files'] = array_map(function($f) {
                                    return $f['filename'];
                                }, $lesson_files);
                                
                                // Contenu de la leçon
                                $lesson_post = get_post($item->get_id());
                                if ($lesson_post) {
                                    $item_data['content'] = $lesson_post->post_content;
                                }
                            } elseif ($item->get_item_type() === 'lp_quiz') {
                                // Traiter le quiz
                                $item_data['quiz_data'] = $this->get_quiz_data($item->get_id());
                            }
                            
                            $section_data['items'][] = $item_data;
                            
                            // Mettre à jour la progression
                            $progress = 20 + (60 * $processed_items / $total_items);
                            $this->update_package_status($package_id, 'processing', $progress);
                        }
                    }
                    
                    $manifest['sections'][] = $section_data;
                }
            }
            
            // Sauvegarder le manifeste
            file_put_contents(
                $package_dir . '/manifest.json',
                json_encode($manifest, JSON_PRETTY_PRINT)
            );
            
            $files[] = array(
                'filename' => 'manifest.json',
                'path' => $package_dir . '/manifest.json',
                'size' => filesize($package_dir . '/manifest.json')
            );
            
            // Progression : 90%
            $this->update_package_status($package_id, 'processing', 90);
            
            // Finaliser
            $wpdb->update(
                $wpdb->prefix . 'col_lms_packages',
                array(
                    'status' => 'completed',
                    'progress' => 100,
                    'files' => json_encode($files),
                    'completed_at' => current_time('mysql')
                ),
                array('package_id' => $package_id)
            );
            
            COL_LMS_Logger::log('Package créé avec succès', array(
                'package_id' => $package_id,
                'files_count' => count($files)
            ));
            
        } catch (Exception $e) {
            $wpdb->update(
                $wpdb->prefix . 'col_lms_packages',
                array(
                    'status' => 'error',
                    'error_message' => $e->getMessage()
                ),
                array('package_id' => $package_id)
            );
            
            COL_LMS_Logger::log('Erreur création package', array(
                'package_id' => $package_id,
                'error' => $e->getMessage()
            ));
        }
    }
    
    /**
     * Traiter une leçon pour le package
     */
    private function process_lesson_for_package($lesson_id, $package_dir, $options) {
        $files = array();
        
        // Vidéos
        if ($options['include_videos']) {
            // Vidéo externe
            $video_url = get_post_meta($lesson_id, '_lp_lesson_video_url', true);
            if ($video_url) {
                // Pour les vidéos externes, on stocke juste l'URL
                $video_info_file = $package_dir . '/lesson_' . $lesson_id . '_video.json';
                file_put_contents($video_info_file, json_encode(array(
                    'type' => 'external',
                    'url' => $video_url
                )));
                
                $files[] = array(
                    'filename' => 'lesson_' . $lesson_id . '_video.json',
                    'path' => $video_info_file,
                    'size' => filesize($video_info_file)
                );
            }
        }
        
        // Documents
        if ($options['include_documents']) {
            // Pièces jointes
            $attachments = get_posts(array(
                'post_type' => 'attachment',
                'posts_per_page' => -1,
                'post_parent' => $lesson_id
            ));
            
            foreach ($attachments as $attachment) {
                $file = $this->copy_media_to_package(
                    $attachment->ID,
                    $package_dir,
                    'lesson_' . $lesson_id
                );
                
                if ($file) {
                    $files[] = $file;
                }
            }
            
            // Matériaux
            $materials = get_post_meta($lesson_id, '_lp_lesson_materials', true);
            if ($materials && is_array($materials)) {
                foreach ($materials as $index => $material) {
                    if (!empty($material['file_id'])) {
                        $file = $this->copy_media_to_package(
                            $material['file_id'],
                            $package_dir,
                            'lesson_' . $lesson_id . '_material_' . $index
                        );
                        
                        if ($file) {
                            $files[] = $file;
                        }
                    }
                }
            }
        }
        
        return $files;
    }
    
    /**
     * Copier un média dans le package
     */
    private function copy_media_to_package($attachment_id, $package_dir, $prefix = '') {
        $file_path = get_attached_file($attachment_id);
        
        if (!$file_path || !file_exists($file_path)) {
            return null;
        }
        
        $filename = $prefix . '_' . basename($file_path);
        $destination = $package_dir . '/' . $filename;
        
        if (copy($file_path, $destination)) {
            return array(
                'filename' => $filename,
                'path' => $destination,
                'size' => filesize($destination),
                'type' => get_post_mime_type($attachment_id)
            );
        }
        
        return null;
    }
    
    /**
     * Obtenir les données d'un quiz
     */
    private function get_quiz_data($quiz_id) {
        $quiz = learn_press_get_quiz($quiz_id);
        
        if (!$quiz) {
            return null;
        }
        
        $questions = array();
        $question_ids = $quiz->get_question_ids();
        
        foreach ($question_ids as $question_id) {
            $question = learn_press_get_question($question_id);
            
            if ($question) {
                $questions[] = array(
                    'id' => $question_id,
                    'title' => $question->get_title(),
                    'content' => $question->get_content(),
                    'type' => $question->get_type(),
                    'options' => $question->get_data('answer_options'),
                    'correct' => $question->get_data('answer'),
                    'explanation' => $question->get_data('explanation')
                );
            }
        }
        
        return array(
            'id' => $quiz_id,
            'title' => $quiz->get_title(),
            'passing_grade' => $quiz->get_passing_grade(),
            'questions' => $questions,
            'duration' => $quiz->get_duration(),
            'retake_count' => $quiz->get_retake_count()
        );
    }
    
    /**
     * Mettre à jour le statut d'un package
     */
    private function update_package_status($package_id, $status, $progress) {
        global $wpdb;
        
        $wpdb->update(
            $wpdb->prefix . 'col_lms_packages',
            array(
                'status' => $status,
                'progress' => intval($progress)
            ),
            array('package_id' => $package_id)
        );
    }
    
    /**
     * Obtenir le manifeste d'un package
     */
    private function get_package_manifest($package_id) {
        $upload_dir = wp_upload_dir();
        $manifest_file = $upload_dir['basedir'] . '/col-lms-packages/' . $package_id . '/manifest.json';
        
        if (file_exists($manifest_file)) {
            return json_decode(file_get_contents($manifest_file), true);
        }
        
        return null;
    }
    
    /**
     * Gérer le téléchargement direct
     */
    public function handle_download() {
        $token = sanitize_text_field($_GET['col_lms_download']);
        $download_data = get_transient('col_lms_download_' . $token);
        
        if (!$download_data || $download_data['expires'] < time()) {
            wp_die(__('Lien de téléchargement invalide ou expiré.', 'col-lms-offline-api'));
        }
        
        $file_path = $download_data['file_path'];
        
        if (!file_exists($file_path)) {
            wp_die(__('Fichier non trouvé.', 'col-lms-offline-api'));
        }
        
        // Headers pour forcer le téléchargement
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . basename($file_path) . '"');
        header('Content-Length: ' . filesize($file_path));
        header('Cache-Control: no-cache, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
        
        // Lire et envoyer le fichier
        readfile($file_path);
        
        // Supprimer le token
        delete_transient('col_lms_download_' . $token);
        
        // Logger le téléchargement
        COL_LMS_Logger::log('Fichier téléchargé', array(
            'package_id' => $download_data['package_id'],
            'user_id' => $download_data['user_id'],
            'file' => basename($file_path)
        ));
        
        exit;
    }
}

// === FICHIER: includes/class-migration.php ===
<?php
/**
 * Gestion des migrations de base de données
 */

class COL_LMS_Migration {
    
    private static $instance = null;
    private $db_version = '1.0.0';
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('admin_init', array($this, 'check_version'));
    }
    
    /**
     * Vérifier et exécuter les migrations
     */
    public function check_version() {
        $current_version = get_option('col_lms_db_version', '0');
        
        if (version_compare($current_version, $this->db_version, '<')) {
            $this->run();
        }
    }
    
    /**
     * Exécuter les migrations
     */
    public function run() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        
        // Table des tokens
        $sql_tokens = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}col_lms_tokens (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            device_id varchar(255) NOT NULL,
            device_name varchar(255),
            token_hash varchar(255) NOT NULL,
            refresh_token_hash varchar(255) NOT NULL,
            expires_at datetime NOT NULL,
            last_used datetime,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_device (user_id, device_id),
            KEY token_hash (token_hash),
            KEY expires_at (expires_at)
        ) $charset_collate;";
        
        // Table des packages
        $sql_packages = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}col_lms_packages (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            package_id varchar(255) NOT NULL,
            user_id bigint(20) NOT NULL,
            course_id bigint(20) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'pending',
            progress int(3) DEFAULT 0,
            options longtext,
            files longtext,
            error_message text,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            completed_at datetime,
            PRIMARY KEY (id),
            UNIQUE KEY package_id (package_id),
            KEY user_course (user_id, course_id),
            KEY status (status),
            KEY created_at (created_at)
        ) $charset_collate;";
        
        // Table des logs
        $sql_logs = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}col_lms_logs (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20),
            action varchar(50) NOT NULL,
            details longtext,
            ip_address varchar(45),
            user_agent text,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_action (user_id, action),
            KEY created_at (created_at)
        ) $charset_collate;";
        
        // Table de synchronisation
        $sql_sync = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}col_lms_sync_log (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            sync_type varchar(50) NOT NULL,
            items_synced int(11) DEFAULT 0,
            items_failed int(11) DEFAULT 0,
            sync_data longtext,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_sync (user_id, sync_type),
            KEY created_at (created_at)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        
        dbDelta($sql_tokens);
        dbDelta($sql_packages);
        dbDelta($sql_logs);
        dbDelta($sql_sync);
        
        // Mettre à jour la version
        update_option('col_lms_db_version', $this->db_version);
        
        // Options par défaut
        $this->setup_default_options();
    }
    
    /**
     * Configurer les options par défaut
     */
    private function setup_default_options() {
        // Général
        add_option('col_lms_api_enabled', true);
        add_option('col_lms_require_membership', false);
        add_option('col_lms_allowed_membership_levels', array());
        add_option('col_lms_token_lifetime', 3600);
        add_option('col_lms_max_devices_per_user', 5);
        
        // Sécurité
        add_option('col_lms_enable_rate_limiting', true);
        add_option('col_lms_rate_limit_requests', 100);
        add_option('col_lms_rate_limit_window', 3600);
        
        // Téléchargement
        add_option('col_lms_enable_course_packages', true);
        add_option('col_lms_package_expiry_hours', 24);
        add_option('col_lms_max_package_size', 2147483648); // 2GB
        
        // Synchronisation
        add_option('col_lms_enable_progress_sync', true);
        add_option('col_lms_sync_batch_size', 100);
    }
}

// === FICHIER: includes/class-logger.php ===
<?php
/**
 * Système de logs
 */

class COL_LMS_Logger {
    
    private static $instance = null;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    /**
     * Logger une action
     */
    public static function log($action, $details = array()) {
        global $wpdb;
        
        $user_id = get_current_user_id();
        $ip_address = $_SERVER['REMOTE_ADDR'] ?? '';
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
        
        $wpdb->insert(
            $wpdb->prefix . 'col_lms_logs',
            array(
                'user_id' => $user_id ?: null,
                'action' => $action,
                'details' => json_encode($details),
                'ip_address' => $ip_address,
                'user_agent' => $user_agent,
                'created_at' => current_time('mysql')
            )
        );
        
        // Nettoyer les vieux logs si nécessaire
        self::cleanup_old_logs();
    }
    
    /**
     * Nettoyer les vieux logs
     */
    private static function cleanup_old_logs() {
        global $wpdb;
        
        // Nettoyer une fois par jour seulement
        $last_cleanup = get_transient('col_lms_logs_cleanup');
        if ($last_cleanup) {
            return;
        }
        
        $wpdb->query("
            DELETE FROM {$wpdb->prefix}col_lms_logs
            WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        ");
        
        set_transient('col_lms_logs_cleanup', true, DAY_IN_SECONDS);
    }
}
