#!/bin/bash
set -e

GEOSERVER_DATA_DIR="${GEOSERVER_DATA_DIR:-/var/local/geoserver}"
GEOSERVER_LIB="/usr/share/geoserver/webapps/geoserver/WEB-INF/lib"

# Configure JDBCConfig if database environment variables are set
if [ -n "$JDBC_URL" ] || { [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ]; }; then
  echo "Configuring JDBCConfig for PostgreSQL..."
  
  JDBCCONFIG_DIR="$GEOSERVER_DATA_DIR/jdbcconfig"
  SCRIPTS_DIR="$JDBCCONFIG_DIR/scripts"
  mkdir -p "$SCRIPTS_DIR"
  
  # Extract init scripts from the jdbcconfig jar
  JDBCCONFIG_JAR=$(find "$GEOSERVER_LIB" -name "gs-jdbcconfig-*.jar" | head -1)
  if [ -n "$JDBCCONFIG_JAR" ]; then
    echo "Extracting init scripts from $JDBCCONFIG_JAR..."
    unzip -o -j "$JDBCCONFIG_JAR" "org/geoserver/jdbcconfig/internal/initdb.*.sql" -d "$SCRIPTS_DIR" 2>/dev/null || true
    echo "Init scripts extracted to $SCRIPTS_DIR"
  else
    echo "Warning: JDBCConfig jar not found"
  fi
  
  # Construct JDBC URL from individual components or use provided URL
  if [ -n "$JDBC_URL" ]; then
    # JDBC URL provided directly, use as-is
    DB_USER="${DB_USER:-}"
    DB_PASSWORD="${DB_PASSWORD:-}"
    echo "Using provided JDBC URL"
  else
    # Build JDBC URL from individual components
    JDBC_URL="jdbc:postgresql://${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
    
    # Add any additional connection parameters
    if [ -n "$DB_PARAMS" ]; then
      JDBC_URL="${JDBC_URL}?${DB_PARAMS}"
    fi
    
    DB_USER="${DB_USER:-geoserver}"
    DB_PASSWORD="${DB_PASSWORD:-geoserver}"
    
    echo "Built JDBC URL from components: ${JDBC_URL}"
    echo "User: ${DB_USER}"
  fi
  
  # Set initdb and import flags
  # Use environment variables to control initialization (default to false to avoid recreating tables)
  # On first deployment, set JDBCCONFIG_INITDB=true in Cloud Run
  INITDB="${JDBCCONFIG_INITDB:-false}"
  IMPORT="${JDBCCONFIG_IMPORT:-false}"
  
  echo "JDBCConfig initialization settings: initdb=$INITDB, import=$IMPORT"
  
  cat > "$JDBCCONFIG_DIR/jdbcconfig.properties" << EOF
enabled=true
initdb=${INITDB}
import=${IMPORT}
jdbcUrl=${JDBC_URL}
driverClassName=org.postgresql.Driver
username=${DB_USER}
password=${DB_PASSWORD}
pool.minIdle=1
pool.maxActive=10
pool.poolPreparedStatements=true
pool.maxOpenPreparedStatements=50
pool.testOnBorrow=true
pool.validationQuery=SELECT 1
EOF

  echo "JDBCConfig configured (initdb=$INITDB, import=$IMPORT)"
else
  echo "Database not configured, using file-based catalog"
fi

echo "Starting GeoServer..."
echo "Data directory: $GEOSERVER_DATA_DIR"

# Start GeoServer
exec /usr/share/geoserver/bin/startup.sh
