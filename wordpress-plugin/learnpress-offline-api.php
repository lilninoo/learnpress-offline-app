<?php
/**
 * Plugin Name: COL LMS Offline API
 * Plugin URI: https://votre-site.com/
 * Description: API REST pour application mobile LMS avec support LearnPress et Paid Memberships Pro
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

// Classe principale du plugin
class COL_LMS_Offline_API {
    
    private static $instance = null;
    private $namespace = COL_LMS_API_NAMESPACE;
    
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
        // Hooks d'initialisation
        add_action('init', array($this, 'init'));
        add_action('rest_api_init', array($this, 'register_routes'));
        
        // Activation/Désactivation
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
        
        // Nettoyage programmé
        add_action('col_lms_cleanup_tokens', array($this, 'cleanup_expired_tokens'));
        add_action('col_lms_create_package', array($this, 'create_package_handler'));
    }
    
    /**
     * Initialisation du plugin
     */
    public function init() {
        // Vérifier que LearnPress est actif
        if (!class_exists('LearnPress')) {
            add_action('admin_notices', array($this, 'learnpress_missing_notice'));
            return;
        }
        
        // Vérifier que Paid Memberships Pro est actif (optionnel)
        if (!function_exists('pmpro_hasMembershipLevel')) {
            add_action('admin_notices', array($this, 'pmpro_info_notice'));
        }
        
        // Charger les traductions
        load_plugin_textdomain('col-lms-offline-api', false, dirname(plugin_basename(__FILE__)) . '/languages');
    }
    
    /**
     * Activation du plugin
     */
    public function activate() {
        // Vérifier que LearnPress est installé
        if (!class_exists('LearnPress')) {
            wp_die(__('COL LMS Offline API nécessite LearnPress pour fonctionner.', 'col-lms-offline-api'));
        }
        
        // Créer les tables nécessaires
        $this->create_tables();
        
        // Programmer le nettoyage des tokens
        if (!wp_next_scheduled('col_lms_cleanup_tokens')) {
            wp_schedule_event(time(), 'hourly', 'col_lms_cleanup_tokens');
        }
        
        // Flush les règles de réécriture
        flush_rewrite_rules();
        
        // Mettre à jour la version dans les options
        update_option('col_lms_api_version', COL_LMS_API_VERSION);
    }
    
    /**
     * Désactivation du plugin
     */
    public function deactivate() {
        // Supprimer les tâches programmées
        wp_clear_scheduled_hook('col_lms_cleanup_tokens');
        
        // Flush les règles de réécriture
        flush_rewrite_rules();
    }
    
    /**
     * Créer les tables de la base de données
     */
    private function create_tables() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        $sql = "CREATE TABLE IF NOT EXISTS $table_name (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            user_id bigint(20) NOT NULL,
            device_id varchar(255) NOT NULL,
            token_hash varchar(255) NOT NULL,
            refresh_token_hash varchar(255) NOT NULL,
            expires_at datetime NOT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY user_device (user_id, device_id),
            KEY token_hash (token_hash)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }
    
    /**
     * Enregistrer les routes de l'API REST
     */
    public function register_routes() {
        // Route d'authentification
        register_rest_route($this->namespace, '/auth/login', array(
            'methods' => 'POST',
            'callback' => array($this, 'login'),
            'permission_callback' => '__return_true',
            'args' => array(
                'username' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ),
                'password' => array(
                    'required' => true,
                    'type' => 'string',
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ),
            ),
        ));
        
        // Route de rafraîchissement du token
        register_rest_route($this->namespace, '/auth/refresh', array(
            'methods' => 'POST',
            'callback' => array($this, 'refresh_token'),
            'permission_callback' => '__return_true',
            'args' => array(
                'refresh_token' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ),
            ),
        ));
        
        // Route de vérification
        register_rest_route($this->namespace, '/auth/verify', array(
            'methods' => 'GET',
            'callback' => array($this, 'verify_subscription'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Route de déconnexion
        register_rest_route($this->namespace, '/auth/logout', array(
            'methods' => 'POST',
            'callback' => array($this, 'logout'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Routes des cours
        register_rest_route($this->namespace, '/courses', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_courses'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'page' => array(
                    'default' => 1,
                    'type' => 'integer',
                    'sanitize_callback' => 'absint',
                ),
                'per_page' => array(
                    'default' => 20,
                    'type' => 'integer',
                    'sanitize_callback' => 'absint',
                ),
            ),
        ));
        
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_details'),
            'permission_callback' => array($this, 'check_auth'),
            'args' => array(
                'id' => array(
                    'validate_callback' => function($param) {
                        return is_numeric($param);
                    }
                ),
            ),
        ));
        
        // Route de création de package
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/package', array(
            'methods' => 'POST',
            'callback' => array($this, 'create_course_package'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Route pour obtenir le statut d'un package
        register_rest_route($this->namespace, '/packages/(?P<id>[a-zA-Z0-9-]+)/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_package_status'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Route de synchronisation de la progression
        register_rest_route($this->namespace, '/progress/sync', array(
            'methods' => 'POST',
            'callback' => array($this, 'sync_progress'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Route pour obtenir les informations sur les médias d'un cours
        register_rest_route($this->namespace, '/courses/(?P<id>\d+)/media', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_course_media'),
            'permission_callback' => array($this, 'check_auth'),
        ));
        
        // Route pour obtenir le contenu d'une leçon
        register_rest_route($this->namespace, '/lessons/(?P<id>\d+)/content', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_lesson_content'),
            'permission_callback' => array($this, 'check_auth'),
        ));
    }
    
    /**
     * Authentification
     */
    public function login($request) {
        $username = $request->get_param('username');
        $password = $request->get_param('password');
        $device_id = $request->get_param('device_id');
        
        // Authentifier l'utilisateur
        $user = wp_authenticate($username, $password);
        
        if (is_wp_error($user)) {
            return new WP_Error(
                'invalid_credentials', 
                __('Nom d\'utilisateur ou mot de passe incorrect', 'col-lms-offline-api'), 
                array('status' => 401)
            );
        }
        
        // Vérifier l'abonnement Paid Memberships Pro
        if (function_exists('pmpro_hasMembershipLevel')) {
            if (!pmpro_hasMembershipLevel(null, $user->ID)) {
                return new WP_Error(
                    'no_membership', 
                    __('Vous devez avoir un abonnement actif pour utiliser l\'application', 'col-lms-offline-api'), 
                    array('status' => 403)
                );
            }
        }
        
        // Générer les tokens
        $token = $this->generate_token($user->ID, $device_id);
        $refresh_token = $this->generate_refresh_token($user->ID, $device_id);
        
        // Sauvegarder les tokens dans la base de données
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        // Supprimer les anciens tokens pour ce device
        $wpdb->delete($table_name, array(
            'user_id' => $user->ID,
            'device_id' => $device_id
        ));
        
        // Insérer les nouveaux tokens
        $wpdb->insert($table_name, array(
            'user_id' => $user->ID,
            'device_id' => $device_id,
            'token_hash' => wp_hash($token),
            'refresh_token_hash' => wp_hash($refresh_token),
            'expires_at' => date('Y-m-d H:i:s', time() + 3600), // 1 heure
        ));
        
        // Récupérer les informations de l'abonnement
        $membership_info = array();
        if (function_exists('pmpro_getMembershipLevelForUser')) {
            $level = pmpro_getMembershipLevelForUser($user->ID);
            if ($level) {
                $membership_info = array(
                    'level_id' => $level->id,
                    'level_name' => $level->name,
                    'expiration_date' => $level->enddate
                );
            }
        }
        
        return array(
            'token' => $token,
            'refresh_token' => $refresh_token,
            'expires_in' => 3600,
            'user' => array(
                'id' => $user->ID,
                'username' => $user->user_login,
                'email' => $user->user_email,
                'display_name' => $user->display_name,
                'membership' => $membership_info
            ),
        );
    }
    
    /**
     * Rafraîchir le token
     */
    public function refresh_token($request) {
        $refresh_token = $request->get_param('refresh_token');
        
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        // Rechercher le token
        $token_data = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table_name WHERE refresh_token_hash = %s",
            wp_hash($refresh_token)
        ));
        
        if (!$token_data) {
            return new WP_Error(
                'invalid_token', 
                __('Token de rafraîchissement invalide', 'col-lms-offline-api'), 
                array('status' => 401)
            );
        }
        
        // Vérifier que l'utilisateur a toujours un abonnement actif
        if (function_exists('pmpro_hasMembershipLevel')) {
            if (!pmpro_hasMembershipLevel(null, $token_data->user_id)) {
                return new WP_Error(
                    'membership_expired', 
                    __('Votre abonnement a expiré', 'col-lms-offline-api'), 
                    array('status' => 403)
                );
            }
        }
        
        // Générer un nouveau token
        $new_token = $this->generate_token($token_data->user_id, $token_data->device_id);
        
        // Mettre à jour en base
        $wpdb->update(
            $table_name,
            array(
                'token_hash' => wp_hash($new_token),
                'expires_at' => date('Y-m-d H:i:s', time() + 3600),
            ),
            array('id' => $token_data->id)
        );
        
        return array(
            'token' => $new_token,
            'expires_in' => 3600,
        );
    }
    
    /**
     * Vérifier l'abonnement
     */
    public function verify_subscription($request) {
        $user_id = $this->get_current_user_id();
        
        $subscription_info = array(
            'is_active' => true,
            'subscription' => array(
                'status' => 'active',
                'expires_at' => null,
            )
        );
        
        // Vérifier avec Paid Memberships Pro
        if (function_exists('pmpro_getMembershipLevelForUser')) {
            $level = pmpro_getMembershipLevelForUser($user_id);
            
            if (!$level) {
                $subscription_info['is_active'] = false;
                $subscription_info['subscription']['status'] = 'expired';
            } else {
                $subscription_info['subscription']['level_id'] = $level->id;
                $subscription_info['subscription']['level_name'] = $level->name;
                $subscription_info['subscription']['expires_at'] = $level->enddate;
                
                // Vérifier si l'abonnement est expiré
                if ($level->enddate && strtotime($level->enddate) < time()) {
                    $subscription_info['is_active'] = false;
                    $subscription_info['subscription']['status'] = 'expired';
                }
            }
        }
        
        return $subscription_info;
    }
    
    /**
     * Déconnexion
     */
    public function logout($request) {
        $user_id = $this->get_current_user_id();
        
        if ($user_id) {
            global $wpdb;
            $table_name = $wpdb->prefix . 'col_lms_tokens';
            
            // Supprimer tous les tokens de l'utilisateur
            $wpdb->delete($table_name, array('user_id' => $user_id));
        }
        
        return array('success' => true);
    }
    
    /**
     * Obtenir la liste des cours
     */
    public function get_courses($request) {
        $page = $request->get_param('page');
        $per_page = $request->get_param('per_page');
        $user_id = $this->get_current_user_id();
        
        $args = array(
            'post_type' => 'lp_course',
            'posts_per_page' => $per_page,
            'paged' => $page,
            'post_status' => 'publish',
        );
        
        // Filtrer selon l'abonnement Paid Memberships Pro
        if (function_exists('pmpro_getMembershipLevelForUser')) {
            $user_level = pmpro_getMembershipLevelForUser($user_id);
            
            // Obtenir les cours accessibles selon le niveau d'abonnement
            if ($user_level) {
                // Récupérer les catégories de cours autorisées pour ce niveau
                $allowed_categories = get_option('pmpro_level_' . $user_level->id . '_categories', array());
                
                if (!empty($allowed_categories)) {
                    $args['tax_query'] = array(
                        array(
                            'taxonomy' => 'course_category',
                            'field' => 'term_id',
                            'terms' => $allowed_categories,
                        ),
                    );
                }
            }
        }
        
        // Si l'utilisateur a des cours spécifiques (LearnPress)
        if (function_exists('learn_press_get_user_courses')) {
            $enrolled_courses = learn_press_get_user_courses($user_id, array(
                'status' => array('enrolled', 'finished'),
            ));
            
            if (!empty($enrolled_courses)) {
                // Si des cours spécifiques sont assignés, les prioriser
                if (empty($args['post__in'])) {
                    $args['post__in'] = wp_list_pluck($enrolled_courses, 'ID');
                }
            }
        }
        
        $query = new WP_Query($args);
        $courses = array();
        
        foreach ($query->posts as $post) {
            $course = learn_press_get_course($post->ID);
            
            // Vérifier l'accès au cours
            $has_access = $this->user_can_access_course($user_id, $post->ID);
            
            if (!$has_access) {
                continue;
            }
            
            $instructor = get_userdata($post->post_author);
            
            // Récupérer les métadonnées du cours
            $course_data = array(
                'id' => $post->ID,
                'title' => $post->post_title,
                'description' => $post->post_excerpt,
                'thumbnail' => get_the_post_thumbnail_url($post->ID, 'medium'),
                'instructor' => array(
                    'id' => $post->post_author,
                    'name' => $instructor ? $instructor->display_name : __('Instructeur', 'col-lms-offline-api'),
                ),
                'lessons_count' => $course->count_items('lp_lesson'),
                'sections_count' => count($course->get_sections()),
                'duration' => $course->get_duration(),
                'level' => get_post_meta($post->ID, '_lp_level', true) ?: 'all',
                'version' => get_post_meta($post->ID, '_lp_course_version', true) ?: 1,
                'price' => $course->get_price(),
                'sale_price' => $course->get_sale_price(),
                'regular_price' => $course->get_regular_price(),
                'is_free' => $course->is_free(),
            );
            
            // Ajouter les informations sur la taille des médias
            $course_data['video_size'] = $this->estimate_course_video_size($post->ID);
            $course_data['document_size'] = $this->estimate_course_document_size($post->ID);
            
            $courses[] = $course_data;
        }
        
        return array(
            'courses' => $courses,
            'total' => $query->found_posts,
            'pages' => $query->max_num_pages,
        );
    }
    
    /**
     * Obtenir les détails d'un cours
     */
    public function get_course_details($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès au cours
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return new WP_Error(
                'no_access', 
                __('Vous n\'avez pas accès à ce cours', 'col-lms-offline-api'), 
                array('status' => 403)
            );
        }
        
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return new WP_Error(
                'not_found', 
                __('Cours non trouvé', 'col-lms-offline-api'), 
                array('status' => 404)
            );
        }
        
        // Récupérer les sections et leçons
        $curriculum = $course->get_curriculum();
        $sections_data = array();
        
        if ($curriculum) {
            foreach ($curriculum as $section) {
                $section_data = array(
                    'id' => $section->get_id(),
                    'title' => $section->get_title(),
                    'description' => $section->get_description(),
                    'order' => $section->get_order(),
                    'lessons' => array(),
                );
                
                $items = $section->get_items();
                if ($items) {
                    foreach ($items as $item) {
                        $lesson_data = array(
                            'id' => $item->get_id(),
                            'title' => $item->get_title(),
                            'type' => $item->get_item_type(),
                            'duration' => $item->get_duration(),
                            'preview' => $item->is_preview(),
                            'order' => $item->get_order(),
                        );
                        
                        // Ajouter le contenu si c'est une leçon
                        if ($item->get_item_type() === 'lp_lesson') {
                            $lesson_post = get_post($item->get_id());
                            $lesson_data['content'] = $lesson_post ? $lesson_post->post_content : '';
                            
                            // Récupérer les médias attachés
                            $lesson_data['attachments'] = $this->get_lesson_attachments($item->get_id());
                        }
                        
                        $section_data['lessons'][] = $lesson_data;
                    }
                }
                
                $sections_data[] = $section_data;
            }
        }
        
        return array(
            'course' => array(
                'id' => $course_id,
                'title' => $course->get_title(),
                'description' => $course->get_description(),
                'content' => $course->get_content(),
                'sections' => $sections_data,
                'author' => array(
                    'id' => $course->get_author()->get_id(),
                    'name' => $course->get_author()->get_data('display_name'),
                ),
                'featured_image' => get_the_post_thumbnail_url($course_id, 'full'),
            ),
        );
    }
    
    /**
     * Créer un package de cours pour téléchargement
     */
    public function create_course_package($request) {
        $course_id = $request->get_param('id');
        $options = $request->get_param('options') ?: array();
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return new WP_Error(
                'no_access', 
                __('Vous n\'avez pas accès à ce cours', 'col-lms-offline-api'), 
                array('status' => 403)
            );
        }
        
        // Créer un ID de package unique
        $package_id = wp_generate_uuid4();
        
        // Options par défaut
        $default_options = array(
            'include_videos' => true,
            'include_documents' => true,
            'compress_images' => true,
            'encryption_enabled' => true,
        );
        
        $options = wp_parse_args($options, $default_options);
        
        // Sauvegarder les informations du package
        set_transient('col_lms_package_' . $package_id, array(
            'course_id' => $course_id,
            'user_id' => $user_id,
            'options' => $options,
            'status' => 'processing',
            'progress' => 0,
            'created_at' => time(),
        ), 3600); // Expire après 1 heure
        
        // Lancer la création du package en arrière-plan
        wp_schedule_single_event(time(), 'col_lms_create_package', array($package_id));
        
        return array(
            'package_id' => $package_id,
            'status' => 'processing',
            'message' => __('La création du package a commencé', 'col-lms-offline-api'),
        );
    }
    
    /**
     * Obtenir le statut d'un package
     */
    public function get_package_status($request) {
        $package_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        $package_data = get_transient('col_lms_package_' . $package_id);
        
        if (!$package_data) {
            return new WP_Error(
                'not_found', 
                __('Package non trouvé', 'col-lms-offline-api'), 
                array('status' => 404)
            );
        }
        
        // Vérifier que l'utilisateur est le propriétaire du package
        if ($package_data['user_id'] != $user_id) {
            return new WP_Error(
                'no_access', 
                __('Accès non autorisé', 'col-lms-offline-api'), 
                array('status' => 403)
            );
        }
        
        $response = array(
            'package_id' => $package_id,
            'status' => $package_data['status'],
            'progress' => $package_data['progress'],
        );
        
        if ($package_data['status'] === 'completed' && isset($package_data['files'])) {
            $response['files'] = $package_data['files'];
        }
        
        if (isset($package_data['error'])) {
            $response['error'] = $package_data['error'];
        }
        
        return $response;
    }
    
    /**
     * Synchroniser la progression
     */
    public function sync_progress($request) {
        $progress_data = $request->get_param('progress_data');
        $user_id = $this->get_current_user_id();
        
        $synced = array();
        $errors = array();
        
        // Synchroniser les leçons
        if (!empty($progress_data['lessons'])) {
            foreach ($progress_data['lessons'] as $lesson_data) {
                try {
                    $lesson_id = intval($lesson_data['id']);
                    
                    // Vérifier l'accès au cours de cette leçon
                    $course_id = learn_press_get_course_by_item($lesson_id);
                    if (!$this->user_can_access_course($user_id, $course_id)) {
                        throw new Exception(__('Accès non autorisé', 'col-lms-offline-api'));
                    }
                    
                    // Obtenir l'item utilisateur
                    $user = learn_press_get_user($user_id);
                    $course = learn_press_get_course($course_id);
                    $user_item = $user->get_item($lesson_id, $course_id);
                    
                    if ($user_item) {
                        // Mettre à jour la progression
                        if (isset($lesson_data['progress'])) {
                            learn_press_update_user_item_meta($user_item->get_user_item_id(), 'progress', $lesson_data['progress']);
                        }
                        
                        // Mettre à jour le statut
                        if (isset($lesson_data['completed']) && $lesson_data['completed']) {
                            $user_item->complete();
                        }
                        
                        $synced[] = array('type' => 'lesson', 'id' => $lesson_id);
                    }
                } catch (Exception $e) {
                    $errors[] = array(
                        'type' => 'lesson',
                        'id' => $lesson_data['id'],
                        'error' => $e->getMessage(),
                    );
                }
            }
        }
        
        // Synchroniser les quiz
        if (!empty($progress_data['quizzes'])) {
            foreach ($progress_data['quizzes'] as $quiz_data) {
                try {
                    $quiz_id = intval($quiz_data['id']);
                    
                    // Vérifier l'accès
                    $course_id = learn_press_get_course_by_item($quiz_id);
                    if (!$this->user_can_access_course($user_id, $course_id)) {
                        throw new Exception(__('Accès non autorisé', 'col-lms-offline-api'));
                    }
                    
                    // Traiter les résultats du quiz
                    // ... (implémenter selon votre logique)
                    
                    $synced[] = array('type' => 'quiz', 'id' => $quiz_id);
                } catch (Exception $e) {
                    $errors[] = array(
                        'type' => 'quiz',
                        'id' => $quiz_data['id'],
                        'error' => $e->getMessage(),
                    );
                }
            }
        }
        
        return array(
            'synced' => $synced,
            'errors' => $errors,
            'message' => sprintf(
                __('%d éléments synchronisés, %d erreurs', 'col-lms-offline-api'),
                count($synced),
                count($errors)
            ),
        );
    }
    
    /**
     * Obtenir les médias d'un cours
     */
    public function get_course_media($request) {
        $course_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return new WP_Error(
                'no_access', 
                __('Vous n\'avez pas accès à ce cours', 'col-lms-offline-api'), 
                array('status' => 403)
            );
        }
        
        $media = array();
        $course = learn_press_get_course($course_id);
        
        if (!$course) {
            return new WP_Error(
                'not_found', 
                __('Cours non trouvé', 'col-lms-offline-api'), 
                array('status' => 404)
            );
        }
        
        // Récupérer tous les médias du cours
        $curriculum = $course->get_curriculum();
        
        if ($curriculum) {
            foreach ($curriculum as $section) {
                $items = $section->get_items();
                if ($items) {
                    foreach ($items as $item) {
                        if ($item->get_item_type() === 'lp_lesson') {
                            $lesson_media = $this->get_lesson_attachments($item->get_id());
                            $media = array_merge($media, $lesson_media);
                        }
                    }
                }
            }
        }
        
        return array(
            'media' => $media,
            'count' => count($media),
        );
    }
    
    /**
     * Obtenir le contenu d'une leçon
     */
    public function get_lesson_content($request) {
        $lesson_id = $request->get_param('id');
        $user_id = $this->get_current_user_id();
        
        // Vérifier l'accès
        $course_id = learn_press_get_course_by_item($lesson_id);
        if (!$this->user_can_access_course($user_id, $course_id)) {
            return new WP_Error(
                'no_access', 
                __('Vous n\'avez pas accès à cette leçon', 'col-lms-offline-api'), 
                array('status' => 403)
            );
        }
        
        $lesson = learn_press_get_lesson($lesson_id);
        if (!$lesson) {
            return new WP_Error(
                'not_found', 
                __('Leçon non trouvée', 'col-lms-offline-api'), 
                array('status' => 404)
            );
        }
        
        $lesson_post = get_post($lesson_id);
        
        return array(
            'lesson' => array(
                'id' => $lesson_id,
                'title' => $lesson->get_title(),
                'content' => apply_filters('the_content', $lesson_post->post_content),
                'duration' => $lesson->get_duration(),
                'attachments' => $this->get_lesson_attachments($lesson_id),
                'video_url' => get_post_meta($lesson_id, '_lp_lesson_video_url', true),
            ),
        );
    }
    
    /**
     * Vérifier l'authentification
     */
    public function check_auth($request) {
        $headers = $request->get_headers();
        
        if (!isset($headers['authorization'][0])) {
            return false;
        }
        
        $auth_header = $headers['authorization'][0];
        if (strpos($auth_header, 'Bearer ') !== 0) {
            return false;
        }
        
        $token = substr($auth_header, 7);
        $user_id = $this->validate_token($token);
        
        return $user_id !== false;
    }
    
    /**
     * Générer un token JWT simple
     */
    private function generate_token($user_id, $device_id) {
        $payload = array(
            'iss' => get_site_url(),
            'aud' => 'col-lms-offline',
            'iat' => time(),
            'exp' => time() + 3600,
            'user_id' => $user_id,
            'device_id' => $device_id,
        );
        
        $header = base64_encode(json_encode(array('typ' => 'JWT', 'alg' => 'HS256')));
        $payload = base64_encode(json_encode($payload));
        $signature = base64_encode(hash_hmac('sha256', $header . '.' . $payload, wp_salt('auth'), true));
        
        return $header . '.' . $payload . '.' . $signature;
    }
    
    /**
     * Générer un refresh token
     */
    private function generate_refresh_token($user_id, $device_id) {
        return wp_hash($user_id . $device_id . wp_generate_password(32, true, true));
    }
    
    /**
     * Valider un token
     */
    private function validate_token($token) {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return false;
        }
        
        $header = $parts[0];
        $payload = $parts[1];
        $signature = $parts[2];
        
        // Vérifier la signature
        $expected_signature = base64_encode(hash_hmac('sha256', $header . '.' . $payload, wp_salt('auth'), true));
        if ($signature !== $expected_signature) {
            return false;
        }
        
        // Décoder le payload
        $payload_data = json_decode(base64_decode($payload), true);
        
        // Vérifier l'expiration
        if (!isset($payload_data['exp']) || $payload_data['exp'] < time()) {
            return false;
        }
        
        // Vérifier en base de données
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        $token_exists = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $table_name 
            WHERE user_id = %d 
            AND device_id = %s 
            AND token_hash = %s 
            AND expires_at > NOW()",
            $payload_data['user_id'],
            $payload_data['device_id'],
            wp_hash($token)
        ));
        
        if (!$token_exists) {
            return false;
        }
        
        return $payload_data['user_id'];
    }
    
    /**
     * Obtenir l'ID de l'utilisateur actuel
     */
    private function get_current_user_id() {
        $headers = getallheaders();
        if (!$headers) {
            $headers = $this->get_all_headers();
        }
        
        $auth_header = isset($headers['Authorization']) ? $headers['Authorization'] : '';
        if (empty($auth_header)) {
            $auth_header = isset($headers['authorization']) ? $headers['authorization'] : '';
        }
        
        if (empty($auth_header) || strpos($auth_header, 'Bearer ') !== 0) {
            return false;
        }
        
        $token = substr($auth_header, 7);
        return $this->validate_token($token);
    }
    
    /**
     * Obtenir tous les headers (fallback)
     */
    private function get_all_headers() {
        $headers = array();
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) == 'HTTP_') {
                $headers[str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))))] = $value;
            }
        }
        return $headers;
    }
    
    /**
     * Vérifier si l'utilisateur peut accéder au cours
     */
    private function user_can_access_course($user_id, $course_id) {
        // Vérifier avec LearnPress
        if (function_exists('learn_press_is_enrolled_course')) {
            $is_enrolled = learn_press_is_enrolled_course($course_id, $user_id);
            if ($is_enrolled) {
                return true;
            }
        }
        
        // Vérifier avec Paid Memberships Pro
        if (function_exists('pmpro_has_membership_access')) {
            $has_access = pmpro_has_membership_access($course_id, $user_id);
            if ($has_access) {
                return true;
            }
        }
        
        // Vérifier si le cours est gratuit ou en preview
        $course = learn_press_get_course($course_id);
        if ($course && ($course->is_free() || $course->is_preview())) {
            return true;
        }
        
        // Vérifier si l'utilisateur est admin ou instructeur du cours
        if (user_can($user_id, 'manage_options') || get_post_field('post_author', $course_id) == $user_id) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Obtenir les pièces jointes d'une leçon
     */
    private function get_lesson_attachments($lesson_id) {
        $attachments = array();
        
        // Récupérer les médias attachés au post
        $args = array(
            'post_type' => 'attachment',
            'posts_per_page' => -1,
            'post_parent' => $lesson_id,
        );
        
        $media_query = new WP_Query($args);
        
        foreach ($media_query->posts as $attachment) {
            $attachments[] = array(
                'id' => $attachment->ID,
                'title' => $attachment->post_title,
                'filename' => basename(get_attached_file($attachment->ID)),
                'url' => wp_get_attachment_url($attachment->ID),
                'type' => $attachment->post_mime_type,
                'size' => filesize(get_attached_file($attachment->ID)),
            );
        }
        
        // Récupérer aussi les URLs de vidéos externes
        $video_url = get_post_meta($lesson_id, '_lp_lesson_video_url', true);
        if ($video_url) {
            $attachments[] = array(
                'id' => 'video_' . $lesson_id,
                'title' => 'Vidéo de la leçon',
                'url' => $video_url,
                'type' => 'video/external',
            );
        }
        
        return $attachments;
    }
    
    /**
     * Estimer la taille des vidéos d'un cours
     */
    private function estimate_course_video_size($course_id) {
        // Estimation basique : 100 MB par heure de vidéo
        $course = learn_press_get_course($course_id);
        if (!$course) {
            return 0;
        }
        
        $duration = $course->get_duration();
        if (!$duration) {
            return 500 * 1024 * 1024; // 500 MB par défaut
        }
        
        // Convertir la durée en heures
        $hours = 1; // Par défaut
        if (preg_match('/(\d+)\s*h/i', $duration, $matches)) {
            $hours = intval($matches[1]);
        }
        
        return $hours * 100 * 1024 * 1024; // 100 MB par heure
    }
    
    /**
     * Estimer la taille des documents d'un cours
     */
    private function estimate_course_document_size($course_id) {
        // Estimation : 50 MB pour les documents
        return 50 * 1024 * 1024;
    }
    
    /**
     * Créer un package de cours (handler)
     */
    public function create_package_handler($package_id) {
        $package_data = get_transient('col_lms_package_' . $package_id);
        if (!$package_data) {
            return;
        }
        
        try {
            $course_id = $package_data['course_id'];
            $options = $package_data['options'];
            
            // Mettre à jour le statut
            $package_data['status'] = 'processing';
            $package_data['progress'] = 10;
            set_transient('col_lms_package_' . $package_id, $package_data, 3600);
            
            // Collecter tous les fichiers du cours
            $files = array();
            $course = learn_press_get_course($course_id);
            
            if (!$course) {
                throw new Exception(__('Cours non trouvé', 'col-lms-offline-api'));
            }
            
            // Créer le manifeste du cours
            $manifest = array(
                'course_id' => $course_id,
                'title' => $course->get_title(),
                'version' => get_post_meta($course_id, '_lp_course_version', true) ?: 1,
                'created_at' => date('Y-m-d H:i:s'),
                'files' => array(),
            );
            
            // Ajouter l'image principale du cours
            $thumbnail_id = get_post_thumbnail_id($course_id);
            if ($thumbnail_id) {
                $thumbnail_path = get_attached_file($thumbnail_id);
                if (file_exists($thumbnail_path)) {
                    $files[] = array(
                        'filename' => 'thumbnail.' . pathinfo($thumbnail_path, PATHINFO_EXTENSION),
                        'path' => $thumbnail_path,
                        'type' => 'image',
                    );
                }
            }
            
            $package_data['progress'] = 30;
            set_transient('col_lms_package_' . $package_id, $package_data, 3600);
            
            // Parcourir le curriculum
            $curriculum = $course->get_curriculum();
            if ($curriculum) {
                foreach ($curriculum as $section) {
                    $items = $section->get_items();
                    if ($items) {
                        foreach ($items as $item) {
                            if ($item->get_item_type() === 'lp_lesson') {
                                // Récupérer les médias de la leçon
                                $lesson_attachments = $this->get_lesson_attachments($item->get_id());
                                
                                foreach ($lesson_attachments as $attachment) {
                                    if (isset($attachment['url']) && $attachment['type'] !== 'video/external') {
                                        // Télécharger les fichiers locaux
                                        $file_path = get_attached_file($attachment['id']);
                                        if ($file_path && file_exists($file_path)) {
                                            $files[] = array(
                                                'filename' => 'lesson_' . $item->get_id() . '_' . $attachment['filename'],
                                                'path' => $file_path,
                                                'type' => strpos($attachment['type'], 'video') !== false ? 'video' : 'document',
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            $package_data['progress'] = 70;
            set_transient('col_lms_package_' . $package_id, $package_data, 3600);
            
            // Créer les URLs de téléchargement sécurisées
            $download_files = array();
            foreach ($files as $file) {
                if (($file['type'] === 'video' && !$options['include_videos']) ||
                    ($file['type'] === 'document' && !$options['include_documents'])) {
                    continue;
                }
                
                // Créer une URL temporaire sécurisée
                $download_url = $this->create_secure_download_url($file['path'], $package_id);
                
                $download_files[] = array(
                    'filename' => $file['filename'],
                    'download_url' => $download_url,
                    'size' => filesize($file['path']),
                    'type' => $file['type'],
                );
            }
            
            // Finaliser le package
            $package_data['status'] = 'completed';
            $package_data['progress'] = 100;
            $package_data['files'] = $download_files;
            $package_data['manifest'] = $manifest;
            
            set_transient('col_lms_package_' . $package_id, $package_data, 3600);
            
        } catch (Exception $e) {
            $package_data['status'] = 'error';
            $package_data['error'] = $e->getMessage();
            set_transient('col_lms_package_' . $package_id, $package_data, 3600);
        }
    }
    
    /**
     * Créer une URL de téléchargement sécurisée
     */
    private function create_secure_download_url($file_path, $package_id) {
        // Créer un token temporaire pour ce fichier
        $token = wp_hash($file_path . $package_id . time());
        
        // Sauvegarder le token temporairement
        set_transient('col_lms_download_' . $token, array(
            'file_path' => $file_path,
            'package_id' => $package_id,
            'expires' => time() + 3600,
        ), 3600);
        
        // Retourner l'URL de téléchargement
        return add_query_arg(array(
            'col_lms_download' => $token,
        ), home_url());
    }
    
    /**
     * Nettoyer les tokens expirés
     */
    public function cleanup_expired_tokens() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'col_lms_tokens';
        
        $wpdb->query("DELETE FROM $table_name WHERE expires_at < NOW()");
    }
    
    /**
     * Notice si LearnPress n'est pas installé
     */
    public function learnpress_missing_notice() {
        ?>
        <div class="notice notice-error">
            <p><?php _e('COL LMS Offline API nécessite LearnPress pour fonctionner. Veuillez installer et activer LearnPress.', 'col-lms-offline-api'); ?></p>
        </div>
        <?php
    }
    
    /**
     * Notice d'information sur Paid Memberships Pro
     */
    public function pmpro_info_notice() {
        // Ne pas afficher cette notice si elle a déjà été fermée
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
add_action('plugins_loaded', 'col_lms_offline_api_init');

// Gérer les téléchargements sécurisés
add_action('init', function() {
    if (isset($_GET['col_lms_download'])) {
        $token = sanitize_text_field($_GET['col_lms_download']);
        $download_data = get_transient('col_lms_download_' . $token);
        
        if ($download_data && $download_data['expires'] > time()) {
            $file_path = $download_data['file_path'];
            
            if (file_exists($file_path)) {
                // Forcer le téléchargement
                header('Content-Type: application/octet-stream');
                header('Content-Disposition: attachment; filename="' . basename($file_path) . '"');
                header('Content-Length: ' . filesize($file_path));
                readfile($file_path);
                
                // Supprimer le token après utilisation
                delete_transient('col_lms_download_' . $token);
                exit;
            }
        }
        
        wp_die(__('Lien de téléchargement invalide ou expiré', 'col-lms-offline-api'));
    }
});

// Gérer la fermeture des notices
add_action('wp_ajax_col_lms_dismiss_notice', function() {
    if (!wp_verify_nonce($_POST['_wpnonce'], 'col_lms_dismiss_notice')) {
        wp_die();
    }
    
    $notice = sanitize_text_field($_POST['notice']);
    if ($notice === 'pmpro') {
        update_user_meta(get_current_user_id(), 'col_lms_pmpro_notice_dismissed', true);
    }
    
    wp_die();
});
