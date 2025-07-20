<?php
/**
 * Plugin Name: COL LMS Offline API
 * Plugin URI: https://votre-site.com/
 * Description: API REST avancée pour application mobile LMS avec support LearnPress et Paid Memberships Pro
 * Version: 1.2.0
 * Author: COL Team
 * License: GPL v2 or later
 * Text Domain: col-lms-offline-api
 * Domain Path: /languages
 * Requires at least: 5.8
 * Tested up to: 6.4
 * Requires PHP: 7.4
 * Network: false
 * 
 * @package COL_LMS_Offline_API
 * @version 1.2.0
 * @author COL Team
 * @copyright 2024 COL Team
 * @license GPL v2 or later
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit('Accès direct interdit.');
}

// Vérifier la version PHP minimum
if (version_compare(PHP_VERSION, '7.4', '<')) {
    add_action('admin_notices', function() {
        echo '<div class="notice notice-error"><p>';
        echo sprintf(
            __('COL LMS Offline API nécessite PHP 7.4 ou supérieur. Version actuelle : %s', 'col-lms-offline-api'),
            PHP_VERSION
        );
        echo '</p></div>';
    });
    return;
}

// Constantes du plugin
define('COL_LMS_API_VERSION', '1.2.0');
define('COL_LMS_API_PATH', plugin_dir_path(__FILE__));
define('COL_LMS_API_URL', plugin_dir_url(__FILE__));
define('COL_LMS_API_NAMESPACE', 'col-lms/v1');
define('COL_LMS_API_BASENAME', plugin_basename(__FILE__));
define('COL_LMS_API_FILE', __FILE__);
define('COL_LMS_API_MIN_WP_VERSION', '5.8');
define('COL_LMS_API_MIN_LP_VERSION', '4.0');

// Charger l'autoloader si disponible
if (file_exists(COL_LMS_API_PATH . 'vendor/autoload.php')) {
    require_once COL_LMS_API_PATH . 'vendor/autoload.php';
}

// Charger les classes requises
require_once COL_LMS_API_PATH . 'includes/class-migration.php';

/**
 * Classe principale du plugin COL LMS Offline API
 * 
 * @since 1.0.0
 * @version 1.2.0
 */
final class COL_LMS_Offline_API {
    
    /**
     * Instance singleton
     * 
     * @var COL_LMS_Offline_API|null
     */
    private static $instance = null;
    
    /**
     * Namespace de l'API REST
     * 
     * @var string
     */
    private $namespace = COL_LMS_API_NAMESPACE;
    
    /**
     * Indicateur d'initialisation
     * 
     * @var bool
     */
    private $initialized = false;
    
    /**
     * Classes chargées
     * 
     * @var array
     */
    private $loaded_classes = array();
    
    /**
     * Configuration du plugin
     * 
     * @var array
     */
    private $config = array();
    
    /**
     * Obtenir l'instance singleton
     * 
     * @return COL_LMS_Offline_API
     */
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    /**
     * Constructeur privé pour empêcher l'instanciation directe
     */
    private function __construct() {
        $this->setup_constants();
        $this->includes();
        $this->init_hooks();
    }
    
    /**
     * Empêcher le clonage
     */
    private function __clone() {}
    
    /**
     * Empêcher la désérialisation
     */
    public function __wakeup() {
        throw new Exception(__('Impossible de désérialiser une instance de ', 'col-lms-offline-api') . __CLASS__);
    }
    
    /**
     * Définir les constantes supplémentaires
     */
    private function setup_constants() {
        // Environnement
        if (!defined('COL_LMS_API_ENV')) {
            define('COL_LMS_API_ENV', wp_get_environment_type());
        }
        
        // Modes de fonctionnement
        if (!defined('COL_LMS_API_DEBUG')) {
            define('COL_LMS_API_DEBUG', defined('WP_DEBUG') && WP_DEBUG);
        }
        
        // Sécurité
        if (!defined('COL_LMS_REQUIRE_HTTPS')) {
            define('COL_LMS_REQUIRE_HTTPS', !COL_LMS_API_DEBUG);
        }
        
        // Chemins
        if (!defined('COL_LMS_API_INCLUDES')) {
            define('COL_LMS_API_INCLUDES', COL_LMS_API_PATH . 'includes/');
        }
        
        if (!defined('COL_LMS_API_ADMIN')) {
            define('COL_LMS_API_ADMIN', COL_LMS_API_PATH . 'admin/');
        }
        
        if (!defined('COL_LMS_API_LANGUAGES')) {
            define('COL_LMS_API_LANGUAGES', COL_LMS_API_PATH . 'languages/');
        }
    }
    
    /**
     * Charger les fichiers requis
     */
    private function includes() {
        // Classes de base
        $includes = array(
            'includes/class-api.php',
            'includes/class-auth.php',
            'includes/class-courses.php',
            'includes/class-sync.php',
            'includes/class-packages.php',
            'includes/class-jwt.php',
            'includes/class-logger.php'
        );
        
        foreach ($includes as $file) {
            $file_path = COL_LMS_API_PATH . $file;
            if (file_exists($file_path)) {
                require_once $file_path;
                $this->loaded_classes[] = basename($file, '.php');
            } else {
                $this->log_error(sprintf(__('Fichier requis manquant : %s', 'col-lms-offline-api'), $file));
            }
        }
        
        // Classe d'administration - charger depuis admin/
        if (is_admin()) {
            $admin_file = COL_LMS_API_PATH . 'admin/class-admin.php';
            if (file_exists($admin_file)) {
                require_once $admin_file;
                $this->loaded_classes[] = 'class-admin';
            } else {
                $this->log_error('Fichier admin manquant : admin/class-admin.php');
            }
        }
    }
    
    /**
     * Initialiser les hooks WordPress
     */
    private function init_hooks() {
        // Hooks d'initialisation - CORRIGÉ
        add_action('init', array($this, 'init'), 0);
        add_action('rest_api_init', array($this, 'register_routes'));
        add_action('rest_api_init', array($this, 'init_rest_components'), 5);
        add_action('plugins_loaded', array($this, 'load_textdomain'));
        
        // Hooks d'activation/désactivation
        register_activation_hook(COL_LMS_API_FILE, array($this, 'activate'));
        register_deactivation_hook(COL_LMS_API_FILE, array($this, 'deactivate'));
        
        // Hooks de nettoyage
        add_action('col_lms_cleanup_tokens', array($this, 'cleanup_expired_tokens'));
        add_action('col_lms_create_package', array($this, 'create_package_handler'));
        add_action('col_lms_cleanup_packages', array($this, 'cleanup_old_packages'));
        
        // Hooks de sécurité
        add_action('wp_login_failed', array($this, 'handle_failed_login'));
        add_action('wp_logout', array($this, 'handle_logout'));
        
        // Hooks de maintenance
        add_action('upgrader_process_complete', array($this, 'handle_plugin_update'), 10, 2);
        
        // Filtres
        add_filter('determine_current_user', array($this, 'determine_current_user'), 20);
        add_filter('rest_pre_dispatch', array($this, 'rest_pre_dispatch'), 10, 3);
        
        // Hook de téléchargement sécurisé
        add_action('init', array($this, 'handle_secure_downloads'));
        
        // AJAX hooks
        if (is_admin()) {
            add_action('wp_ajax_col_lms_dismiss_notice', array($this, 'ajax_dismiss_notice'));
        }
    }
    
    /**
     * Initialisation principale du plugin
     */
    public function init() {
        // Éviter la double initialisation
        if ($this->initialized) {
            return;
        }
        
        // Vérifications de compatibilité
        if (!$this->check_compatibility()) {
            return;
        }
        
        // Charger la configuration
        $this->load_config();
        
        // Initialiser les composants NON-REST seulement
        $this->init_components();
        
        // Planifier les tâches CRON
        $this->schedule_events();
        
        // Marquer comme initialisé
        $this->initialized = true;
        
        // Hook pour les extensions
        do_action('col_lms_api_loaded', $this);
        
        // Log de l'initialisation
        if (COL_LMS_API_DEBUG) {
            $this->log_debug('Plugin initialisé avec succès', array(
                'version' => COL_LMS_API_VERSION,
                'loaded_classes' => $this->loaded_classes
            ));
        }
    }
    
    /**
     * NOUVELLE MÉTHODE : Initialiser les composants REST sur rest_api_init
     */
    public function init_rest_components() {
        if (!$this->is_api_enabled()) {
            return;
        }
        
        // Vérifier les dépendances avant d'initialiser les composants REST
        if (!class_exists('LearnPress')) {
            return;
        }
        
        // Initialiser les classes qui gèrent les routes REST
        if (class_exists('COL_LMS_Auth')) {
            COL_LMS_Auth::instance();
        }
        
        if (class_exists('COL_LMS_Courses')) {
            COL_LMS_Courses::instance();
        }
        
        if (class_exists('COL_LMS_Sync')) {
            COL_LMS_Sync::instance();
        }
        
        if (class_exists('COL_LMS_Packages')) {
            COL_LMS_Packages::instance();
        }
        
        if (class_exists('COL_LMS_API')) {
            COL_LMS_API::instance();
        }
        
        // Hook pour les extensions
        do_action('col_lms_rest_components_loaded', $this);
        
        // Log de l'initialisation REST
        if (COL_LMS_API_DEBUG) {
            $this->log_debug('Composants REST initialisés avec succès');
        }
    }
    
    /**
     * Vérifier la compatibilité système
     * 
     * @return bool
     */
    private function check_compatibility() {
        $errors = array();
        
        // Vérifier WordPress
        if (version_compare(get_bloginfo('version'), COL_LMS_API_MIN_WP_VERSION, '<')) {
            $errors[] = sprintf(
                __('WordPress %s ou supérieur requis. Version actuelle : %s', 'col-lms-offline-api'),
                COL_LMS_API_MIN_WP_VERSION,
                get_bloginfo('version')
            );
        }
        
        // Vérifier LearnPress
        if (!class_exists('LearnPress')) {
            $errors[] = __('LearnPress doit être installé et activé.', 'col-lms-offline-api');
        } elseif (defined('LP_PLUGIN_VERSION') && version_compare(LP_PLUGIN_VERSION, COL_LMS_API_MIN_LP_VERSION, '<')) {
            $errors[] = sprintf(
                __('LearnPress %s ou supérieur requis. Version actuelle : %s', 'col-lms-offline-api'),
                COL_LMS_API_MIN_LP_VERSION,
                LP_PLUGIN_VERSION
            );
        }
        
        // Vérifier les extensions PHP
        $required_extensions = array('json', 'openssl', 'curl');
        foreach ($required_extensions as $extension) {
            if (!extension_loaded($extension)) {
                $errors[] = sprintf(__('Extension PHP manquante : %s', 'col-lms-offline-api'), $extension);
            }
        }
        
        // Vérifier HTTPS en production
        if (COL_LMS_REQUIRE_HTTPS && !is_ssl() && !defined('COL_LMS_ALLOW_HTTP')) {
            $errors[] = __('HTTPS requis pour des raisons de sécurité.', 'col-lms-offline-api');
        }
        
        // Afficher les erreurs
        if (!empty($errors)) {
            add_action('admin_notices', function() use ($errors) {
                foreach ($errors as $error) {
                    echo '<div class="notice notice-error"><p><strong>COL LMS API:</strong> ' . esc_html($error) . '</p></div>';
                }
            });
            return false;
        }
        
        return true;
    }
    
    /**
     * Charger la configuration
     */
    private function load_config() {
        $defaults = array(
            'api_enabled' => true,
            'require_membership' => false,
            'token_lifetime' => 3600,
            'max_devices_per_user' => 5,
            'enable_rate_limiting' => true,
            'rate_limit_requests' => 100,
            'rate_limit_window' => 3600,
            'enable_logging' => true,
            'log_level' => 'info',
            'package_expiry_hours' => 24,
            'max_package_size' => 2147483648, // 2GB
            'enable_encryption' => true
        );
        
        $this->config = wp_parse_args(get_option('col_lms_api_config', array()), $defaults);
        
        // Permettre la personnalisation via filtres
        $this->config = apply_filters('col_lms_api_config', $this->config);
    }
    
    /**
     * MODIFIÉ : Initialiser seulement les composants NON-REST
     */
    private function init_components() {
        // Les composants REST sont initialisés dans init_rest_components()
        // Ici on peut initialiser d'autres composants qui ne gèrent pas de routes REST
        
        // Permettre l'ajout d'autres composants non-REST
        do_action('col_lms_init_components', $this);
    }
    
    /**
     * Planifier les événements CRON
     */
    private function schedule_events() {
        // Nettoyage des tokens expirés (toutes les heures)
        if (!wp_next_scheduled('col_lms_cleanup_tokens')) {
            wp_schedule_event(time(), 'hourly', 'col_lms_cleanup_tokens');
        }
        
        // Nettoyage des packages (quotidien)
        if (!wp_next_scheduled('col_lms_cleanup_packages')) {
            wp_schedule_event(time(), 'daily', 'col_lms_cleanup_packages');
        }
        
        // Nettoyage des logs (quotidien)
        if (!wp_next_scheduled('col_lms_cleanup_logs')) {
            wp_schedule_event(time(), 'daily', 'col_lms_cleanup_logs');
        }
        
        // Statistiques (hebdomadaire)
        if (!wp_next_scheduled('col_lms_generate_stats')) {
            wp_schedule_event(time(), 'weekly', 'col_lms_generate_stats');
        }
    }
    
    /**
     * Charger les traductions
     */
    public function load_textdomain() {
        load_plugin_textdomain(
            'col-lms-offline-api',
            false,
            dirname(COL_LMS_API_BASENAME) . '/languages/'
        );
    }
    
    /**
     * Enregistrer les routes REST API principales
     */
    public function register_routes() {
        if (!$this->is_api_enabled()) {
            return;
        }
        
        // Route de statut général
        register_rest_route($this->namespace, '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'api_status'),
            'permission_callback' => '__return_true',
            'args' => array()
        ));
        
        // Route de santé
        register_rest_route($this->namespace, '/health', array(
            'methods' => 'GET',
            'callback' => array($this, 'health_check'),
            'permission_callback' => array($this, 'check_admin_permission'),
            'args' => array()
        ));
        
        // Permettre l'ajout d'autres routes
        do_action('col_lms_register_routes', $this->namespace);
    }
    
    /**
     * Statut de l'API
     */
    public function api_status($request) {
        return array(
            'status' => 'active',
            'version' => COL_LMS_API_VERSION,
            'namespace' => $this->namespace,
            'server_time' => current_time('mysql'),
            'timezone' => wp_timezone_string(),
            'endpoints' => array(
                'auth' => rest_url($this->namespace . '/auth'),
                'courses' => rest_url($this->namespace . '/courses'),
                'sync' => rest_url($this->namespace . '/sync'),
                'packages' => rest_url($this->namespace . '/packages')
            ),
            'requirements' => array(
                'wordpress' => array(
                    'version' => get_bloginfo('version'),
                    'multisite' => is_multisite()
                ),
                'learnpress' => array(
                    'active' => class_exists('LearnPress'),
                    'version' => defined('LP_PLUGIN_VERSION') ? LP_PLUGIN_VERSION : 'unknown'
                ),
                'pmpro' => array(
                    'active' => function_exists('pmpro_hasMembershipLevel'),
                    'version' => defined('PMPRO_VERSION') ? PMPRO_VERSION : 'unknown'
                )
            ),
            'limits' => array(
                'max_devices_per_user' => $this->get_config('max_devices_per_user'),
                'max_package_size' => $this->get_config('max_package_size'),
                'token_lifetime' => $this->get_config('token_lifetime'),
                'rate_limit_enabled' => $this->get_config('enable_rate_limiting')
            )
        );
    }
    
    /**
     * Vérification de santé du système
     */
    public function health_check($request) {
        if (!current_user_can('manage_options')) {
            return new WP_Error('insufficient_permissions', __('Permissions insuffisantes.', 'col-lms-offline-api'));
        }
        
        global $wpdb;
        
        $health = array(
            'status' => 'healthy',
            'checks' => array(),
            'timestamp' => current_time('mysql')
        );
        
        // Vérifier la base de données
        $db_check = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}col_lms_tokens");
        $health['checks']['database'] = array(
            'status' => is_numeric($db_check) ? 'pass' : 'fail',
            'message' => is_numeric($db_check) ? 'Base de données accessible' : 'Erreur base de données'
        );
        
        // Vérifier les permissions de fichiers
        $upload_dir = wp_upload_dir();
        $packages_dir = $upload_dir['basedir'] . '/col-lms-packages';
        $health['checks']['file_permissions'] = array(
            'status' => is_writable($packages_dir) ? 'pass' : 'fail',
            'message' => is_writable($packages_dir) ? 'Permissions fichiers OK' : 'Permissions fichiers insuffisantes'
        );
        
        // Vérifier les tâches CRON
        $next_cleanup = wp_next_scheduled('col_lms_cleanup_tokens');
        $health['checks']['cron'] = array(
            'status' => $next_cleanup ? 'pass' : 'fail',
            'message' => $next_cleanup ? 'Tâches CRON programmées' : 'Tâches CRON non programmées',
            'next_cleanup' => $next_cleanup ? date('Y-m-d H:i:s', $next_cleanup) : null
        );
        
        // Déterminer le statut global
        $failing_checks = array_filter($health['checks'], function($check) {
            return $check['status'] === 'fail';
        });
        
        if (!empty($failing_checks)) {
            $health['status'] = 'degraded';
        }
        
        return $health;
    }
    
    /**
     * Activation du plugin
     */
    public function activate() {
        // Vérifier les prérequis
        if (!class_exists('LearnPress')) {
            deactivate_plugins(COL_LMS_API_BASENAME);
            wp_die(__('COL LMS Offline API nécessite LearnPress pour fonctionner.', 'col-lms-offline-api'));
        }
        
        // Exécuter la migration
        if (class_exists('COL_LMS_Migration')) {
            COL_LMS_Migration::instance()->run();
        }
        
        // Programmer le nettoyage des tokens
        if (!wp_next_scheduled('col_lms_cleanup_tokens')) {
            wp_schedule_event(time(), 'hourly', 'col_lms_cleanup_tokens');
        }
        
        // Flush les règles de réécriture
        flush_rewrite_rules();
        
        // Mettre à jour la version
        update_option('col_lms_api_version', COL_LMS_API_VERSION);
        update_option('col_lms_api_activated_time', current_time('mysql'));
        
        // Log de l'activation
        $this->log_info('Plugin activé', array(
            'version' => COL_LMS_API_VERSION,
            'wordpress_version' => get_bloginfo('version'),
            'php_version' => PHP_VERSION
        ));
        
        // Hook pour les extensions
        do_action('col_lms_api_activated');
    }
    
    /**
     * Désactivation du plugin
     */
    public function deactivate() {
        // Supprimer les tâches programmées
        wp_clear_scheduled_hook('col_lms_cleanup_tokens');
        wp_clear_scheduled_hook('col_lms_cleanup_packages');
        wp_clear_scheduled_hook('col_lms_cleanup_logs');
        wp_clear_scheduled_hook('col_lms_generate_stats');
        
        // Flush les règles de réécriture
        flush_rewrite_rules();
        
        // Log de la désactivation
        $this->log_info('Plugin désactivé');
        
        // Hook pour les extensions
        do_action('col_lms_api_deactivated');
    }
    
    /**
     * Nettoyer les tokens expirés
     */
    public function cleanup_expired_tokens() {
        if (!class_exists('COL_LMS_Auth')) {
            return;
        }
        
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        $deleted = $wpdb->query("DELETE FROM $table_name WHERE expires_at < NOW()");
        
        if ($deleted > 0) {
            $this->log_info('Tokens expirés nettoyés', array('count' => $deleted));
        }
    }
    
    /**
     * Nettoyer les anciens packages
     */
    public function cleanup_old_packages() {
        if (class_exists('COL_LMS_Packages')) {
            COL_LMS_Packages::instance()->cleanup_old_packages();
        }
    }
    
    /**
     * Handler pour la création de packages
     */
    public function create_package_handler($package_id) {
        if (class_exists('COL_LMS_Packages')) {
            COL_LMS_Packages::instance()->process_package($package_id);
        }
    }
    
    /**
     * Gérer les téléchargements sécurisés
     */
    public function handle_secure_downloads() {
        if (isset($_GET['col_lms_download']) && !empty($_GET['col_lms_download'])) {
            if (class_exists('COL_LMS_Packages')) {
                COL_LMS_Packages::instance()->handle_download();
            }
        }
    }
    
    /**
     * Gérer les échecs de connexion
     */
    public function handle_failed_login($username) {
        $ip = $this->get_client_ip();
        $this->log_warning('Tentative de connexion échouée', array(
            'username' => $username,
            'ip' => $ip
        ));
    }
    
    /**
     * Gérer les déconnexions
     */
    public function handle_logout($user_id) {
        // Optionnel : nettoyer les tokens de cet utilisateur
        if ($this->get_config('logout_revoke_tokens')) {
            global $wpdb;
            $wpdb->delete(
                $wpdb->prefix . 'col_lms_tokens',
                array('user_id' => $user_id),
                array('%d')
            );
        }
    }
    
    /**
     * Gérer les mises à jour du plugin
     */
    public function handle_plugin_update($upgrader, $hook_extra) {
        if (isset($hook_extra['plugins']) && in_array(COL_LMS_API_BASENAME, $hook_extra['plugins'])) {
            // Exécuter les migrations si nécessaire
            if (class_exists('COL_LMS_Migration')) {
                COL_LMS_Migration::instance()->check_version();
            }
            
            $this->log_info('Plugin mis à jour', array(
                'new_version' => COL_LMS_API_VERSION
            ));
        }
    }
    
    /**
     * Déterminer l'utilisateur actuel pour l'API
     */
    public function determine_current_user($user_id) {
        // Ne traiter que les requêtes API REST
        if (!defined('REST_REQUEST') || !REST_REQUEST) {
            return $user_id;
        }
        
        // Vérifier si c'est notre namespace
        $request_uri = $_SERVER['REQUEST_URI'] ?? '';
        if (strpos($request_uri, '/wp-json/' . $this->namespace) === false) {
            return $user_id;
        }
        
        // Laisser les classes Auth gérer l'authentification
        return $user_id;
    }
    
    /**
     * Pre-dispatch pour l'API REST
     */
    public function rest_pre_dispatch($result, $server, $request) {
        // Vérifier si c'est notre API
        $route = $request->get_route();
        if (strpos($route, '/' . $this->namespace) !== 0) {
            return $result;
        }
        
        // Vérifier si l'API est activée
        if (!$this->is_api_enabled()) {
            return new WP_Error(
                'api_disabled',
                __('API temporairement désactivée.', 'col-lms-offline-api'),
                array('status' => 503)
            );
        }
        
        // Log de la requête en mode debug
        if (COL_LMS_API_DEBUG) {
            $this->log_debug('Requête API', array(
                'route' => $route,
                'method' => $request->get_method(),
                'ip' => $this->get_client_ip()
            ));
        }
        
        return $result;
    }
    
    /**
     * AJAX : Fermer une notice
     */
    public function ajax_dismiss_notice() {
        if (!wp_verify_nonce($_POST['_wpnonce'] ?? '', 'col_lms_dismiss_notice')) {
            wp_die(__('Nonce invalide', 'col-lms-offline-api'));
        }
        
        $notice = sanitize_text_field($_POST['notice'] ?? '');
        if ($notice === 'pmpro') {
            update_user_meta(get_current_user_id(), 'col_lms_pmpro_notice_dismissed', true);
        }
        
        wp_die();
    }
    
    /**
     * Vérifier si l'API est activée
     */
    public function is_api_enabled() {
        return (bool) $this->get_config('api_enabled');
    }
    
    /**
     * Vérifier les permissions administrateur
     */
    public function check_admin_permission($request) {
        return current_user_can('manage_options');
    }
    
    /**
     * Obtenir une valeur de configuration
     */
    public function get_config($key, $default = null) {
        return isset($this->config[$key]) ? $this->config[$key] : $default;
    }
    
    /**
     * Mettre à jour une valeur de configuration
     */
    public function set_config($key, $value) {
        $this->config[$key] = $value;
        update_option('col_lms_api_config', $this->config);
    }
    
    /**
     * Obtenir l'IP du client
     */
    private function get_client_ip() {
        $ip_headers = array(
            'HTTP_CF_CONNECTING_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_FORWARDED',
            'HTTP_X_CLUSTER_CLIENT_IP',
            'HTTP_FORWARDED_FOR',
            'HTTP_FORWARDED',
            'REMOTE_ADDR'
        );
        
        foreach ($ip_headers as $header) {
            if (!empty($_SERVER[$header])) {
                $ip = $_SERVER[$header];
                if (strpos($ip, ',') !== false) {
                    $ip = trim(explode(',', $ip)[0]);
                }
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    return $ip;
                }
            }
        }
        
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }
    
    /**
     * Logger une erreur
     */
    private function log_error($message, $context = array()) {
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::error($message, $context);
        } else {
            error_log('[COL LMS API ERROR] ' . $message);
        }
    }
    
    /**
     * Logger un avertissement
     */
    private function log_warning($message, $context = array()) {
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::warning($message, $context);
        } else {
            error_log('[COL LMS API WARNING] ' . $message);
        }
    }
    
    /**
     * Logger une information
     */
    private function log_info($message, $context = array()) {
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::info($message, $context);
        }
    }
    
    /**
     * Logger un debug
     */
    private function log_debug($message, $context = array()) {
        if (class_exists('COL_LMS_Logger')) {
            COL_LMS_Logger::debug($message, $context);
        }
    }
    
    /**
     * Obtenir les informations du plugin
     */
    public function get_plugin_info() {
        return array(
            'name' => 'COL LMS Offline API',
            'version' => COL_LMS_API_VERSION,
            'namespace' => $this->namespace,
            'path' => COL_LMS_API_PATH,
            'url' => COL_LMS_API_URL,
            'file' => COL_LMS_API_FILE,
            'initialized' => $this->initialized,
            'loaded_classes' => $this->loaded_classes,
            'config' => $this->config
        );
    }
    
    /**
     * Afficher les notices administrateur pour les plugins manquants
     */
    public function learnpress_missing_notice() {
        ?>
        <div class="notice notice-error">
            <p><?php _e('COL LMS Offline API nécessite LearnPress pour fonctionner. Veuillez installer et activer LearnPress.', 'col-lms-offline-api'); ?></p>
        </div>
        <?php
    }
    
    /**
     * Notice d'information pour Paid Memberships Pro
     */
    public function pmpro_info_notice() {
        if (get_user_meta(get_current_user_id(), 'col_lms_pmpro_notice_dismissed', true)) {
            return;
        }
        ?>
        <div class="notice notice-info is-dismissible" data-notice="col_lms_pmpro">
            <p><?php _e('COL LMS Offline API : Paid Memberships Pro n\'est pas installé. Les fonctionnalités d\'abonnement sont désactivées.', 'col-lms-offline-api'); ?></p>
        </div>
        <script>
        jQuery(document).ready(function($) {
            $(document).on('click', '.notice[data-notice="col_lms_pmpro"] .notice-dismiss', function() {
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    data: {
                        action: 'col_lms_dismiss_notice',
                        notice: 'pmpro',
                        _wpnonce: '<?php echo wp_create_nonce('col_lms_dismiss_notice'); ?>'
                    }
                });
            });
        });
        </script>
        <?php
    }
}

// Initialiser le plugin
function col_lms_offline_api_init() {
    return COL_LMS_Offline_API::instance();
}

// Charger le plugin après que tous les plugins soient chargés
add_action('plugins_loaded', 'col_lms_offline_api_init', 10);

// Fonctions utilitaires globales

/**
 * Obtenir l'instance principale du plugin
 * 
 * @return COL_LMS_Offline_API
 */
function col_lms_api() {
    return COL_LMS_Offline_API::instance();
}

/**
 * Vérifier si l'API est disponible
 * 
 * @return bool
 */
function col_lms_api_is_available() {
    return col_lms_api()->is_api_enabled();
}

/**
 * Obtenir la configuration de l'API
 * 
 * @param string $key
 * @param mixed $default
 * @return mixed
 */
function col_lms_get_config($key, $default = null) {
    return col_lms_api()->get_config($key, $default);
}

/**
 * Logger une action via l'API
 * 
 * @param string $action
 * @param array $context
 */
function col_lms_log_action($action, $context = array()) {
    if (class_exists('COL_LMS_Logger')) {
        COL_LMS_Logger::info($action, $context);
    }
}

// Hook de vérification de compatibilité au chargement
add_action('plugins_loaded', function() {
    if (!class_exists('LearnPress')) {
        add_action('admin_notices', array(col_lms_api(), 'learnpress_missing_notice'));
    }
    
    if (!function_exists('pmpro_hasMembershipLevel')) {
        add_action('admin_notices', array(col_lms_api(), 'pmpro_info_notice'));
    }
}, 11);

// Fin du fichier - Pas de balise PHP fermante pour éviter les sorties accidentelles
