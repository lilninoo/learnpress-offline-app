<?php
/**
 * Gestion de la synchronisation pour l'API COL LMS
 * 
 * @package COL_LMS_Offline_API
 * @since 1.0.0
 */

// Empêcher l'accès direct
if (!defined('ABSPATH')) {
    exit;
}

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
        $this->init_hooks();
    }
    
    /**
     * Initialiser les hooks
     */
    private function init_hooks() {
        // Programmer la synchronisation automatique
        add_action('col_lms_auto_sync', array($this, 'process_auto_sync'));
        
        if (!wp_next_scheduled('col_lms_auto_sync')) {
            wp_schedule_event(time(), 'hourly', 'col_lms_auto_sync');
        }
    }
    
    /**
     * Enregistrer les routes
     */
    private function register_routes() {
        // Synchronisation de la progression
        register_rest_route($this->namespace, '/sync/progress', array(
            'methods' => 'POST',
            'callback' => array($this, 'sync_progress'),
            'permission_callback' => array($this, 'check_sync_permission'),
            'args' => array(
                'progress_data' => array(
                    'required' => true,
                    'type' => 'object',
                    'validate_callback' => array($this, 'validate_progress_data')
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'timestamp' => array(
                    'type' => 'integer',
                    'default' => time()
                )
            )
        ));
        
        // Récupérer les données à synchroniser
        register_rest_route($this->namespace, '/sync/pull', array(
            'methods' => 'GET',
            'callback' => array($this, 'pull_sync_data'),
            'permission_callback' => array($this, 'check_sync_permission'),
            'args' => array(
                'since' => array(
                    'type' => 'string',
                    'format' => 'date-time',
                    'sanitize_callback' => 'sanitize_text_field'
                ),
                'types' => array(
                    'type' => 'array',
                    'default' => array('courses', 'progress', 'quizzes'),
                    'items' => array(
                        'type' => 'string',
                        'enum' => array('courses', 'progress', 'quizzes', 'certificates', 'assignments')
                    )
                ),
                'course_ids' => array(
                    'type' => 'array',
                    'items' => array('type' => 'integer')
                )
            )
        ));
        
        // Envoyer des données vers le serveur
        register_rest_route($this->namespace, '/sync/push', array(
            'methods' => 'POST',
            'callback' => array($this, 'push_sync_data'),
            'permission_callback' => array($this, 'check_sync_permission'),
            'args' => array(
                'sync_data' => array(
                    'required' => true,
                    'type' => 'object'
                ),
                'device_id' => array(
                    'required' => true,
                    'type' => 'string'
                )
            )
        ));
        
        // Statut de synchronisation
        register_rest_route($this->namespace, '/sync/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_sync_status'),
            'permission_callback' => array($this, 'check_auth')
        ));
        
        // Forcer une synchronisation complète
        register_rest_route($this->namespace, '/sync/force', array(
            'methods' => 'POST',
            'callback' => array($this, 'force_full_sync'),
            'permission_callback' => array($this, 'check_sync_permission'),
            'args' => array(
                'reset_progress' => array(
                    'type' => 'boolean',
                    'default' => false
                )
            )
        ));
        
        // Résoudre les conflits de synchronisation
        register_rest_route($this->namespace, '/sync/resolve-conflicts', array(
            'methods' => 'POST',
            'callback' => array($this, 'resolve_sync_conflicts'),
            'permission_callback' => array($this, 'check_sync_permission'),
            'args' => array(
                'conflicts' => array(
                    'required' => true,
                    'type' => 'array'
                ),
                'resolution_strategy' => array(
                    'type' => 'string',
                    'default' => 'server_wins',
                    'enum' => array('server_wins', 'client_wins', 'merge', 'manual')
                )
            )
        ));
    }
    
    /**
     * Synchroniser la progression
     */
    public function sync_progress($request) {
        $user_id = $this->get_current_user_id();
        $progress_data = $request->get_param('progress_data');
        $device_id = $request->get_param('device_id');
        $timestamp = $request->get_param('timestamp');
        
        $results = array(
            'synced' => array(),
            'conflicts' => array(),
            'errors' => array(),
            'sync_id' => wp_generate_uuid4()
        );
        
        // Démarrer une transaction
        global $wpdb;
        $wpdb->query('START TRANSACTION');
        
        try {
            // Synchroniser les leçons
            if (!empty($progress_data['lessons'])) {
                $lesson_results = $this->sync_lessons($user_id, $progress_data['lessons'], $device_id, $timestamp);
                $results['synced'] = array_merge($results['synced'], $lesson_results['synced']);
                $results['conflicts'] = array_merge($results['conflicts'], $lesson_results['conflicts']);
                $results['errors'] = array_merge($results['errors'], $lesson_results['errors']);
            }
            
            // Synchroniser les quiz
            if (!empty($progress_data['quizzes'])) {
                $quiz_results = $this->sync_quizzes($user_id, $progress_data['quizzes'], $device_id, $timestamp);
                $results['synced'] = array_merge($results['synced'], $quiz_results['synced']);
                $results['conflicts'] = array_merge($results['conflicts'], $quiz_results['conflicts']);
                $results['errors'] = array_merge($results['errors'], $quiz_results['errors']);
            }
            
            // Synchroniser les devoirs
            if (!empty($progress_data['assignments'])) {
                $assignment_results = $this->sync_assignments($user_id, $progress_data['assignments'], $device_id, $timestamp);
                $results['synced'] = array_merge($results['synced'], $assignment_results['synced']);
                $results['conflicts'] = array_merge($results['conflicts'], $assignment_results['conflicts']);
                $results['errors'] = array_merge($results['errors'], $assignment_results['errors']);
            }
            
            // Synchroniser les notes et commentaires
            if (!empty($progress_data['notes'])) {
                $notes_results = $this->sync_user_notes($user_id, $progress_data['notes'], $device_id, $timestamp);
                $results['synced'] = array_merge($results['synced'], $notes_results['synced']);
                $results['errors'] = array_merge($results['errors'], $notes_results['errors']);
            }
            
            // Enregistrer la synchronisation
            $this->record_sync_operation($user_id, $device_id, $results, $timestamp);
            
            $wpdb->query('COMMIT');
            
        } catch (Exception $e) {
            $wpdb->query('ROLLBACK');
            
            COL_LMS_Logger::error('Erreur lors de la synchronisation', array(
                'user_id' => $user_id,
                'device_id' => $device_id,
                'error' => $e->getMessage()
            ));
            
            return $this->error_response(
                'sync_failed',
                __('Erreur lors de la synchronisation: ', 'col-lms-offline-api') . $e->getMessage(),
                500
            );
        }
        
        $this->log_action('sync_progress', array(
            'synced_count' => count($results['synced']),
            'conflict_count' => count($results['conflicts']),
            'error_count' => count($results['errors']),
            'sync_id' => $results['sync_id']
        ));
        
        return array(
            'success' => true,
            'synced' => $results['synced'],
            'conflicts' => $results['conflicts'],
            'errors' => $results['errors'],
            'sync_id' => $results['sync_id'],
            'server_timestamp' => current_time('mysql'),
            'message' => sprintf(
                __('%d éléments synchronisés, %d conflits, %d erreurs', 'col-lms-offline-api'),
                count($results['synced']),
                count($results['conflicts']),
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
        $types = $request->get_param('types');
        $course_ids = $request->get_param('course_ids');
        
        $data = array(
            'sync_timestamp' => current_time('mysql'),
            'user_id' => $user_id
        );
        
        foreach ($types as $type) {
            switch ($type) {
                case 'courses':
                    $data['courses'] = $this->get_user_courses_data($user_id, $since, $course_ids);
                    break;
                    
                case 'progress':
                    $data['progress'] = $this->get_user_progress_data($user_id, $since, $course_ids);
                    break;
                    
                case 'quizzes':
                    $data['quizzes'] = $this->get_user_quiz_data($user_id, $since, $course_ids);
                    break;
                    
                case 'certificates':
                    $data['certificates'] = $this->get_user_certificates($user_id, $since);
                    break;
                    
                case 'assignments':
                    $data['assignments'] = $this->get_user_assignments_data($user_id, $since, $course_ids);
                    break;
            }
        }
        
        // Ajouter les métadonnées de synchronisation
        $data['sync_meta'] = array(
            'last_sync' => get_user_meta($user_id, '_col_lms_last_sync', true),
            'sync_conflicts' => $this->get_pending_conflicts($user_id),
            'server_version' => COL_LMS_API_VERSION
        );
        
        $this->log_action('pull_sync_data', array(
            'types' => $types,
            'course_count' => isset($data['courses']) ? count($data['courses']) : 0
        ));
        
        return $data;
    }
    
    /**
     * Envoyer des données vers le serveur
     */
    public function push_sync_data($request) {
        $user_id = $this->get_current_user_id();
        $sync_data = $request->get_param('sync_data');
        $device_id = $request->get_param('device_id');
        
        $results = array(
            'processed' => array(),
            'errors' => array()
        );
        
        // Traiter chaque type de données
        foreach ($sync_data as $type => $data) {
            try {
                switch ($type) {
                    case 'user_preferences':
                        $this->update_user_preferences($user_id, $data);
                        $results['processed'][] = $type;
                        break;
                        
                    case 'notes':
                        $this->sync_user_notes($user_id, $data, $device_id);
                        $results['processed'][] = $type;
                        break;
                        
                    case 'bookmarks':
                        $this->sync_user_bookmarks($user_id, $data);
                        $results['processed'][] = $type;
                        break;
                        
                    default:
                        $results['errors'][] = array(
                            'type' => $type,
                            'error' => 'Type de données non supporté'
                        );
                }
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => $type,
                    'error' => $e->getMessage()
                );
            }
        }
        
        return array(
            'success' => true,
            'processed' => $results['processed'],
            'errors' => $results['errors']
        );
    }
    
    /**
     * Obtenir le statut de synchronisation
     */
    public function get_sync_status($request) {
        $user_id = $this->get_current_user_id();
        
        $last_sync = get_user_meta($user_id, '_col_lms_last_sync', true);
        $sync_stats = $this->get_user_sync_stats($user_id);
        $pending_conflicts = $this->get_pending_conflicts($user_id);
        
        return array(
            'last_sync' => $last_sync,
            'last_sync_human' => $last_sync ? human_time_diff(strtotime($last_sync)) . ' ago' : 'Jamais',
            'sync_enabled' => get_option('col_lms_enable_progress_sync', true),
            'auto_sync_interval' => get_option('col_lms_auto_sync_interval', 3600),
            'stats' => $sync_stats,
            'pending_conflicts' => count($pending_conflicts),
            'conflicts' => $pending_conflicts,
            'server_time' => current_time('mysql')
        );
    }
    
    /**
     * Forcer une synchronisation complète
     */
    public function force_full_sync($request) {
        $user_id = $this->get_current_user_id();
        $reset_progress = $request->get_param('reset_progress');
        
        if ($reset_progress) {
            // Réinitialiser toutes les données de synchronisation
            delete_user_meta($user_id, '_col_lms_last_sync');
            $this->clear_sync_conflicts($user_id);
        }
        
        // Marquer pour synchronisation complète
        update_user_meta($user_id, '_col_lms_force_full_sync', true);
        
        $this->log_action('force_full_sync', array(
            'reset_progress' => $reset_progress
        ));
        
        return array(
            'success' => true,
            'message' => __('Synchronisation complète programmée.', 'col-lms-offline-api')
        );
    }
    
    /**
     * Résoudre les conflits de synchronisation
     */
    public function resolve_sync_conflicts($request) {
        $user_id = $this->get_current_user_id();
        $conflicts = $request->get_param('conflicts');
        $strategy = $request->get_param('resolution_strategy');
        
        $resolved = array();
        $errors = array();
        
        foreach ($conflicts as $conflict) {
            try {
                switch ($strategy) {
                    case 'server_wins':
                        $this->resolve_conflict_server_wins($user_id, $conflict);
                        break;
                        
                    case 'client_wins':
                        $this->resolve_conflict_client_wins($user_id, $conflict);
                        break;
                        
                    case 'merge':
                        $this->resolve_conflict_merge($user_id, $conflict);
                        break;
                        
                    case 'manual':
                        $this->resolve_conflict_manual($user_id, $conflict);
                        break;
                }
                
                $resolved[] = $conflict['id'];
                
            } catch (Exception $e) {
                $errors[] = array(
                    'conflict_id' => $conflict['id'],
                    'error' => $e->getMessage()
                );
            }
        }
        
        return array(
            'success' => true,
            'resolved' => $resolved,
            'errors' => $errors
        );
    }
    
    /**
     * Vérifier les permissions de synchronisation
     */
    public function check_sync_permission($request) {
        if (!$this->check_auth($request)) {
            return false;
        }
        
        return $this->check_permission('col_lms_sync_progress');
    }
    
    /**
     * Valider les données de progression
     */
    public function validate_progress_data($param) {
        if (!is_array($param)) {
            return false;
        }
        
        // Vérifier la structure des données
        $allowed_keys = array('lessons', 'quizzes', 'assignments', 'notes');
        
        foreach ($param as $key => $value) {
            if (!in_array($key, $allowed_keys)) {
                return false;
            }
            
            if (!is_array($value)) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Synchroniser les leçons
     */
    private function sync_lessons($user_id, $lessons_data, $device_id, $timestamp) {
        $results = array(
            'synced' => array(),
            'conflicts' => array(),
            'errors' => array()
        );
        
        foreach ($lessons_data as $lesson_data) {
            try {
                $lesson_id = intval($lesson_data['id']);
                $course_id = $this->get_lesson_course($lesson_id);
                
                if (!$course_id || !$this->user_can_access_course($user_id, $course_id)) {
                    throw new Exception(__('Accès non autorisé à la leçon', 'col-lms-offline-api'));
                }
                
                // Vérifier les conflits
                $conflict = $this->detect_lesson_conflict($user_id, $lesson_id, $lesson_data, $timestamp);
                
                if ($conflict) {
                    $results['conflicts'][] = array(
                        'type' => 'lesson',
                        'id' => $lesson_id,
                        'conflict' => $conflict,
                        'client_data' => $lesson_data,
                        'server_data' => $this->get_server_lesson_data($user_id, $lesson_id)
                    );
                    continue;
                }
                
                // Synchroniser la leçon
                $user = learn_press_get_user($user_id);
                $user_item = $user->get_item($lesson_id, $course_id);
                
                if (!$user_item) {
                    $user_item = $user->start_item($lesson_id, $course_id);
                }
                
                if ($user_item) {
                    // Mettre à jour la progression
                    if (isset($lesson_data['progress'])) {
                        $user_item->update_meta('progress', intval($lesson_data['progress']));
                    }
                    
                    // Mettre à jour le statut
                    if (isset($lesson_data['status'])) {
                        $user_item->set_status($lesson_data['status']);
                    }
                    
                    // Mettre à jour le temps passé
                    if (isset($lesson_data['time_spent'])) {
                        $current_time = $user_item->get_meta('time_spent', 0);
                        $new_time = max($current_time, intval($lesson_data['time_spent']));
                        $user_item->update_meta('time_spent', $new_time);
                    }
                    
                    // Mettre à jour les timestamps
                    if (isset($lesson_data['start_time'])) {
                        $user_item->set_start_time($lesson_data['start_time']);
                    }
                    
                    if (isset($lesson_data['end_time']) && $lesson_data['status'] === 'completed') {
                        $user_item->set_end_time($lesson_data['end_time']);
                    }
                    
                    // Marquer la synchronisation
                    $user_item->update_meta('last_sync_timestamp', $timestamp);
                    $user_item->update_meta('sync_device_id', $device_id);
                    
                    $results['synced'][] = array(
                        'type' => 'lesson',
                        'id' => $lesson_id,
                        'status' => $user_item->get_status(),
                        'progress' => $user_item->get_meta('progress', 0)
                    );
                }
                
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => 'lesson',
                    'id' => $lesson_data['id'] ?? 'unknown',
                    'error' => $e->getMessage()
                );
            }
        }
        
        return $results;
    }
    
    /**
     * Synchroniser les quiz
     */
    private function sync_quizzes($user_id, $quizzes_data, $device_id, $timestamp) {
        $results = array(
            'synced' => array(),
            'conflicts' => array(),
            'errors' => array()
        );
        
        foreach ($quizzes_data as $quiz_data) {
            try {
                $quiz_id = intval($quiz_data['id']);
                $course_id = $this->get_lesson_course($quiz_id);
                
                if (!$course_id || !$this->user_can_access_course($user_id, $course_id)) {
                    throw new Exception(__('Accès non autorisé au quiz', 'col-lms-offline-api'));
                }
                
                // Vérifier les conflits
                $conflict = $this->detect_quiz_conflict($user_id, $quiz_id, $quiz_data, $timestamp);
                
                if ($conflict) {
                    $results['conflicts'][] = array(
                        'type' => 'quiz',
                        'id' => $quiz_id,
                        'conflict' => $conflict
                    );
                    continue;
                }
                
                // Synchroniser le quiz
                $user = learn_press_get_user($user_id);
                
                if (isset($quiz_data['attempt_data'])) {
                    // Nouvelle tentative de quiz
                    $quiz_attempt = $this->create_quiz_attempt($user_id, $quiz_id, $course_id, $quiz_data['attempt_data']);
                    
                    if ($quiz_attempt) {
                        $results['synced'][] = array(
                            'type' => 'quiz_attempt',
                            'id' => $quiz_id,
                            'attempt_id' => $quiz_attempt->get_id(),
                            'score' => $quiz_attempt->get_results('result')
                        );
                    }
                } else {
                    // Mise à jour de progression existante
                    $user_item = $user->get_item($quiz_id, $course_id);
                    
                    if ($user_item && isset($quiz_data['status'])) {
                        $user_item->set_status($quiz_data['status']);
                        $user_item->update_meta('last_sync_timestamp', $timestamp);
                        
                        $results['synced'][] = array(
                            'type' => 'quiz',
                            'id' => $quiz_id,
                            'status' => $user_item->get_status()
                        );
                    }
                }
                
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => 'quiz',
                    'id' => $quiz_data['id'] ?? 'unknown',
                    'error' => $e->getMessage()
                );
            }
        }
        
        return $results;
    }
    
    /**
     * Synchroniser les devoirs
     */
    private function sync_assignments($user_id, $assignments_data, $device_id, $timestamp) {
        $results = array(
            'synced' => array(),
            'conflicts' => array(),
            'errors' => array()
        );
        
        // Cette méthode peut être étendue selon votre implémentation des devoirs
        // Pour l'instant, retourner un résultat vide
        
        return $results;
    }
    
    /**
     * Synchroniser les notes utilisateur
     */
    private function sync_user_notes($user_id, $notes_data, $device_id, $timestamp = null) {
        $results = array(
            'synced' => array(),
            'errors' => array()
        );
        
        foreach ($notes_data as $note_data) {
            try {
                $note_id = isset($note_data['id']) ? $note_data['id'] : wp_generate_uuid4();
                
                $note = array(
                    'id' => $note_id,
                    'user_id' => $user_id,
                    'content' => sanitize_textarea_field($note_data['content']),
                    'item_id' => intval($note_data['item_id']),
                    'item_type' => sanitize_text_field($note_data['item_type']),
                    'timestamp' => $note_data['timestamp'] ?? current_time('mysql'),
                    'device_id' => $device_id,
                    'sync_timestamp' => $timestamp ?? time()
                );
                
                // Sauvegarder la note
                $existing_notes = get_user_meta($user_id, '_col_lms_notes', true) ?: array();
                $existing_notes[$note_id] = $note;
                update_user_meta($user_id, '_col_lms_notes', $existing_notes);
                
                $results['synced'][] = array(
                    'type' => 'note',
                    'id' => $note_id
                );
                
            } catch (Exception $e) {
                $results['errors'][] = array(
                    'type' => 'note',
                    'id' => $note_data['id'] ?? 'unknown',
                    'error' => $e->getMessage()
                );
            }
        }
        
        return $results;
    }
    
    /**
     * Obtenir les données des cours de l'utilisateur
     */
    private function get_user_courses_data($user_id, $since = null, $course_ids = null) {
        $user = learn_press_get_user($user_id);
        $enrolled_courses = $user->get_enrolled_courses();
        $courses_data = array();
        
        // Filtrer par IDs si spécifié
        if ($course_ids) {
            $enrolled_courses = array_intersect($enrolled_courses, $course_ids);
        }
        
        foreach ($enrolled_courses as $course_id) {
            $course_data = $user->get_course_data($course_id);
            
            if ($course_data) {
                $last_modified = max(
                    strtotime($course_data->get_start_time()),
                    strtotime($course_data->get_end_time() ?: '1970-01-01'),
                    strtotime(get_post_modified_time('Y-m-d H:i:s', true, $course_id))
                );
                
                // Filtrer par date si nécessaire
                if ($since && $last_modified < strtotime($since)) {
                    continue;
                }
                
                $data = array(
                    'course_id' => $course_id,
                    'status' => $course_data->get_status(),
                    'start_time' => $course_data->get_start_time(),
                    'end_time' => $course_data->get_end_time(),
                    'expiration_time' => $course_data->get_expiration_time(),
                    'progress' => $course_data->get_results('result'),
                    'grade' => $course_data->get_results('grade'),
                    'last_modified' => date('Y-m-d H:i:s', $last_modified),
                    'course_version' => get_post_meta($course_id, '_lp_course_version', true) ?: 1
                );
                
                $courses_data[] = $data;
            }
        }
        
        return $courses_data;
    }
    
    /**
     * Obtenir les données de progression
     */
    private function get_user_progress_data($user_id, $since = null, $course_ids = null) {
        global $wpdb;
        
        $where_conditions = array('ui.user_id = %d');
        $where_values = array($user_id);
        
        if ($since) {
            $where_conditions[] = 'ui.start_time >= %s';
            $where_values[] = $since;
        }
        
        if ($course_ids) {
            $placeholders = implode(',', array_fill(0, count($course_ids), '%d'));
            $where_conditions[] = "ui.ref_id IN ($placeholders)";
            $where_values = array_merge($where_values, $course_ids);
        }
        
        $where_clause = implode(' AND ', $where_conditions);
        
        $query = "
            SELECT ui.*, 
                   GROUP_CONCAT(CONCAT(uim.meta_key, ':', uim.meta_value) SEPARATOR '|') as meta_data
            FROM {$wpdb->prefix}learnpress_user_items ui
            LEFT JOIN {$wpdb->prefix}learnpress_user_itemmeta uim 
                ON ui.user_item_id = uim.learnpress_user_item_id
            WHERE $where_clause
            AND ui.item_type IN ('lp_lesson', 'lp_quiz')
            GROUP BY ui.user_item_id
        ";
        
        $items = $wpdb->get_results($wpdb->prepare($query, $where_values));
        
        $progress_data = array();
        
        foreach ($items as $item) {
            // Parser les métadonnées
            $meta = array();
            if ($item->meta_data) {
                $meta_pairs = explode('|', $item->meta_data);
                foreach ($meta_pairs as $pair) {
                    if (strpos($pair, ':') !== false) {
                        list($key, $value) = explode(':', $pair, 2);
                        $meta[$key] = $value;
                    }
                }
            }
            
            $progress_data[] = array(
                'item_id' => $item->item_id,
                'course_id' => $item->ref_id,
                'item_type' => $item->item_type,
                'status' => $item->status,
                'progress' => isset($meta['progress']) ? intval($meta['progress']) : 0,
                'start_time' => $item->start_time,
                'end_time' => $item->end_time,
                'time_spent' => isset($meta['time_spent']) ? intval($meta['time_spent']) : 0,
                'last_sync' => isset($meta['last_sync_timestamp']) ? $meta['last_sync_timestamp'] : null
            );
        }
        
        return $progress_data;
    }
    
    /**
     * Obtenir les données des quiz
     */
    private function get_user_quiz_data($user_id, $since = null, $course_ids = null) {
        global $wpdb;
        
        $where_conditions = array('ui.user_id = %d', 'ui.item_type = %s');
        $where_values = array($user_id, 'lp_quiz');
        
        if ($since) {
            $where_conditions[] = 'ui.end_time >= %s';
            $where_values[] = $since;
        }
        
        if ($course_ids) {
            $placeholders = implode(',', array_fill(0, count($course_ids), '%d'));
            $where_conditions[] = "ui.ref_id IN ($placeholders)";
            $where_values = array_merge($where_values, $course_ids);
        }
        
        $where_clause = implode(' AND ', $where_conditions);
        
        $query = "
            SELECT ui.*, uim.meta_value as results
            FROM {$wpdb->prefix}learnpress_user_items ui
            LEFT JOIN {$wpdb->prefix}learnpress_user_itemmeta uim 
                ON ui.user_item_id = uim.learnpress_user_item_id 
                AND uim.meta_key = 'results'
            WHERE $where_clause
            AND ui.status IN ('completed', 'passed', 'failed')
            ORDER BY ui.end_time DESC
        ";
        
        $quizzes = $wpdb->get_results($wpdb->prepare($query, $where_values));
        
        $quiz_data = array();
        
        foreach ($quizzes as $quiz) {
            $results = maybe_unserialize($quiz->results);
            
            $quiz_data[] = array(
                'quiz_id' => $quiz->item_id,
                'course_id' => $quiz->ref_id,
                'attempt_id' => $quiz->user_item_id,
                'status' => $quiz->status,
                'grade' => isset($results['grade']) ? $results['grade'] : 0,
                'points' => isset($results['user_points']) ? $results['user_points'] : 0,
                'max_points' => isset($results['question_points']) ? $results['question_points'] : 0,
                'passed' => isset($results['passed']) ? $results['passed'] : false,
                'answers' => isset($results['questions']) ? $results['questions'] : array(),
                'start_time' => $quiz->start_time,
                'end_time' => $quiz->end_time,
                'time_spent' => isset($results['time_spent']) ? $results['time_spent'] : 0
            );
        }
        
        return $quiz_data;
    }
    
    /**
     * Obtenir les certificats
     */
    private function get_user_certificates($user_id, $since = null) {
        // Cette méthode dépend de votre système de certificats
        // Implémentation de base
        
        $certificates = array();
        
        // Si vous utilisez un plugin de certificats
        if (function_exists('learndash_get_user_certificates')) {
            // Exemple pour LearnDash
            $user_certificates = learndash_get_user_certificates($user_id);
            
            foreach ($user_certificates as $cert) {
                if ($since && strtotime($cert->post_date) < strtotime($since)) {
                    continue;
                }
                
                $certificates[] = array(
                    'id' => $cert->ID,
                    'course_id' => get_post_meta($cert->ID, 'course_id', true),
                    'title' => $cert->post_title,
                    'issued_date' => $cert->post_date,
                    'certificate_url' => get_permalink($cert->ID)
                );
            }
        }
        
        return $certificates;
    }
    
    /**
     * Obtenir les données des devoirs
     */
    private function get_user_assignments_data($user_id, $since = null, $course_ids = null) {
        // Implémentation selon votre système de devoirs
        return array();
    }
    
    /**
     * Enregistrer une opération de synchronisation
     */
    private function record_sync_operation($user_id, $device_id, $results, $timestamp) {
        global $wpdb;
        
        // Mettre à jour la dernière synchronisation
        update_user_meta($user_id, '_col_lms_last_sync', current_time('mysql'));
        update_user_meta($user_id, '_col_lms_last_sync_device', $device_id);
        
        // Enregistrer dans la table de logs
        $wpdb->insert(
            $wpdb->prefix . 'col_lms_sync_log',
            array(
                'user_id' => $user_id,
                'sync_type' => 'progress',
                'items_synced' => count($results['synced']),
                'items_failed' => count($results['errors']),
                'conflicts_detected' => count($results['conflicts']),
                'sync_data' => wp_json_encode($results),
                'device_id' => $device_id,
                'client_timestamp' => date('Y-m-d H:i:s', $timestamp),
                'created_at' => current_time('mysql')
            )
        );
    }
    
    /**
     * Détecter les conflits de leçon
     */
    private function detect_lesson_conflict($user_id, $lesson_id, $client_data, $client_timestamp) {
        $user = learn_press_get_user($user_id);
        $course_id = $this->get_lesson_course($lesson_id);
        $user_item = $user->get_item($lesson_id, $course_id);
        
        if (!$user_item) {
            return false; // Pas de conflit si pas d'item serveur
        }
        
        $server_timestamp = $user_item->get_meta('last_sync_timestamp', 0);
        $server_device = $user_item->get_meta('sync_device_id', '');
        
        // Conflit si les données ont été modifiées par un autre appareil après le timestamp client
        if ($server_timestamp > $client_timestamp && $server_device !== $client_data['device_id']) {
            return 'timestamp_conflict';
        }
        
        // Conflit de statut
        if ($user_item->get_status() !== $client_data['status']) {
            return 'status_conflict';
        }
        
        return false;
    }
    
    /**
     * Détecter les conflits de quiz
     */
    private function detect_quiz_conflict($user_id, $quiz_id, $client_data, $client_timestamp) {
        // Implémentation similaire pour les quiz
        return false;
    }
    
    /**
     * Obtenir les statistiques de synchronisation d'un utilisateur
     */
    private function get_user_sync_stats($user_id) {
        global $wpdb;
        
        $stats = array();
        
        // Dernières synchronisations
        $stats['recent_syncs'] = $wpdb->get_results($wpdb->prepare("
            SELECT sync_type, items_synced, items_failed, created_at
            FROM {$wpdb->prefix}col_lms_sync_log
            WHERE user_id = %d
            ORDER BY created_at DESC
            LIMIT 10
        ", $user_id));
        
        // Statistiques globales
        $stats['total_syncs'] = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(*)
            FROM {$wpdb->prefix}col_lms_sync_log
            WHERE user_id = %d
        ", $user_id));
        
        $stats['total_items_synced'] = $wpdb->get_var($wpdb->prepare("
            SELECT SUM(items_synced)
            FROM {$wpdb->prefix}col_lms_sync_log
            WHERE user_id = %d
        ", $user_id));
        
        return $stats;
    }
    
    /**
     * Obtenir les conflits en attente
     */
    private function get_pending_conflicts($user_id) {
        $conflicts = get_user_meta($user_id, '_col_lms_sync_conflicts', true);
        return is_array($conflicts) ? $conflicts : array();
    }
    
    /**
     * Nettoyer les conflits de synchronisation
     */
    private function clear_sync_conflicts($user_id) {
        delete_user_meta($user_id, '_col_lms_sync_conflicts');
    }
    
    /**
     * Traitement automatique de la synchronisation
     */
    public function process_auto_sync() {
        // Cette méthode peut être utilisée pour traiter automatiquement
        // certaines synchronisations côté serveur
        
        global $wpdb;
        
        // Nettoyer les anciens logs de synchronisation
        $retention_days = get_option('col_lms_sync_log_retention', 30);
        
        $wpdb->query($wpdb->prepare("
            DELETE FROM {$wpdb->prefix}col_lms_sync_log
            WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)
        ", $retention_days));
        
        COL_LMS_Logger::info('Nettoyage automatique des logs de synchronisation effectué');
    }
    
    /**
     * Obtenir le cours d'une leçon/quiz
     */
    private function get_lesson_course($item_id) {
        global $wpdb;
        
        $course_id = $wpdb->get_var($wpdb->prepare("
            SELECT s.section_course_id
            FROM {$wpdb->prefix}learnpress_section_items si
            JOIN {$wpdb->prefix}learnpress_sections s ON si.section_id = s.section_id
            WHERE si.item_id = %d
        ", $item_id));
        
        return $course_id;
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
