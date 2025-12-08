#!/bin/bash

# Environment Helper - Load configuration from .env files or SSM
# Source this file in your test scripts: source "$(dirname "$0")/../scripts/lib/env-helper.sh"

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

# Get API URL based on stage and HOSTED_ZONE_NAME
get_api_url() {
  local stage=$1
  local hosted_zone="${HOSTED_ZONE_NAME:-}"
  
  # Try to load from .env file if HOSTED_ZONE_NAME not set
  if [ -z "$hosted_zone" ]; then
    load_env_file "$stage" 2>/dev/null || true
    hosted_zone="${HOSTED_ZONE_NAME:-}"
  fi
  
  # No fallback - fail if not set
  if [ -z "$hosted_zone" ]; then
    echo "ERROR: HOSTED_ZONE_NAME environment variable is required" >&2
    return 1
  fi
  
  if [ "$stage" = "production" ]; then
    echo "https://api.${hosted_zone}"
  else
    echo "https://api-${stage}.${hosted_zone}"
  fi
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
