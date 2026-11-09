// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// External contract: JSON printed by `tirith check --format json`, tirith
// 0.4.2 (schema_version 3). Mirrors the Rust types it serializes:
//   JsonOutput    crates/tirith-core/src/output.rs
//   Finding       crates/tirith-core/src/verdict.rs (FindingProjection)
//   Evidence      crates/tirith-core/src/verdict.rs (EvidenceProjection)
//   SafeSuggestion crates/tirith-core/src/safe_command.rs
// Keep this complete; git-story maps it down in ../toolFilter.ts.

// Tirith JSON schema version these types describe.
export const TIRITH_SCHEMA_VERSION = 3;

export type TirithAction = "allow" | "warn" | "block" | "warn_ack";

export type TirithSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TirithConfidence = "low" | "medium" | "confirmed";

export interface TirithSuspiciousChar {
    offset: number;
    character: string;
    codepoint: string; // e.g. "U+0456"
    description: string;
    hex_bytes: string;
}

// Tagged by `type`.
export type TirithEvidence =
    | { type: "url"; raw: string }
    | { type: "host_comparison"; raw_host: string; similar_to: string }
    | { type: "command_pattern"; pattern: string; matched: string }
    | {
          type: "byte_sequence";
          offset: number;
          hex: string;
          description: string;
      }
    | { type: "env_var"; name: string; value_preview: string }
    | { type: "text"; detail: string }
    | {
          type: "threat_intel";
          source: string;
          threat_type: string;
          confidence: TirithConfidence;
          reference?: string;
      }
    | {
          type: "homoglyph_analysis";
          raw: string;
          escaped: string;
          suspicious_chars: TirithSuspiciousChar[];
      };

export interface TirithFinding {
    rule_id: TirithRuleId;
    severity: TirithSeverity;
    title: string;
    description: string;
    evidence: TirithEvidence[];
    human_view?: string;
    agent_view?: string;
    mitre_id?: string; // e.g. "T1059.004"
    custom_rule_id?: string;
    remediation?: string;
}

export interface TirithTimings {
    tier0_ms: number;
    tier1_ms: number;
    tier2_ms: number | null;
    tier3_ms: number | null;
    total_ms: number;
}

export interface TirithSafeSuggestion {
    rule_id: string;
    safe_command?: string;
    rationale: string;
    remediation: string;
}

export interface TirithCheckOutput {
    schema_version: number;
    action: TirithAction;
    findings: TirithFinding[];
    tier_reached: number;
    bypass_requested: boolean;
    bypass_honored: boolean;
    interactive_detected: boolean;
    policy_path_used: string | null;
    timings_ms: TirithTimings;
    urls_extracted_count?: number;
    safe_suggestions?: TirithSafeSuggestion[]; // only with --suggest
}

// All 244 RuleId values (serde snake_case of the RuleId enum).
export type TirithRuleId =
    | "non_ascii_hostname"
    | "punycode_domain"
    | "mixed_script_in_label"
    | "userinfo_trick"
    | "confusable_domain"
    | "raw_ip_url"
    | "non_standard_port"
    | "invalid_host_chars"
    | "trailing_dot_whitespace"
    | "lookalike_tld"
    | "non_ascii_path"
    | "homoglyph_in_path"
    | "double_encoding"
    | "plain_http_to_sink"
    | "schemeless_to_sink"
    | "insecure_tls_flags"
    | "shortened_url"
    | "ansi_escapes"
    | "control_chars"
    | "bidi_controls"
    | "zero_width_chars"
    | "hidden_multiline"
    | "unicode_tags"
    | "invisible_math_operator"
    | "variation_selector"
    | "invisible_whitespace"
    | "hangul_filler"
    | "confusable_text"
    | "pipe_to_interpreter"
    | "curl_pipe_shell"
    | "wget_pipe_shell"
    | "httpie_pipe_shell"
    | "xh_pipe_shell"
    | "dotfile_overwrite"
    | "archive_extract"
    | "proc_mem_access"
    | "docker_remote_priv_esc"
    | "credential_file_sweep"
    | "base64_decode_execute"
    | "data_exfiltration"
    | "wrapper_chain_too_deep"
    | "ps_set_execution_policy_bypass"
    | "ps_defender_exclusion"
    | "ps_inline_download_execute"
    | "reverse_shell"
    | "interpreter_suspicious_inline_exec"
    | "dynamic_code_execution"
    | "obfuscated_payload"
    | "suspicious_code_exfiltration"
    | "proxy_env_set"
    | "sensitive_env_export"
    | "code_injection_env"
    | "interpreter_hijack_env"
    | "shell_injection_env"
    | "metadata_endpoint"
    | "private_network_access"
    | "command_network_deny"
    | "config_injection"
    | "config_suspicious_indicator"
    | "config_malformed"
    | "config_non_ascii"
    | "config_invisible_unicode"
    | "mcp_insecure_server"
    | "mcp_untrusted_server"
    | "mcp_duplicate_server_name"
    | "mcp_overly_permissive"
    | "mcp_suspicious_args"
    | "mcp_server_drift"
    | "git_typosquat"
    | "docker_untrusted_registry"
    | "pip_url_install"
    | "npm_url_install"
    | "web3_rpc_endpoint"
    | "web3_address_in_url"
    | "vet_not_configured"
    | "repo_add_from_pipe"
    | "unsigned_repo_trust"
    | "gpg_check_disabled"
    | "kubectl_apply_remote"
    | "helm_untrusted_repo"
    | "terraform_remote_module"
    | "brew_untrusted_tap"
    | "workflow_unpinned_action"
    | "workflow_dangerous_trigger"
    | "workflow_curl_pipe_shell"
    | "workflow_untrusted_input"
    | "workflow_excessive_permissions"
    | "workflow_run_trigger"
    | "workflow_checkout_untrusted_ref"
    | "workflow_cache_poisoning"
    | "workflow_artifact_poisoning"
    | "dockerfile_unpinned_image"
    | "package_script_dangerous"
    | "notebook_hidden_content"
    | "notebook_suspicious_output"
    | "agent_instruction_hidden"
    | "svg_script_embedded"
    | "svg_external_reference"
    | "threat_malicious_package"
    | "threat_malicious_ip"
    | "threat_package_typosquat"
    | "threat_package_similar_name"
    | "threat_unresolved_malicious_package"
    | "threat_malicious_url"
    | "threat_phishing_url"
    | "threat_tor_exit_node"
    | "threat_threat_fox_ioc"
    | "threat_osv_vulnerable"
    | "threat_cisa_kev"
    | "threat_suspicious_package"
    | "threat_safe_browsing"
    | "package_not_found_in_registry"
    | "package_maintainer_change_recent"
    | "package_ownership_transferred"
    | "package_osv_advisory_active"
    | "package_dependency_confusion"
    | "package_install_script_network_call"
    | "package_repo_mismatch"
    | "package_policy_newer_than_days"
    | "package_policy_low_downloads"
    | "package_policy_typosquat_distance"
    | "package_policy_unknown_package_with_install_scripts"
    | "package_policy_not_found"
    | "hidden_css_content"
    | "hidden_color_content"
    | "hidden_html_attribute"
    | "markdown_comment"
    | "html_comment"
    | "server_cloaking"
    | "clipboard_hidden"
    | "pdf_hidden_text"
    | "credential_in_text"
    | "high_entropy_secret"
    | "private_key_exposed"
    | "policy_blocklisted"
    | "agent_denied_by_policy"
    | "custom_rule_match"
    | "license_required"
    | "output_osc52_clipboard_write"
    | "output_hidden_text"
    | "output_fake_prompt"
    | "output_terminal_hyperlink_mismatch"
    | "output_title_manipulation"
    | "output_clear_screen"
    | "output_truncated_escape_sequence"
    | "output_analysis_overflow"
    | "prompt_injection_in_output"
    | "ignore_previous_instructions"
    | "prompt_injection_obfuscated"
    | "output_data_exfiltration"
    | "web3_state_changing_command"
    | "web3_signer_risk"
    | "web3_network_policy_violation"
    | "context_prod_destructive_command"
    | "context_prod_write_operation"
    | "context_prod_credential_change"
    | "ssh_remote_destructive_on_labeled_host"
    | "ssh_remote_shell_on_labeled_host"
    | "iac_apply_without_plan"
    | "iac_apply_auto_approve"
    | "iac_apply_auto_approve_prod"
    | "iac_destroy_prod"
    | "iac_plan_high_risk_changes"
    | "iac_plan_hash_mismatch"
    | "sudo_shell_spawn"
    | "sudo_env_preserve_sensitive"
    | "sudo_tee_system_file"
    | "sudo_download_install"
    | "sudo_recursive_perms_broad_path"
    | "docker_run_privileged"
    | "docker_run_sensitive_bind_mount"
    | "docker_exec_prod_container"
    | "hygiene_private_key_loose_perms"
    | "hygiene_env_world_readable"
    | "hygiene_kubeconfig_group_readable"
    | "hygiene_npmrc_plaintext_token"
    | "hygiene_pypirc_plaintext_token"
    | "hygiene_ssh_config_unsafe_include"
    | "hygiene_git_credential_helper_store"
    | "hygiene_shell_history_secret_like"
    | "hygiene_cloud_creds_bad_perms"
    | "hygiene_db_dump_in_repo"
    | "persistence_shell_rc_modified"
    | "persistence_authorized_keys_new_entry"
    | "persistence_crontab_modified"
    | "persistence_launch_agent_added"
    | "persistence_ssh_config_include"
    | "persistence_direnv_new_envrc"
    | "alias_overrides_critical_command"
    | "alias_contains_network_call"
    | "alias_contains_credential_read"
    | "alias_recently_added"
    | "env_sensitive_exposed_to_unknown_script"
    | "env_sensitive_persisted_in_shell_rc"
    | "env_printenv_to_network_sink"
    | "exec_in_tmp"
    | "exec_recently_modified"
    | "exec_world_writable"
    | "exec_shadows_system_command"
    | "exec_unsigned"
    | "exec_in_repo_bin"
    | "path_writable_dir_before_system"
    | "path_duplicate_command_name"
    | "path_dir_in_repo"
    | "path_dir_in_tmp"
    | "repo_hook_network_call"
    | "repo_hook_credential_read"
    | "repo_hook_sudo"
    | "repo_hook_suspicious_shell_pattern"
    | "repo_hook_external_fetch"
    | "blast_deletes_outside_repo"
    | "blast_writes_system_path"
    | "blast_symlink_traversal"
    | "blast_empty_var_glob"
    | "blast_find_delete"
    | "blast_rsync_delete"
    | "blast_large_file_count"
    | "post_run_shell_rc_modified"
    | "exec_of_tainted_file"
    | "command_sourced_from_tainted_file"
    | "anomaly_first_time_in_this_repo"
    | "anomaly_rare_in_baseline"
    | "command_card_verified"
    | "command_card_unverified"
    | "command_card_mismatch"
    | "repo_command_unknown"
    | "repo_command_dangerous_pattern"
    | "canary_token_touched"
    | "paste_source_mismatch"
    | "ai_config_hidden_instruction_added"
    | "ai_config_tool_use_escalation"
    | "secret_write_then_network"
    | "dependency_change_then_network"
    | "delete_then_force_push"
    | "mass_file_deletion"
    | "analysis_incomplete"
    | "python_installed_integrity_violation"
    | "python_startup_hook_suspicious"
    | "python_startup_hook_cross_runtime"
    | "native_import_execution_chain"
    | "artifact_known_malicious"
    | "wheel_structurally_rejected"
    | "artifact_download_integrity_mismatch"
    | "artifact_release_anomaly";
