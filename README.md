# HIFLD Next - Dataset Catalog and GeoServer

A web application for hosting and serving HIFLD (Homeland Infrastructure Foundation-Level Data) datasets with GeoServer for OGC Feature API access.

## Features

- **Dataset Processing**: Download, validate, and convert datasets from Google Cloud Storage
- **PMTiles Generation**: Create PMTiles for efficient tile serving
- **GeoServer Integration**: OGC Feature API (WFS) access via GeoServer
- **PostgreSQL Backend**: GeoServer catalog metadata stored in PostgreSQL for persistence
- **Object Storage**: SeaweedFS for local object storage
- **Web Catalog**: Frontend catalog for browsing datasets

## Quick Start

### Prerequisites

- Docker and Docker Compose
- (Optional) Copy `.env.example` to `.env` and customize settings

### Start All Services

```bash
docker compose up -d
```

This will start:
- **PostgreSQL** (with PostGIS) - Database for GeoServer catalog
- **GeoServer** - OGC Feature API server (auto-configured with JDBCConfig)
- **SeaweedFS** - Object storage (Master, Volume, Filer)

### Access Services

- **GeoServer Web UI**: http://localhost:8080/geoserver
  - Default credentials: `admin` / `geoserver`
- **SeaweedFS Filer UI**: http://localhost:8888
- **SeaweedFS S3 API**: http://localhost:8333

### First Startup

On first startup, GeoServer will:
1. Wait for PostgreSQL to be ready
2. Automatically configure JDBCConfig to use PostgreSQL
3. Initialize the database with catalog tables
4. Import any existing catalog from XML files

All GeoServer metadata (workspaces, stores, layers, styles) will be stored in PostgreSQL and persist across container restarts.

## Configuration

### Environment Variables

Create a `.env` file (see `.env.example`) to customize:

```env
# Database Configuration
POSTGRES_DB=geoserver
POSTGRES_USER=geoserver
POSTGRES_PASSWORD=geoserver
POSTGRES_PORT=5432

# For external database (Cloud SQL, etc.)
# DB_HOST=your-db-host
# DB_PORT=5432
# DB_NAME=geoserver
# DB_USER=geoserver
# DB_PASSWORD=your-password

# GeoServer Configuration
GEOSERVER_PORT=8080
JAVA_OPTS=-Xms512m -Xmx2048m -Djava.awt.headless=true
```

### Using External Database (Cloud SQL, etc.)

1. Update `.env` with your database connection details:
   ```env
   DB_HOST=your-cloud-sql-ip
   DB_NAME=geoserver
   DB_USER=your-user
   DB_PASSWORD=your-password
   ```

2. Start services (PostgreSQL service will be skipped if not needed):
```bash
   docker compose up -d geoserver seaweedfs-master seaweedfs-volume seaweedfs-filer
   ```

GeoServer will automatically configure JDBCConfig to use your external database.

## Project Structure

```
.
├── docker-compose.yaml       # Service definitions
├── geoserver/                # GeoServer Docker image
│   ├── 2.28.0.dockerfile    # GeoServer Dockerfile
│   ├── docker-entrypoint.sh # Auto-configuration script
│   └── binaries/             # GeoServer binaries and plugins
├── upload-processor/         # Dataset processing pipeline
├── webapp/                   # Frontend catalog application
└── inventory.csv             # Dataset inventory
```

## Services

### GeoServer

- **Port**: 8080
- **Catalog Backend**: PostgreSQL (via JDBCConfig)
- **Plugins**: PMTiles Store, GeoParquet, JDBCConfig
- **Data Directory**: `/var/local/geoserver` (persisted in Docker volume)

### PostgreSQL

- **Port**: 5432
- **Database**: `geoserver` (default)
- **Extensions**: PostGIS
- **Purpose**: Stores GeoServer catalog metadata

### SeaweedFS

- **Master**: Port 9333
- **Volume**: Port 8081
- **Filer UI**: Port 8888
- **S3 API**: Port 8333
- **Purpose**: Object storage for datasets and PMTiles

## Dataset Processing

The `upload-processor` directory contains code for:
- Downloading datasets from Google Cloud Storage (`gs://` URLs)
- Validating datasets
- Creating PMTiles
- Uploading to storage

See `upload-processor/README.md` for details.

## Development

### Rebuild GeoServer Image

```bash
docker compose build geoserver
docker compose up -d geoserver
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f geoserver
docker compose logs -f geoserver-postgres
```

### Verify JDBCConfig

Check that GeoServer is using PostgreSQL:

```bash
docker exec hifld-geoserver-postgres psql -U geoserver -d geoserver -c "SELECT COUNT(*) FROM object;"
```

You should see catalog objects stored in the database.

### Reset Everything

```bash
# Stop and remove containers
docker compose down

# Remove volumes (WARNING: deletes all data)
docker compose down -v

# Start fresh
docker compose up -d
```

## Documentation

- [GeoServer JDBCConfig Setup](./GEOSERVER_JDBC_CONFIG.md) - Detailed JDBCConfig configuration guide
- [GeoServer Database Setup](./GEOSERVER_DB_SETUP.md) - Database connection guide

## Troubleshooting

### GeoServer not starting

- Check logs: `docker compose logs geoserver`
- Verify PostgreSQL is healthy: `docker compose ps`
- Check JDBCConfig properties: `docker exec hifld-geoserver cat /usr/share/geoserver/webapps/geoserver/data/jdbcconfig/jdbcconfig.properties`

### Database connection issues

- Verify PostgreSQL is accessible: `docker exec hifld-geoserver-postgres psql -U geoserver -d geoserver -c "SELECT 1;"`
- Check network connectivity: `docker exec hifld-geoserver ping -c 2 geoserver-postgres`
- Review connection parameters in `.env` file

### JDBCConfig not working

- Check that JDBCConfig extension is installed: `docker exec hifld-geoserver ls /usr/share/geoserver/webapps/geoserver/WEB-INF/lib/ | grep jdbcconfig`
- Verify properties file exists and `enabled=true`: `docker exec hifld-geoserver cat /usr/share/geoserver/webapps/geoserver/data/jdbcconfig/jdbcconfig.properties`
- Check GeoServer logs for JDBCConfig messages

## License

[Add your license here]
