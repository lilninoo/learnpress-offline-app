<?php
/**
 * Interface d'administration pour COL LMS Offline API
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

class COL_LMS_Admin {
    
    private $plugin_name = 'col-lms-offline-api';
    private $version = COL_LMS_API_VERSION;
    
    public function __construct() {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));
        add_action('wp_ajax_col_lms_get_stats', array($this, 'ajax_get_stats'));
        add_action('wp_ajax_col_lms_clear_tokens', array($this, 'ajax_clear_tokens'));
        add_action('wp_ajax_col_lms_test_api', array($this, 'ajax_test_api'));
        add_action('wp_ajax_col_lms_revoke_token', array($this, 'ajax_revoke_token'));
        add_action('wp_ajax_col_lms_export_stats', array($this, 'ajax_export_stats'));
        
        // Ajouter une colonne dans la liste des utilisateurs
        add_filter('manage_users_columns', array($this, 'add_user_columns'));
        add_filter('manage_users_custom_column', array($this, 'show_user_column_data'), 10, 3);
        
        // Ajouter des actions bulk
        add_filter('bulk_actions-users', array($this, 'add_bulk_actions'));
        add_filter('handle_bulk_actions-users', array($this, 'handle_bulk_actions'), 10, 3);
    }
    
    /**
     * Ajouter le menu d'administration
     */
    public function add_admin_menu() {
        // Menu principal
        add_menu_page(
            __('LMS Offline API', 'col-lms-offline-api'),
            __('LMS Offline API', 'col-lms-offline-api'),
            'manage_options',
            $this->plugin_name,
            array($this, 'display_admin_page'),
            'dashicons-download',
            30
        );
        
        // Sous-menus
        add_submenu_page(
            $this->plugin_name,
            __('Tableau de bord', 'col-lms-offline-api'),
            __('Tableau de bord', 'col-lms-offline-api'),
            'manage_options',
            $this->plugin_name,
            array($this, 'display_admin_page')
        );
        
        add_submenu_page(
            $this->plugin_name,
            __('Paramètres', 'col-lms-offline-api'),
            __('Paramètres', 'col-lms-offline-api'),
            'manage_options',
            $this->plugin_name . '-settings',
            array($this, 'display_settings_page')
        );
        
        add_submenu_page(
            $this->plugin_name,
            __('Activité', 'col-lms-offline-api'),
            __('Activité', 'col-lms-offline-api'),
            'manage_options',
            $this->plugin_name . '-activity',
            array($this, 'display_activity_page')
        );
        
        add_submenu_page(
            $this->plugin_name,
            __('Documentation', 'col-lms-offline-api'),
            __('Documentation', 'col-lms-offline-api'),
            'manage_options',
            $this->plugin_name . '-docs',
            array($this, 'display_docs_page')
        );
    }
    
    /**
     * Enregistrer les paramètres
     */
    public function register_settings() {
        // Groupe de paramètres généraux
        register_setting(
            'col_lms_general_settings',
            'col_lms_api_enabled',
            array(
                'type' => 'boolean',
                'default' => true,
                'sanitize_callback' => 'rest_sanitize_boolean'
            )
        );
        
        register_setting(
            'col_lms_general_settings',
            'col_lms_require_membership',
            array(
                'type' => 'boolean',
                'default' => false,
                'sanitize_callback' => 'rest_sanitize_boolean'
            )
        );
        
        register_setting(
            'col_lms_general_settings',
            'col_lms_allowed_membership_levels',
            array(
                'type' => 'array',
                'default' => array(),
                'sanitize_callback' => array($this, 'sanitize_membership_levels')
            )
        );
        
        register_setting(
            'col_lms_general_settings',
            'col_lms_token_lifetime',
            array(
                'type' => 'integer',
                'default' => 3600,
                'sanitize_callback' => 'absint'
            )
        );
        
        register_setting(
            'col_lms_general_settings',
            'col_lms_max_devices_per_user',
            array(
                'type' => 'integer',
                'default' => 5,
                'sanitize_callback' => 'absint'
            )
        );
        
        // Groupe de paramètres de sécurité
        register_setting(
            'col_lms_security_settings',
            'col_lms_enable_rate_limiting',
            array(
                'type' => 'boolean',
                'default' => true,
                'sanitize_callback' => 'rest_sanitize_boolean'
            )
        );
        
        register_setting(
            'col_lms_security_settings',
            'col_lms_rate_limit_requests',
            array(
                'type' => 'integer',
                'default' => 100,
                'sanitize_callback' => 'absint'
            )
        );
        
        register_setting(
            'col_lms_security_settings',
            'col_lms_rate_limit_window',
            array(
                'type' => 'integer',
                'default' => 3600,
                'sanitize_callback' => 'absint'
            )
        );
        
        register_setting(
            'col_lms_security_settings',
            'col_lms_enable_ip_whitelist',
            array(
                'type' => 'boolean',
                'default' => false,
                'sanitize_callback' => 'rest_sanitize_boolean'
            )
        );
        
        register_setting(
            'col_lms_security_settings',
            'col_lms_ip_whitelist',
            array(
                'type' => 'array',
                'default' => array(),
                'sanitize_callback' => array($this, 'sanitize_ip_list')
            )
        );
        
        // Groupe de paramètres de téléchargement
        register_setting(
            'col_lms_download_settings',
            'col_lms_enable_course_packages',
            array(
                'type' => 'boolean',
                'default' => true,
                'sanitize_callback' => 'rest_sanitize_boolean'
            )
        );
        
        register_setting(
            'col_lms_download_settings',
            'col_lms_package_expiry_hours',
            array(
                'type' => 'integer',
                'default' => 24,
                'sanitize_callback' => 'absint'
            )
        );
        
        register_setting(
            'col_lms_download_settings',
            'col_lms_max_package_size',
            array(
                'type' => 'integer',
                'default' => 2147483648,
                'sanitize_callback' => 'absint'
            )
        );
        
        register_setting(
            'col_lms_download_settings',
            'col_lms_allowed_file_types',
            array(
                'type' => 'array',
                'default' => array('pdf', 'doc', 'docx', 'mp4', 'mp3'),
                'sanitize_callback' => array($this, 'sanitize_file_types')
            )
        );
    }
    
    /**
     * Charger les assets admin
     */
    public function enqueue_admin_assets($hook) {
        // Vérifier si on est sur une page du plugin
        if (strpos($hook, $this->plugin_name) === false) {
            return;
        }
        
        // CSS Admin
        wp_enqueue_style(
            $this->plugin_name . '-admin',
            COL_LMS_API_URL . 'admin/css/admin.css',
            array(),
            $this->version
        );
        
        // JavaScript Admin
        wp_enqueue_script(
            $this->plugin_name . '-admin',
            COL_LMS_API_URL . 'admin/js/admin.js',
            array('jquery', 'wp-api'),
            $this->version,
            true
        );
        
        // Localisation JavaScript
        wp_localize_script($this->plugin_name . '-admin', 'col_lms_admin', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('col_lms_admin'),
            'rest_url' => rest_url(COL_LMS_API_NAMESPACE . '/'),
            'strings' => array(
                'confirm_clear_tokens' => __('Êtes-vous sûr de vouloir supprimer tous les tokens ?', 'col-lms-offline-api'),
                'test_success' => __('Test réussi !', 'col-lms-offline-api'),
                'test_failed' => __('Test échoué', 'col-lms-offline-api'),
                'loading' => __('Chargement...', 'col-lms-offline-api'),
                'error' => __('Erreur', 'col-lms-offline-api'),
                'success' => __('Succès', 'col-lms-offline-api')
            )
        ));
        
        // Chart.js pour les graphiques
        wp_enqueue_script(
            'chartjs',
            'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
            array(),
            '3.9.1'
        );
    }
    
    /**
     * Page principale du tableau de bord
     */
    public function display_admin_page() {
        global $wpdb;
        
        // Récupérer les statistiques
        $stats = $this->get_dashboard_stats();
        
        ?>
        <div class="wrap">
            <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
            
            <?php $this->display_notices(); ?>
            
            <!-- Statut de l'API -->
            <div class="col-lms-status-box <?php echo get_option('col_lms_api_enabled', true) ? 'active' : 'inactive'; ?>">
                <h2><?php _e('Statut de l\'API', 'col-lms-offline-api'); ?></h2>
                <p class="status">
                    <?php if (get_option('col_lms_api_enabled', true)): ?>
                        <span class="dashicons dashicons-yes-alt"></span>
                        <?php _e('API Active', 'col-lms-offline-api'); ?>
                    <?php else: ?>
                        <span class="dashicons dashicons-warning"></span>
                        <?php _e('API Inactive', 'col-lms-offline-api'); ?>
                    <?php endif; ?>
                </p>
                <p class="api-url">
                    <strong><?php _e('URL de l\'API:', 'col-lms-offline-api'); ?></strong><br>
                    <code><?php echo home_url('/wp-json/' . COL_LMS_API_NAMESPACE); ?></code>
                </p>
            </div>
            
            <!-- Statistiques -->
            <div class="col-lms-stats-grid">
                <div class="stat-box">
                    <h3><?php _e('Utilisateurs actifs', 'col-lms-offline-api'); ?></h3>
                    <div class="stat-number"><?php echo $stats['active_users']; ?></div>
                    <p class="stat-desc"><?php _e('Avec tokens valides', 'col-lms-offline-api'); ?></p>
                </div>
                
                <div class="stat-box">
                    <h3><?php _e('Appareils connectés', 'col-lms-offline-api'); ?></h3>
                    <div class="stat-number"><?php echo $stats['active_devices']; ?></div>
                    <p class="stat-desc"><?php _e('Total des appareils', 'col-lms-offline-api'); ?></p>
                </div>
                
                <div class="stat-box">
                    <h3><?php _e('Téléchargements', 'col-lms-offline-api'); ?></h3>
                    <div class="stat-number"><?php echo $stats['total_downloads']; ?></div>
                    <p class="stat-desc"><?php _e('Ce mois-ci', 'col-lms-offline-api'); ?></p>
                </div>
                
                <div class="stat-box">
                    <h3><?php _e('Synchronisations', 'col-lms-offline-api'); ?></h3>
                    <div class="stat-number"><?php echo $stats['sync_operations']; ?></div>
                    <p class="stat-desc"><?php _e('Dernières 24h', 'col-lms-offline-api'); ?></p>
                </div>
            </div>
            
            <!-- Graphiques -->
            <div class="col-lms-charts">
                <div class="chart-container">
                    <h3><?php _e('Activité API (7 derniers jours)', 'col-lms-offline-api'); ?></h3>
                    <canvas id="api-activity-chart"></canvas>
                </div>
                
                <div class="chart-container">
                    <h3><?php _e('Cours les plus téléchargés', 'col-lms-offline-api'); ?></h3>
                    <canvas id="popular-courses-chart"></canvas>
                </div>
            </div>
            
            <!-- Utilisateurs récents -->
            <div class="col-lms-recent-users">
                <h3><?php _e('Connexions récentes', 'col-lms-offline-api'); ?></h3>
                <table class="wp-list-table widefat fixed striped">
                    <thead>
                        <tr>
                            <th><?php _e('Utilisateur', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Appareil', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Dernière activité', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Actions', 'col-lms-offline-api'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (!empty($stats['recent_logins'])): ?>
                            <?php foreach ($stats['recent_logins'] as $login): ?>
                            <tr>
                                <td>
                                    <?php
                                    $user = get_userdata($login->user_id);
                                    echo $user ? esc_html($user->display_name) : __('Utilisateur supprimé', 'col-lms-offline-api');
                                    ?>
                                </td>
                                <td><?php echo esc_html($login->device_name ?: $login->device_id); ?></td>
                                <td><?php echo $login->last_used ? human_time_diff(strtotime($login->last_used), current_time('timestamp')) . ' ' . __('ago', 'col-lms-offline-api') : __('Jamais', 'col-lms-offline-api'); ?></td>
                                <td>
                                    <button class="button button-small revoke-token" data-token-id="<?php echo $login->id; ?>">
                                        <?php _e('Révoquer', 'col-lms-offline-api'); ?>
                                    </button>
                                </td>
                            </tr>
                            <?php endforeach; ?>
                        <?php else: ?>
                            <tr>
                                <td colspan="4"><?php _e('Aucune connexion récente', 'col-lms-offline-api'); ?></td>
                            </tr>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
            
            <!-- Actions rapides -->
            <div class="col-lms-quick-actions">
                <h3><?php _e('Actions rapides', 'col-lms-offline-api'); ?></h3>
                <p>
                    <button class="button button-primary" id="test-api">
                        <?php _e('Tester l\'API', 'col-lms-offline-api'); ?>
                    </button>
                    <button class="button" id="clear-expired-tokens">
                        <?php _e('Nettoyer les tokens expirés', 'col-lms-offline-api'); ?>
                    </button>
                    <button class="button" id="export-stats">
                        <?php _e('Exporter les statistiques', 'col-lms-offline-api'); ?>
                    </button>
                    <a href="<?php echo admin_url('admin.php?page=' . $this->plugin_name . '-settings'); ?>" class="button">
                        <?php _e('Paramètres', 'col-lms-offline-api'); ?>
                    </a>
                </p>
            </div>
        </div>
        
        <script>
        jQuery(document).ready(function($) {
            // Charger les données des graphiques
            if (typeof loadChartData === 'function') {
                loadChartData();
            }
        });
        </script>
        <?php
    }
    
    /**
     * Page des paramètres
     */
    public function display_settings_page() {
        // Traitement du formulaire
        if (isset($_POST['submit']) && check_admin_referer('col_lms_settings_nonce')) {
            $this->save_settings();
            echo '<div class="notice notice-success"><p>' . __('Paramètres sauvegardés.', 'col-lms-offline-api') . '</p></div>';
        }
        
        ?>
        <div class="wrap">
            <h1><?php _e('Paramètres - LMS Offline API', 'col-lms-offline-api'); ?></h1>
            
            <form method="post" action="">
                <?php wp_nonce_field('col_lms_settings_nonce'); ?>
                
                <div class="nav-tab-wrapper">
                    <a href="#general" class="nav-tab nav-tab-active"><?php _e('Général', 'col-lms-offline-api'); ?></a>
                    <a href="#security" class="nav-tab"><?php _e('Sécurité', 'col-lms-offline-api'); ?></a>
                    <a href="#download" class="nav-tab"><?php _e('Téléchargement', 'col-lms-offline-api'); ?></a>
                    <a href="#sync" class="nav-tab"><?php _e('Synchronisation', 'col-lms-offline-api'); ?></a>
                </div>
                
                <!-- Paramètres généraux -->
                <div id="general" class="tab-content">
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Activer l\'API', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_api_enabled" value="1" 
                                           <?php checked(get_option('col_lms_api_enabled', true), 1); ?>>
                                    <?php _e('Activer l\'API REST pour l\'application offline', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row"><?php _e('Abonnement requis', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_require_membership" value="1"
                                           <?php checked(get_option('col_lms_require_membership', false), 1); ?>>
                                    <?php _e('Nécessite un abonnement Paid Memberships Pro actif', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row"><?php _e('Niveaux autorisés', 'col-lms-offline-api'); ?></th>
                            <td>
                                <?php if (function_exists('pmpro_getAllLevels')): ?>
                                    <?php $levels = pmpro_getAllLevels(); ?>
                                    <?php $allowed = get_option('col_lms_allowed_membership_levels', array()); ?>
                                    <?php foreach ($levels as $level): ?>
                                        <label style="display: block; margin-bottom: 5px;">
                                            <input type="checkbox" name="col_lms_allowed_membership_levels[]" 
                                                   value="<?php echo $level->id; ?>"
                                                   <?php checked(in_array($level->id, $allowed)); ?>>
                                            <?php echo esc_html($level->name); ?>
                                        </label>
                                    <?php endforeach; ?>
                                    <p class="description">
                                        <?php _e('Si aucun niveau n\'est sélectionné, tous les niveaux sont autorisés.', 'col-lms-offline-api'); ?>
                                    </p>
                                <?php else: ?>
                                    <p class="description">
                                        <?php _e('Paid Memberships Pro n\'est pas installé.', 'col-lms-offline-api'); ?>
                                    </p>
                                <?php endif; ?>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="col_lms_token_lifetime">
                                    <?php _e('Durée de vie du token', 'col-lms-offline-api'); ?>
                                </label>
                            </th>
                            <td>
                                <input type="number" id="col_lms_token_lifetime" name="col_lms_token_lifetime" 
                                       value="<?php echo get_option('col_lms_token_lifetime', 3600); ?>" 
                                       min="300" max="86400" step="300">
                                <p class="description">
                                    <?php _e('Durée en secondes (300 = 5 minutes, 3600 = 1 heure)', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="col_lms_max_devices_per_user">
                                    <?php _e('Appareils maximum par utilisateur', 'col-lms-offline-api'); ?>
                                </label>
                            </th>
                            <td>
                                <input type="number" id="col_lms_max_devices_per_user" 
                                       name="col_lms_max_devices_per_user" 
                                       value="<?php echo get_option('col_lms_max_devices_per_user', 5); ?>" 
                                       min="1" max="20">
                                <p class="description">
                                    <?php _e('Nombre maximum d\'appareils simultanés par utilisateur', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>
                
                <!-- Paramètres de sécurité -->
                <div id="security" class="tab-content" style="display: none;">
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Limitation de débit', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_enable_rate_limiting" value="1"
                                           <?php checked(get_option('col_lms_enable_rate_limiting', true), 1); ?>>
                                    <?php _e('Activer la limitation de débit', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="col_lms_rate_limit_requests">
                                    <?php _e('Requêtes maximum', 'col-lms-offline-api'); ?>
                                </label>
                            </th>
                            <td>
                                <input type="number" id="col_lms_rate_limit_requests" 
                                       name="col_lms_rate_limit_requests" 
                                       value="<?php echo get_option('col_lms_rate_limit_requests', 100); ?>" 
                                       min="10" max="1000">
                                <p class="description">
                                    <?php _e('Nombre de requêtes maximum par fenêtre de temps', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row"><?php _e('Liste blanche IP', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_enable_ip_whitelist" value="1"
                                           <?php checked(get_option('col_lms_enable_ip_whitelist', false), 1); ?>>
                                    <?php _e('Activer la liste blanche d\'IP', 'col-lms-offline-api'); ?>
                                </label>
                                
                                <br><br>
                                
                                <textarea name="col_lms_ip_whitelist" rows="5" cols="50" 
                                          placeholder="192.168.1.1&#10;10.0.0.0/24"
                                ><?php 
                                $whitelist = get_option('col_lms_ip_whitelist', array());
                                echo is_array($whitelist) ? esc_textarea(implode("\n", $whitelist)) : esc_textarea($whitelist);
                                ?></textarea>
                                <p class="description">
                                    <?php _e('Une IP ou plage d\'IP par ligne', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>
                
                <!-- Paramètres de téléchargement -->
                <div id="download" class="tab-content" style="display: none;">
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Packages de cours', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_enable_course_packages" value="1"
                                           <?php checked(get_option('col_lms_enable_course_packages', true), 1); ?>>
                                    <?php _e('Activer la création de packages de cours', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="col_lms_package_expiry_hours">
                                    <?php _e('Expiration des packages', 'col-lms-offline-api'); ?>
                                </label>
                            </th>
                            <td>
                                <input type="number" id="col_lms_package_expiry_hours" 
                                       name="col_lms_package_expiry_hours" 
                                       value="<?php echo get_option('col_lms_package_expiry_hours', 24); ?>" 
                                       min="1" max="168">
                                <p class="description">
                                    <?php _e('Durée en heures avant expiration automatique', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="col_lms_max_package_size">
                                    <?php _e('Taille maximum des packages', 'col-lms-offline-api'); ?>
                                </label>
                            </th>
                            <td>
                                <input type="number" id="col_lms_max_package_size" 
                                       name="col_lms_max_package_size" 
                                       value="<?php echo get_option('col_lms_max_package_size', 2147483648); ?>" 
                                       min="104857600" step="104857600">
                                <p class="description">
                                    <?php _e('Taille en octets (2147483648 = 2GB)', 'col-lms-offline-api'); ?>
                                </p>
                            </td>
                        </tr>
                    </table>
                </div>
                
                <!-- Paramètres de synchronisation -->
                <div id="sync" class="tab-content" style="display: none;">
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Synchronisation automatique', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_enable_auto_sync" value="1"
                                           <?php checked(get_option('col_lms_enable_auto_sync', true), 1); ?>>
                                    <?php _e('Activer la synchronisation automatique', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                    </table>
                </div>
                
                <?php submit_button(); ?>
            </form>
        </div>
        
        <script>
        jQuery(document).ready(function($) {
            // Navigation par onglets
            $('.nav-tab').on('click', function(e) {
                e.preventDefault();
                $('.nav-tab').removeClass('nav-tab-active');
                $(this).addClass('nav-tab-active');
                
                $('.tab-content').hide();
                $($(this).attr('href')).show();
            });
        });
        </script>
        <?php
    }
    
    /**
     * Page d'activité
     */
    public function display_activity_page() {
        global $wpdb;
        
        // Récupérer les logs récents
        $logs = $wpdb->get_results("
            SELECT * FROM {$wpdb->prefix}col_lms_logs 
            ORDER BY created_at DESC 
            LIMIT 100
        ");
        
        ?>
        <div class="wrap">
            <h1><?php _e('Activité - LMS Offline API', 'col-lms-offline-api'); ?></h1>
            
            <div class="activity-filters">
                <div class="filter-group">
                    <label><?php _e('Action:', 'col-lms-offline-api'); ?></label>
                    <select id="filter-action">
                        <option value=""><?php _e('Toutes', 'col-lms-offline-api'); ?></option>
                        <option value="login"><?php _e('Connexions', 'col-lms-offline-api'); ?></option>
                        <option value="download"><?php _e('Téléchargements', 'col-lms-offline-api'); ?></option>
                        <option value="sync"><?php _e('Synchronisations', 'col-lms-offline-api'); ?></option>
                    </select>
                </div>
                
                <div class="filter-group">
                    <label><?php _e('Utilisateur:', 'col-lms-offline-api'); ?></label>
                    <input type="text" id="filter-user" placeholder="<?php _e('Nom d\'utilisateur', 'col-lms-offline-api'); ?>">
                </div>
                
                <button class="button" id="apply-filters"><?php _e('Filtrer', 'col-lms-offline-api'); ?></button>
            </div>
            
            <div class="activity-table">
                <table class="wp-list-table widefat fixed striped">
                    <thead>
                        <tr>
                            <th><?php _e('Date', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Action', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Utilisateur', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('IP', 'col-lms-offline-api'); ?></th>
                            <th><?php _e('Détails', 'col-lms-offline-api'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($logs as $log): ?>
                        <tr>
                            <td><?php echo date('d/m/Y H:i', strtotime($log->created_at)); ?></td>
                            <td><?php echo esc_html($log->action); ?></td>
                            <td>
                                <?php 
                                if ($log->user_id) {
                                    $user = get_userdata($log->user_id);
                                    echo $user ? esc_html($user->display_name) : 'ID: ' . $log->user_id;
                                } else {
                                    echo '-';
                                }
                                ?>
                            </td>
                            <td><?php echo esc_html($log->ip_address); ?></td>
                            <td>
                                <?php 
                                $details = json_decode($log->details, true);
                                if (is_array($details) && !empty($details)) {
                                    echo '<details><summary>' . __('Voir détails', 'col-lms-offline-api') . '</summary>';
                                    echo '<pre>' . esc_html(wp_json_encode($details, JSON_PRETTY_PRINT)) . '</pre>';
                                    echo '</details>';
                                } else {
                                    echo '-';
                                }
                                ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>
        <?php
    }
    
    /**
     * Page de documentation
     */
    public function display_docs_page() {
        ?>
        <div class="wrap">
            <h1><?php _e('Documentation - LMS Offline API', 'col-lms-offline-api'); ?></h1>
            
            <div class="docs-container">
                <div class="docs-sidebar">
                    <h4><?php _e('Navigation', 'col-lms-offline-api'); ?></h4>
                    <ul>
                        <li><a href="#installation"><?php _e('Installation', 'col-lms-offline-api'); ?></a></li>
                        <li><a href="#configuration"><?php _e('Configuration', 'col-lms-offline-api'); ?></a></li>
                        <li><a href="#api-endpoints"><?php _e('Endpoints API', 'col-lms-offline-api'); ?></a></li>
                        <li><a href="#authentication"><?php _e('Authentification', 'col-lms-offline-api'); ?></a></li>
                        <li><a href="#troubleshooting"><?php _e('Dépannage', 'col-lms-offline-api'); ?></a></li>
                    </ul>
                </div>
                
                <div class="docs-content">
                    <section id="installation">
                        <h2><?php _e('Installation', 'col-lms-offline-api'); ?></h2>
                        <p><?php _e('Ce plugin nécessite LearnPress pour fonctionner. Paid Memberships Pro est optionnel pour la gestion des abonnements.', 'col-lms-offline-api'); ?></p>
                        
                        <h3><?php _e('Prérequis', 'col-lms-offline-api'); ?></h3>
                        <ul>
                            <li>WordPress 5.8+</li>
                            <li>PHP 7.4+</li>
                            <li>LearnPress 4.0+</li>
                            <li>HTTPS recommandé</li>
                        </ul>
                    </section>
                    
                    <section id="configuration">
                        <h2><?php _e('Configuration', 'col-lms-offline-api'); ?></h2>
                        <p><?php _e('Rendez-vous dans les paramètres pour configurer l\'API selon vos besoins.', 'col-lms-offline-api'); ?></p>
                    </section>
                    
                    <section id="api-endpoints">
                        <h2><?php _e('Endpoints API', 'col-lms-offline-api'); ?></h2>
                        <p><?php _e('L\'API est accessible à l\'adresse:', 'col-lms-offline-api'); ?></p>
                        <code><?php echo home_url('/wp-json/' . COL_LMS_API_NAMESPACE); ?></code>
                        
                        <h3><?php _e('Endpoints principaux', 'col-lms-offline-api'); ?></h3>
                        <ul>
                            <li><code>POST /auth/login</code> - <?php _e('Connexion', 'col-lms-offline-api'); ?></li>
                            <li><code>GET /courses</code> - <?php _e('Liste des cours', 'col-lms-offline-api'); ?></li>
                            <li><code>POST /sync/progress</code> - <?php _e('Synchronisation', 'col-lms-offline-api'); ?></li>
                        </ul>
                    </section>
                    
                    <section id="authentication">
                        <h2><?php _e('Authentification', 'col-lms-offline-api'); ?></h2>
                        <p><?php _e('L\'API utilise des tokens JWT pour l\'authentification.', 'col-lms-offline-api'); ?></p>
                    </section>
                    
                    <section id="troubleshooting">
                        <h2><?php _e('Dépannage', 'col-lms-offline-api'); ?></h2>
                        
                        <h3><?php _e('Problèmes courants', 'col-lms-offline-api'); ?></h3>
                        <ul>
                            <li><strong>API non accessible:</strong> Vérifiez que l'API est activée dans les paramètres</li>
                            <li><strong>Erreurs d'authentification:</strong> Vérifiez les tokens et permissions</li>
                            <li><strong>Packages qui échouent:</strong> Vérifiez l'espace disque et les permissions</li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
        <?php
    }
    
    /**
     * Sauvegarder les paramètres
     */
    private function save_settings() {
        // Paramètres généraux
        update_option('col_lms_api_enabled', !empty($_POST['col_lms_api_enabled']));
        update_option('col_lms_require_membership', !empty($_POST['col_lms_require_membership']));
        
        if (isset($_POST['col_lms_allowed_membership_levels'])) {
            update_option('col_lms_allowed_membership_levels', array_map('intval', $_POST['col_lms_allowed_membership_levels']));
        } else {
            update_option('col_lms_allowed_membership_levels', array());
        }
        
        if (isset($_POST['col_lms_token_lifetime'])) {
            update_option('col_lms_token_lifetime', absint($_POST['col_lms_token_lifetime']));
        }
        
        if (isset($_POST['col_lms_max_devices_per_user'])) {
            update_option('col_lms_max_devices_per_user', absint($_POST['col_lms_max_devices_per_user']));
        }
        
        // Paramètres de sécurité
        update_option('col_lms_enable_rate_limiting', !empty($_POST['col_lms_enable_rate_limiting']));
        
        if (isset($_POST['col_lms_rate_limit_requests'])) {
            update_option('col_lms_rate_limit_requests', absint($_POST['col_lms_rate_limit_requests']));
        }
        
        update_option('col_lms_enable_ip_whitelist', !empty($_POST['col_lms_enable_ip_whitelist']));
        
        if (isset($_POST['col_lms_ip_whitelist'])) {
            $ips = explode("\n", sanitize_textarea_field($_POST['col_lms_ip_whitelist']));
            $ips = array_filter(array_map('trim', $ips));
            update_option('col_lms_ip_whitelist', $ips);
        }
        
        // Paramètres de téléchargement
        update_option('col_lms_enable_course_packages', !empty($_POST['col_lms_enable_course_packages']));
        
        if (isset($_POST['col_lms_package_expiry_hours'])) {
            update_option('col_lms_package_expiry_hours', absint($_POST['col_lms_package_expiry_hours']));
        }
        
        if (isset($_POST['col_lms_max_package_size'])) {
            update_option('col_lms_max_package_size', absint($_POST['col_lms_max_package_size']));
        }
        
        // Paramètres de synchronisation
        update_option('col_lms_enable_auto_sync', !empty($_POST['col_lms_enable_auto_sync']));
    }
    
    /**
     * Récupérer les statistiques du tableau de bord
     */
    private function get_dashboard_stats() {
        global $wpdb;
        
        $stats = array(
            'active_users' => 0,
            'active_devices' => 0,
            'total_downloads' => 0,
            'sync_operations' => 0,
            'recent_logins' => array()
        );
        
        // Vérifier si les tables existent
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_tokens'");
        
        if ($table_exists) {
            // Utilisateurs actifs
            $stats['active_users'] = $wpdb->get_var("
                SELECT COUNT(DISTINCT user_id) 
                FROM {$wpdb->prefix}col_lms_tokens 
                WHERE expires_at > NOW()
            ") ?: 0;
            
            // Appareils actifs
            $stats['active_devices'] = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM {$wpdb->prefix}col_lms_tokens 
                WHERE expires_at > NOW()
            ") ?: 0;
            
            // Connexions récentes
            $stats['recent_logins'] = $wpdb->get_results("
                SELECT t.*, u.display_name 
                FROM {$wpdb->prefix}col_lms_tokens t
                LEFT JOIN {$wpdb->users} u ON t.user_id = u.ID
                WHERE t.expires_at > NOW()
                ORDER BY t.created_at DESC
                LIMIT 10
            ") ?: array();
        }
        
        // Packages si la table existe
        $packages_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if ($packages_table) {
            $stats['total_downloads'] = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM {$wpdb->prefix}col_lms_packages 
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND status = 'completed'
            ") ?: 0;
        }
        
        // Logs si la table existe
        $logs_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_logs'");
        if ($logs_table) {
            $stats['sync_operations'] = $wpdb->get_var("
                SELECT COUNT(*) 
                FROM {$wpdb->prefix}col_lms_logs 
                WHERE action = 'sync' 
                AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ") ?: 0;
        }
        
        return $stats;
    }
    
    /**
     * AJAX: Récupérer les statistiques pour les graphiques
     */
    public function ajax_get_stats() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        global $wpdb;
        
        $data = array(
            'api_activity' => array(),
            'popular_courses' => array()
        );
        
        // Activité API si la table existe
        $logs_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_logs'");
        if ($logs_table) {
            $data['api_activity'] = $wpdb->get_results("
                SELECT DATE(created_at) as date, COUNT(*) as count
                FROM {$wpdb->prefix}col_lms_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(created_at)
                ORDER BY date ASC
            ") ?: array();
        }
        
        // Cours populaires si la table existe
        $packages_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_packages'");
        if ($packages_table) {
            $data['popular_courses'] = $wpdb->get_results("
                SELECT course_id, COUNT(*) as downloads, p.post_title as title
                FROM {$wpdb->prefix}col_lms_packages pkg
                LEFT JOIN {$wpdb->posts} p ON pkg.course_id = p.ID
                WHERE pkg.status = 'completed'
                AND pkg.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY course_id
                ORDER BY downloads DESC
                LIMIT 10
            ") ?: array();
        }
        
        wp_send_json_success($data);
    }
    
    /**
     * AJAX: Nettoyer les tokens
     */
    public function ajax_clear_tokens() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        global $wpdb;
        
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_tokens'");
        
        if (!$table_exists) {
            wp_send_json_error(array('message' => 'Table des tokens non trouvée'));
            return;
        }
        
        $deleted = $wpdb->query("
            DELETE FROM {$wpdb->prefix}col_lms_tokens 
            WHERE expires_at < NOW()
        ");
        
        wp_send_json_success(array(
            'deleted' => $deleted,
            'message' => sprintf(__('%d tokens expirés supprimés', 'col-lms-offline-api'), $deleted)
        ));
    }
    
    /**
     * AJAX: Tester l'API
     */
    public function ajax_test_api() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $api_url = rest_url(COL_LMS_API_NAMESPACE . '/status');
        
        $response = wp_remote_get($api_url, array(
            'timeout' => 10,
            'sslverify' => false
        ));
        
        if (is_wp_error($response)) {
            wp_send_json_error(array(
                'message' => $response->get_error_message()
            ));
            return;
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        
        wp_send_json_success(array(
            'status_code' => $code,
            'response' => json_decode($body),
            'message' => $code === 200 ? __('API fonctionne correctement', 'col-lms-offline-api') : __('Erreur API', 'col-lms-offline-api')
        ));
    }
    
    /**
     * AJAX: Révoquer un token
     */
    public function ajax_revoke_token() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        $token_id = absint($_POST['token_id'] ?? 0);
        
        if (!$token_id) {
            wp_send_json_error(array('message' => 'ID token invalide'));
            return;
        }
        
        global $wpdb;
        
        $deleted = $wpdb->delete(
            $wpdb->prefix . 'col_lms_tokens',
            array('id' => $token_id),
            array('%d')
        );
        
        if ($deleted) {
            wp_send_json_success(array('message' => 'Token révoqué avec succès'));
        } else {
            wp_send_json_error(array('message' => 'Erreur lors de la révocation'));
        }
    }
    
    /**
     * AJAX: Exporter les statistiques
     */
    public function ajax_export_stats() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        
        // Pour l'instant, retourner un message
        wp_send_json_success(array(
            'message' => 'Export des statistiques en cours...',
            'download_url' => admin_url('admin.php?page=' . $this->plugin_name)
        ));
    }
    
    /**
     * Ajouter des colonnes utilisateur
     */
    public function add_user_columns($columns) {
        $columns['col_lms_devices'] = __('Appareils API', 'col-lms-offline-api');
        $columns['col_lms_last_sync'] = __('Dernière sync', 'col-lms-offline-api');
        return $columns;
    }
    
    /**
     * Afficher les données des colonnes
     */
    public function show_user_column_data($value, $column_name, $user_id) {
        global $wpdb;
        
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_tokens'");
        
        if (!$table_exists) {
            return '-';
        }
        
        switch ($column_name) {
            case 'col_lms_devices':
                $count = $wpdb->get_var($wpdb->prepare("
                    SELECT COUNT(DISTINCT device_id) 
                    FROM {$wpdb->prefix}col_lms_tokens 
                    WHERE user_id = %d 
                    AND expires_at > NOW()
                ", $user_id));
                return $count ?: '0';
                
            case 'col_lms_last_sync':
                $logs_table = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_logs'");
                if (!$logs_table) {
                    return '-';
                }
                
                $last_sync = $wpdb->get_var($wpdb->prepare("
                    SELECT MAX(created_at) 
                    FROM {$wpdb->prefix}col_lms_logs 
                    WHERE user_id = %d 
                    AND action = 'sync'
                ", $user_id));
                
                if ($last_sync) {
                    return human_time_diff(strtotime($last_sync), current_time('timestamp')) . ' ' . __('ago', 'col-lms-offline-api');
                }
                return __('Jamais', 'col-lms-offline-api');
        }
        
        return $value;
    }
    
    /**
     * Ajouter des actions bulk
     */
    public function add_bulk_actions($actions) {
        $actions['col_lms_revoke_all_tokens'] = __('Révoquer tous les tokens API', 'col-lms-offline-api');
        return $actions;
    }
    
    /**
     * Gérer les actions bulk
     */
    public function handle_bulk_actions($redirect_to, $action, $user_ids) {
        if ($action !== 'col_lms_revoke_all_tokens') {
            return $redirect_to;
        }
        
        if (!current_user_can('manage_options')) {
            return $redirect_to;
        }
        
        global $wpdb;
        
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}col_lms_tokens'");
        
        if ($table_exists && !empty($user_ids)) {
            $placeholders = implode(',', array_fill(0, count($user_ids), '%d'));
            $deleted = $wpdb->query($wpdb->prepare("
                DELETE FROM {$wpdb->prefix}col_lms_tokens 
                WHERE user_id IN ($placeholders)
            ", $user_ids));
            
            $redirect_to = add_query_arg('col_lms_tokens_revoked', $deleted, $redirect_to);
        }
        
        return $redirect_to;
    }
    
    /**
     * Afficher les notices
     */
    private function display_notices() {
        // Notice pour tokens révoqués
        if (isset($_GET['col_lms_tokens_revoked'])) {
            $count = intval($_GET['col_lms_tokens_revoked']);
            echo '<div class="notice notice-success is-dismissible">';
            echo '<p>' . sprintf(__('%d tokens ont été révoqués.', 'col-lms-offline-api'), $count) . '</p>';
            echo '</div>';
        }
        
        // Vérifier HTTPS
        if (!is_ssl() && !defined('COL_LMS_ALLOW_HTTP')) {
            ?>
            <div class="notice notice-warning">
                <p>
                    <strong><?php _e('Avertissement de sécurité:', 'col-lms-offline-api'); ?></strong>
                    <?php _e('L\'API devrait être utilisée avec HTTPS pour sécuriser les communications.', 'col-lms-offline-api'); ?>
                </p>
            </div>
            <?php
        }
        
        // Vérifier les plugins requis
        if (!class_exists('LearnPress')) {
            ?>
            <div class="notice notice-error">
                <p>
                    <strong><?php _e('Plugin manquant:', 'col-lms-offline-api'); ?></strong>
                    <?php _e('LearnPress doit être installé et activé.', 'col-lms-offline-api'); ?>
                </p>
            </div>
            <?php
        }
        
        if (get_option('col_lms_require_membership') && !function_exists('pmpro_hasMembershipLevel')) {
            ?>
            <div class="notice notice-warning">
                <p>
                    <strong><?php _e('Plugin recommandé:', 'col-lms-offline-api'); ?></strong>
                    <?php _e('Paid Memberships Pro est requis pour la gestion des abonnements.', 'col-lms-offline-api'); ?>
                </p>
            </div>
            <?php
        }
    }
    
    /**
     * Sanitizer pour les niveaux d'adhésion
     */
    public function sanitize_membership_levels($levels) {
        if (!is_array($levels)) {
            return array();
        }
        return array_map('absint', $levels);
    }
    
    /**
     * Sanitizer pour la liste d'IP
     */
    public function sanitize_ip_list($ips) {
        if (is_string($ips)) {
            $ips = explode("\n", $ips);
        }
        
        if (!is_array($ips)) {
            return array();
        }
        
        $sanitized = array();
        foreach ($ips as $ip) {
            $ip = trim($ip);
            if (!empty($ip) && (filter_var($ip, FILTER_VALIDATE_IP) || strpos($ip, '/') !== false)) {
                $sanitized[] = $ip;
            }
        }
        
        return $sanitized;
    }
    
    /**
     * Sanitizer pour les types de fichiers
     */
    public function sanitize_file_types($types) {
        if (!is_array($types)) {
            return array();
        }
        
        return array_map('sanitize_text_field', $types);
    }
}

// Initialiser l'admin seulement si on est en contexte admin
if (is_admin()) {
    new COL_LMS_Admin();
}
