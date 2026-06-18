#!/bin/bash

# Environment Helper - resolve the API base URL for the shell integration scripts.
# Source this file in your test scripts: source "$(dirname "$0")/../scripts/lib/env-helper.sh"
#
# Cloudflare-era resolution (no AWS Route53 / HOSTED_ZONE_NAME anymore):
#   1. Explicit override:  API_BASE_URL_<STAGE>  (e.g. API_BASE_URL_STAGING)
#   2. Generic override:   API_URL
#   3. Default workers.dev: https://<PROJECT_NAME>-<stage>.<CF_ACCOUNT_SUBDOMAIN>.workers.dev
#      (PROJECT_NAME + CF_ACCOUNT_SUBDOMAIN can live in .env.<stage>)
# For a custom domain, just set API_BASE_URL_<STAGE> to its full URL.

# Load environment variables from .env file if it exists
load_env_file() {
  local stage=$1
  local env_file=".env.${stage}"

  if [ -f "$env_file" ]; then
    # Export variables from .env file
    set -a
    source "$env_file"
    set +a
    return 0
  fi
  return 1
}

# Get the API base URL for a stage. No Route53/HOSTED_ZONE_NAME dependency.
get_api_url() {
  local stage=$1
  local upper
  upper=$(echo "$stage" | tr '[:lower:]' '[:upper:]')

  # 1. Per-stage explicit override, e.g. API_BASE_URL_STAGING
  local override_var="API_BASE_URL_${upper}"
  local override="${!override_var:-}"
  if [ -z "$override" ]; then
    # Try .env.<stage> for the override (and PROJECT_NAME / CF_ACCOUNT_SUBDOMAIN)
    load_env_file "$stage" 2>/dev/null || true
    override="${!override_var:-}"
  fi
  if [ -n "$override" ]; then
    echo "$override"
    return 0
  fi

  # 2. Generic override
  if [ -n "${API_URL:-}" ]; then
    echo "$API_URL"
    return 0
  fi

  # 3. Default to the Cloudflare workers.dev subdomain pattern
  local project="${PROJECT_NAME:-}"
  local cf_sub="${CF_ACCOUNT_SUBDOMAIN:-}"
  if [ -z "$project" ] || [ -z "$cf_sub" ]; then
    echo "ERROR: set API_BASE_URL_${upper} (full URL) or both PROJECT_NAME and CF_ACCOUNT_SUBDOMAIN (in .env.${stage})" >&2
    return 1
  fi
  echo "https://${project}-${stage}.${cf_sub}.workers.dev"
}

# Get project name
get_project_name() {
  local stage=$1
  local project_name="${PROJECT_NAME:-}"
  
  # Try to load from .env file if PROJECT_NAME not set
  if [ -z "$project_name" ]; then
    load_env_file "$stage" 2>/dev/null || true
    project_name="${PROJECT_NAME:-}"
  fi
  
  # No fallback - fail if not set
  if [ -z "$project_name" ]; then
    echo "ERROR: PROJECT_NAME environment variable is required" >&2
    return 1
  fi
  
  echo "$project_name"
}

# Get stack prefix (project-stage)
get_stack_prefix() {
  local stage=$1
  local project_name=$(get_project_name "$stage")
  echo "${project_name}-${stage}"
}
