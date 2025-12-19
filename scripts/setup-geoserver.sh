#!/bin/bash
#
# GeoServer Setup Script
# Ensures the HIFLD workspace exists in GeoServer
#
# The webapp API handles creating stores, layers, and features
# when datasets are added via the /api/datasets endpoint
#

set -e

# Configuration
GEOSERVER_URL="${GEOSERVER_URL:-http://localhost:8080/geoserver}"
GEOSERVER_USER="${GEOSERVER_USER:-admin}"
GEOSERVER_PASSWORD="${GEOSERVER_PASSWORD:-geoserver}"
WORKSPACE="${GEOSERVER_WORKSPACE:-hifld}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Wait for GeoServer to be ready
wait_for_geoserver() {
    log_info "Waiting for GeoServer to be ready..."
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "${GEOSERVER_URL}/web/" > /dev/null 2>&1; then
            log_info "GeoServer is ready!"
            return 0
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done
    log_error "GeoServer did not become ready in time"
    return 1
}

# Check if workspace exists
workspace_exists() {
    local ws=$1
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        -u "${GEOSERVER_USER}:${GEOSERVER_PASSWORD}" \
        "${GEOSERVER_URL}/rest/workspaces/${ws}")
    [ "$response" = "200" ]
}

# Create workspace
create_workspace() {
    local ws=$1
    log_info "Ensuring workspace exists: ${ws}"
    
    if workspace_exists "$ws"; then
        log_info "Workspace ${ws} already exists"
        return 0
    fi
    
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        -u "${GEOSERVER_USER}:${GEOSERVER_PASSWORD}" \
        -X POST "${GEOSERVER_URL}/rest/workspaces" \
        -H "Content-Type: application/json" \
        -d "{\"workspace\": {\"name\": \"${ws}\"}}")
    
    if [ "$response" = "201" ]; then
        log_info "Workspace ${ws} created successfully"
        return 0
    else
        log_error "Failed to create workspace ${ws} (HTTP ${response})"
        return 1
    fi
}

# Main
main() {
    log_info "=== GeoServer Setup Script ==="
    log_info "GeoServer URL: ${GEOSERVER_URL}"
    log_info "Workspace: ${WORKSPACE}"
    echo ""
    
    wait_for_geoserver
    create_workspace "$WORKSPACE"
    
    log_info ""
    log_info "GeoServer is configured and ready."
    log_info "The webapp API will handle creating stores and layers"
    log_info "when datasets are added via POST /api/datasets"
    log_info ""
    log_info "=== Setup Complete ==="
}

main "$@"
