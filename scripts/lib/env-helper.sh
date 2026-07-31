#!/bin/bash

# Environment Helper - resolve the API base URL for the shell integration scripts.
#
#   1. Explicit override:  API_BASE_URL_<STAGE>  (e.g. API_BASE_URL_STAGING)
#   2. Generic override:   API_URL
#   3. Default workers.dev: https://<wrangler-name>-<stage>.<WORKERS_SUBDOMAIN>.workers.dev
#      (`name` is read from wrangler.toml)
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
    # Try .env.<stage> for the override and WORKERS_SUBDOMAIN.
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
  local worker_name="${WORKER_NAME:-}"
  if [ -z "$worker_name" ] && [ -f "wrangler.toml" ]; then
    worker_name=$(sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' wrangler.toml | head -n 1)
  fi
  local cf_sub="${WORKERS_SUBDOMAIN:-}"
  if [ -z "$worker_name" ] || [ -z "$cf_sub" ]; then
    echo "ERROR: set API_BASE_URL_${upper} (full URL), or WORKERS_SUBDOMAIN with a readable wrangler.toml name" >&2
    return 1
  fi
  echo "https://${worker_name}-${stage}.${cf_sub}.workers.dev"
}

# Get the project label for display-only test output.
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
    if [ -f "wrangler.toml" ]; then
      project_name=$(sed -n 's/^[[:space:]]*PROJECT_NAME[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' wrangler.toml | head -n 1)
    fi
  fi

  if [ -z "$project_name" ]; then
    echo "ERROR: PROJECT_NAME is unavailable in the environment and wrangler.toml" >&2
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
