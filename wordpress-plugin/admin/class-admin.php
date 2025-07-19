<?php
/**
 * Interface d'administration pour COL LMS Offline API
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

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
        register_setting('col_lms_general_settings', 'col_lms_api_enabled');
        register_setting('col_lms_general_settings', 'col_lms_require_membership');
        register_setting('col_lms_general_settings', 'col_lms_allowed_membership_levels');
        register_setting('col_lms_general_settings', 'col_lms_token_lifetime');
        register_setting('col_lms_general_settings', 'col_lms_max_devices_per_user');
        
        // Groupe de paramètres de sécurité
        register_setting('col_lms_security_settings', 'col_lms_enable_rate_limiting');
        register_setting('col_lms_security_settings', 'col_lms_rate_limit_requests');
        register_setting('col_lms_security_settings', 'col_lms_rate_limit_window');
        register_setting('col_lms_security_settings', 'col_lms_enable_ip_whitelist');
        register_setting('col_lms_security_settings', 'col_lms_ip_whitelist');
        
        // Groupe de paramètres de téléchargement
        register_setting('col_lms_download_settings', 'col_lms_enable_course_packages');
        register_setting('col_lms_download_settings', 'col_lms_package_expiry_hours');
        register_setting('col_lms_download_settings', 'col_lms_max_package_size');
        register_setting('col_lms_download_settings', 'col_lms_allowed_file_types');
    }
    
    /**
     * Charger les assets admin
     */
    public function enqueue_admin_assets($hook) {
        if (strpos($hook, $this->plugin_name) === false) {
            return;
        }
        
        wp_enqueue_style(
            $this->plugin_name . '-admin',
            plugin_dir_url(__FILE__) . 'css/admin.css',
            array(),
            $this->version
        );
        
        wp_enqueue_script(
            $this->plugin_name . '-admin',
            plugin_dir_url(__FILE__) . 'js/admin.js',
            array('jquery', 'wp-api'),
            $this->version,
            true
        );
        
        wp_localize_script($this->plugin_name . '-admin', 'col_lms_admin', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('col_lms_admin'),
            'strings' => array(
                'confirm_clear_tokens' => __('Êtes-vous sûr de vouloir supprimer tous les tokens ?', 'col-lms-offline-api'),
                'test_success' => __('Test réussi !', 'col-lms-offline-api'),
                'test_failed' => __('Test échoué', 'col-lms-offline-api')
            )
        ));
        
        // Chart.js pour les graphiques
        wp_enqueue_script('chartjs', 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js', array(), '3.9.1');
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
            <div class="col-lms-status-box <?php echo get_option('col_lms_api_enabled') ? 'active' : 'inactive'; ?>">
                <h2><?php _e('Statut de l\'API', 'col-lms-offline-api'); ?></h2>
                <p class="status">
                    <?php if (get_option('col_lms_api_enabled')): ?>
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
                        <?php foreach ($stats['recent_logins'] as $login): ?>
                        <tr>
                            <td>
                                <?php
                                $user = get_userdata($login->user_id);
                                echo $user ? esc_html($user->display_name) : __('Utilisateur supprimé', 'col-lms-offline-api');
                                ?>
                            </td>
                            <td><?php echo esc_html($login->device_name ?: $login->device_id); ?></td>
                            <td><?php echo human_time_diff(strtotime($login->last_used), current_time('timestamp')) . ' ' . __('ago', 'col-lms-offline-api'); ?></td>
                            <td>
                                <button class="button button-small revoke-token" data-token-id="<?php echo $login->id; ?>">
                                    <?php _e('Révoquer', 'col-lms-offline-api'); ?>
                                </button>
                            </td>
                        </tr>
                        <?php endforeach; ?>
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
            loadChartData();
        });
        </script>
        <?php
    }
    
    /**
     * Page des paramètres
     */
    public function display_settings_page() {
        ?>
        <div class="wrap">
            <h1><?php _e('Paramètres - LMS Offline API', 'col-lms-offline-api'); ?></h1>
            
            <form method="post" action="options.php">
                <div class="nav-tab-wrapper">
                    <a href="#general" class="nav-tab nav-tab-active"><?php _e('Général', 'col-lms-offline-api'); ?></a>
                    <a href="#security" class="nav-tab"><?php _e('Sécurité', 'col-lms-offline-api'); ?></a>
                    <a href="#download" class="nav-tab"><?php _e('Téléchargement', 'col-lms-offline-api'); ?></a>
                    <a href="#sync" class="nav-tab"><?php _e('Synchronisation', 'col-lms-offline-api'); ?></a>
                </div>
                
                <!-- Paramètres généraux -->
                <div id="general" class="tab-content">
                    <?php settings_fields('col_lms_general_settings'); ?>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Activer l\'API', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_api_enabled" value="1" 
                                           <?php checked(get_option('col_lms_api_enabled'), 1); ?>>
                                    <?php _e('Activer l\'API REST pour l\'application offline', 'col-lms-offline-api'); ?>
                                </label>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row"><?php _e('Abonnement requis', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_require_membership" value="1"
                                           <?php checked(get_option('col_lms_require_membership'), 1); ?>>
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
                    <?php settings_fields('col_lms_security_settings'); ?>
                    
                    <table class="form-table">
                        <tr>
                            <th scope="row"><?php _e('Limitation de débit', 'col-lms-offline-api'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="col_lms_enable_rate_limiting" value="1"
                                           <?php checked(get_option('col_lms_enable_rate_limiting'), 1); ?>>
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
                                           <?php checked(get_option('col_lms_enable_ip_whitelist'), 1); ?>>
                                    <?php _e('Activer la liste blanche d\'IP', 'col-lms-offline-api'); ?>
                                </label>
                                
                                <br><br>
                                
                                <textarea name="col_lms_ip_whitelist" rows="5" cols="50" 
                                          placeholder="192.168.1.1&#10;10.0.0.0/24"
                                ><?php echo esc_textarea(implode("\n", get_option('col_lms_ip_whitelist', array()))); ?></textarea>
                                <p class="description">
                                    <?php _e('Une IP ou plage d\'IP par ligne', 'col-lms-offline-api'); ?>
                                </p>
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
     * Récupérer les statistiques du tableau de bord
     */
    private function get_dashboard_stats() {
        global $wpdb;
        
        $stats = array();
        
        // Utilisateurs actifs
        $stats['active_users'] = $wpdb->get_var("
            SELECT COUNT(DISTINCT user_id) 
            FROM {$wpdb->prefix}col_lms_tokens 
            WHERE expires_at > NOW()
        ");
        
        // Appareils actifs
        $stats['active_devices'] = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}col_lms_tokens 
            WHERE expires_at > NOW()
        ");
        
        // Téléchargements ce mois
        $stats['total_downloads'] = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}col_lms_packages 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND status = 'completed'
        ");
        
        // Synchronisations 24h
        $stats['sync_operations'] = $wpdb->get_var("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}col_lms_activity_log 
            WHERE action = 'sync' 
            AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ");
        
        // Connexions récentes
        $stats['recent_logins'] = $wpdb->get_results("
            SELECT t.*, u.display_name 
            FROM {$wpdb->prefix}col_lms_tokens t
            LEFT JOIN {$wpdb->users} u ON t.user_id = u.ID
            WHERE t.expires_at > NOW()
            ORDER BY t.last_used DESC
            LIMIT 10
        ");
        
        return $stats;
    }
    
    /**
     * AJAX: Récupérer les statistiques pour les graphiques
     */
    public function ajax_get_stats() {
        check_ajax_referer('col_lms_admin', 'nonce');
        
        global $wpdb;
        
        // Activité API 7 derniers jours
        $api_activity = $wpdb->get_results("
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM {$wpdb->prefix}col_lms_activity_log
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        ");
        
        // Cours populaires
        $popular_courses = $wpdb->get_results("
            SELECT course_id, COUNT(*) as downloads, p.post_title as title
            FROM {$wpdb->prefix}col_lms_packages pkg
            LEFT JOIN {$wpdb->posts} p ON pkg.course_id = p.ID
            WHERE pkg.status = 'completed'
            AND pkg.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY course_id
            ORDER BY downloads DESC
            LIMIT 10
        ");
        
        wp_send_json_success(array(
            'api_activity' => $api_activity,
            'popular_courses' => $popular_courses
        ));
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
        
        $api_url = home_url('/wp-json/' . COL_LMS_API_NAMESPACE . '/courses');
        
        // Créer un token temporaire pour le test
        $test_token = wp_generate_password(32, false);
        set_transient('col_lms_test_token_' . $test_token, get_current_user_id(), 60);
        
        $response = wp_remote_get($api_url, array(
            'headers' => array(
                'Authorization' => 'Bearer ' . $test_token
            ),
            'timeout' => 10
        ));
        
        delete_transient('col_lms_test_token_' . $test_token);
        
        if (is_wp_error($response)) {
            wp_send_json_error(array(
                'message' => $response->get_error_message()
            ));
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
     * Ajouter des colonnes utilisateur
     */
    public function add_user_columns($columns) {
        $columns['col_lms_devices'] = __('Appareils', 'col-lms-offline-api');
        $columns['col_lms_last_sync'] = __('Dernière sync', 'col-lms-offline-api');
        return $columns;
    }
    
    /**
     * Afficher les données des colonnes
     */
    public function show_user_column_data($value, $column_name, $user_id) {
        global $wpdb;
        
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
                $last_sync = $wpdb->get_var($wpdb->prepare("
                    SELECT MAX(created_at) 
                    FROM {$wpdb->prefix}col_lms_activity_log 
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
     * Afficher les notices
     */
    private function display_notices() {
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
}

// Initialiser l'admin
new COL_LMS_Admin();
