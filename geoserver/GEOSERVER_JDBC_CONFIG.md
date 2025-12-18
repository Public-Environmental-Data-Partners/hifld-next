# GeoServer JDBCConfig Setup Guide

This guide explains how GeoServer is configured to use PostgreSQL as its catalog backend, storing all metadata (workspaces, stores, layers, styles) in the database instead of XML files.

**Note**: JDBCConfig is automatically configured on first startup via the `docker-entrypoint.sh` script. You typically don't need to manually configure it unless using an external database.

## Why JDBCConfig?

By default, GeoServer stores all its configuration (workspaces, stores, layers, styles, etc.) in XML files in the `data_dir`. While Docker volumes can persist this, using PostgreSQL as the catalog backend provides:

- **True persistence**: Configuration survives container recreation
- **Scalability**: Multiple GeoServer instances can share the same catalog
- **Backup**: Standard database backup procedures apply
- **Hosted environments**: Works reliably in cloud/hosted environments where volumes may not persist

## Prerequisites

1. PostgreSQL with PostGIS (already configured in docker-compose)
2. JDBCConfig extension installed (included in the Dockerfile)
3. GeoServer 2.28.0

## Automatic Configuration

When you run `docker compose up`, the entrypoint script automatically:
1. Waits for PostgreSQL to be ready
2. Creates the `jdbcconfig` directory if needed
3. Generates `jdbcconfig.properties` with connection to PostgreSQL
4. Starts GeoServer, which initializes the database on first run

**No manual configuration needed for local development!**

## Manual Configuration (Advanced)

### Option 1: Manual Configuration via Web UI

1. **Start GeoServer**:
   ```bash
   docker compose up -d geoserver
   ```

2. **Access GeoServer Web UI**: `http://localhost:8080/geoserver`
   - Default credentials: `admin` / `geoserver`

3. **Navigate to Catalog Configuration**:
   - Go to **Server Status** → **Configuration** → **Catalog**
   - Or directly: `http://localhost:8080/geoserver/rest/about/manifest`

4. **Enable JDBCConfig**:
   - In the catalog configuration, select **JDBCConfig** as the catalog implementation
   - Configure connection parameters:
     - **JDBC URL**: `jdbc:postgresql://geoserver-postgres:5432/geoserver`
     - **Username**: `geoserver` (or value from `DB_USER` env var)
     - **Password**: `geoserver` (or value from `DB_PASSWORD` env var)
     - **Driver Class**: `org.postgresql.Driver`

5. **Initialize Database**:
   - GeoServer will automatically create the necessary tables on first use
   - The tables will be created in the `public` schema

### Option 2: Programmatic Configuration via REST API

You can configure JDBCConfig programmatically using the REST API:

```bash
# Create jdbcconfig.properties file
docker exec hifld-geoserver bash -c 'cat > /var/local/geoserver/jdbcconfig.properties << EOF
jdbcconfig.datasource.url=jdbc:postgresql://geoserver-postgres:5432/geoserver
jdbcconfig.datasource.username=geoserver
jdbcconfig.datasource.password=geoserver
jdbcconfig.datasource.driverClassName=org.postgresql.Driver
EOF'

# Restart GeoServer to load the configuration
docker compose restart geoserver
```

### Option 3: Environment-Based Configuration

Update `docker-compose.yaml` to pass database connection info:

```yaml
geoserver:
  environment:
    # ... existing env vars ...
    JDBCCONFIG_DB_HOST: ${DB_HOST:-geoserver-postgres}
    JDBCCONFIG_DB_PORT: ${DB_PORT:-5432}
    JDBCCONFIG_DB_NAME: ${DB_NAME:-geoserver}
    JDBCCONFIG_DB_USER: ${DB_USER:-geoserver}
    JDBCCONFIG_DB_PASSWORD: ${DB_PASSWORD:-geoserver}
```

## Verification

After configuration, verify that GeoServer is using PostgreSQL:

1. **Check Database Tables**:
   ```bash
   docker exec hifld-geoserver-postgres psql -U geoserver -d geoserver -c "\dt"
   ```

   You should see tables like:
   - `catalog`
   - `data`
   - `style`
   - `workspace`
   - `namespace`
   - `store`
   - `resource`
   - `layer`
   - And many more...

2. **Check GeoServer Logs**:
   ```bash
   docker logs hifld-geoserver | grep -i jdbc
   ```

   Look for messages indicating JDBCConfig is being used.

3. **Create a Test Workspace**:
   - Create a workspace via the web UI
   - Check if it appears in the database:
     ```bash
     docker exec hifld-geoserver-postgres psql -U geoserver -d geoserver -c "SELECT * FROM workspace;"
     ```

## Migration from XML to JDBCConfig

If you have existing GeoServer configuration in XML files:

1. **Backup your data directory**:
   ```bash
   docker cp hifld-geoserver:/var/local/geoserver ./geoserver-backup
   ```

2. **Enable JDBCConfig** (as described above)

3. **GeoServer will automatically migrate** existing configuration from XML to the database on first startup with JDBCConfig enabled

4. **Verify migration** by checking that all workspaces, stores, and layers are accessible

## Troubleshooting

### JDBCConfig Not Available

- Verify the extension is installed:
  ```bash
  docker exec hifld-geoserver ls -la /usr/share/geoserver/webapps/geoserver/WEB-INF/lib/ | grep jdbcconfig
  ```

- Rebuild the Docker image if needed:
  ```bash
  docker compose build geoserver
  ```

### Connection Errors

- Verify PostgreSQL is accessible from GeoServer container:
  ```bash
  docker exec hifld-geoserver ping -c 2 geoserver-postgres
  ```

- Check database credentials match environment variables

- Verify PostgreSQL is accepting connections:
  ```bash
  docker exec hifld-geoserver-postgres psql -U geoserver -d geoserver -c "SELECT 1;"
  ```

### Tables Not Created

- JDBCConfig creates tables automatically on first use
- Check GeoServer logs for errors during initialization
- Ensure the database user has CREATE TABLE permissions

## Benefits

Once configured, all GeoServer metadata is stored in PostgreSQL:

- **Workspaces**: Stored in `workspace` table
- **Stores**: Stored in `store` table  
- **Layers**: Stored in `layer` table
- **Styles**: Stored in `style` table
- **All configuration**: Persists in database

This means:
- ✅ Configuration survives container restarts
- ✅ Can be backed up with standard PostgreSQL backups
- ✅ Multiple GeoServer instances can share configuration
- ✅ Works reliably in cloud/hosted environments

## Reverting to XML

If you need to revert to XML-based configuration:

1. Disable JDBCConfig in GeoServer web UI
2. Restart GeoServer
3. Configuration will be read from/written to XML files again

Note: The database tables will remain but won't be used.

