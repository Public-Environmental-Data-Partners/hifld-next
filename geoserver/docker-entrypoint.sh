#!/bin/bash
set -e

GEOSERVER_DATA_DIR="${GEOSERVER_DATA_DIR:-/var/local/geoserver}"
GEOSERVER_LIB="/usr/share/geoserver/webapps/geoserver/WEB-INF/lib"

# Configure JDBCConfig if database environment variables are set
if [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ]; then
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
  
  # Check if database is already initialized by checking for the 'object' table
  echo "Checking if JDBCConfig database is already initialized..."
  DB_INITIALIZED="false"
  if PGPASSWORD="${DB_PASSWORD:-geoserver}" psql -h "${DB_HOST}" -p "${DB_PORT:-5432}" -U "${DB_USER:-geoserver}" -d "${DB_NAME}" -c "SELECT 1 FROM object LIMIT 1" > /dev/null 2>&1; then
    echo "Database already initialized, skipping initdb"
    DB_INITIALIZED="true"
  else
    echo "Database not initialized, will run initdb"
  fi
  
  # Create jdbcconfig.properties
  # Set initdb=true only if database is not initialized
  # Set import=true only on first run (when database is empty)
  if [ "$DB_INITIALIZED" = "true" ]; then
    INITDB="false"
    IMPORT="false"
  else
    INITDB="true"
    IMPORT="true"
  fi
  
  cat > "$JDBCCONFIG_DIR/jdbcconfig.properties" << EOF
enabled=true
initdb=${INITDB}
import=${IMPORT}
jdbcUrl=jdbc:postgresql://${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}
driverClassName=org.postgresql.Driver
username=${DB_USER:-geoserver}
password=${DB_PASSWORD:-geoserver}
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
