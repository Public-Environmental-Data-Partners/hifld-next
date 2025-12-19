#!/bin/bash
set -e

echo "Starting GeoServer..."

# Start GeoServer
exec /usr/share/geoserver/bin/startup.sh
