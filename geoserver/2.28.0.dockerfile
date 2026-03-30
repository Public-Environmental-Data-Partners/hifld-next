# Use Java 17 as base image (GeoServer requires Java 17 or 21)
FROM eclipse-temurin:17-jre

# Install unzip, zip, curl for health checks, and postgresql-client for schema checks
RUN apt-get update && \
    apt-get install -y unzip zip curl postgresql-client wget && \
    rm -rf /var/lib/apt/lists/*

# Download plugin zip files from GeoServer build server
# Using latest 2.28.x SNAPSHOT builds - latest ensures all components are from the same build
# Note: Using -latest instead of dated builds since dated builds are removed daily
RUN set -eux && \
    echo "Downloading GeoParquet plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-latest/geoserver-2.28-SNAPSHOT-geoparquet-plugin.zip" -o /tmp/geoparquet-plugin.zip && \
    test -s /tmp/geoparquet-plugin.zip && \
    echo "GeoParquet plugin downloaded successfully" && \
    echo "Downloading PMTiles plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-latest/geoserver-2.28-SNAPSHOT-pmtiles-store-plugin.zip" -o /tmp/pmtiles-plugin.zip && \
    test -s /tmp/pmtiles-plugin.zip && \
    echo "PMTiles plugin downloaded successfully" && \
    echo "Downloading JDBCConfig plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-latest/geoserver-2.28-SNAPSHOT-jdbcconfig-plugin.zip" -o /tmp/jdbcconfig-plugin.zip && \
    test -s /tmp/jdbcconfig-plugin.zip && \
    echo "JDBCConfig plugin downloaded successfully" && \
    echo "Downloading OGC API Features plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/ext-latest/geoserver-2.28-SNAPSHOT-ogcapi-features-plugin.zip" -o /tmp/ogcapi-features-plugin.zip && \
    test -s /tmp/ogcapi-features-plugin.zip && \
    echo "OGC API Features plugin downloaded successfully" && \
    echo "Downloading GeoPackage output plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/ext-latest/geoserver-2.28-SNAPSHOT-geopkg-output-plugin.zip" -o /tmp/geopkg-output-plugin.zip && \
    test -s /tmp/geopkg-output-plugin.zip && \
    echo "GeoPackage output plugin downloaded successfully" && \
    echo "Downloading FlatGeobuf plugin from GeoServer build server (latest)" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-latest/geoserver-2.28-SNAPSHOT-flatgeobuf-plugin.zip" -o /tmp/flatgeobuf-plugin.zip && \
    test -s /tmp/flatgeobuf-plugin.zip && \
    echo "FlatGeobuf plugin downloaded successfully"

# Set working directory
WORKDIR /usr/share/geoserver

# Download GeoServer binary from build server (latest - same build as plugins for compatibility)
RUN curl -fsSL -o /tmp/geoserver.zip \
    "https://build.geoserver.org/geoserver/2.28.x/geoserver-2.28.x-latest-bin.zip" && \
    echo "GeoServer binary downloaded successfully (latest build)"

# Extract GeoServer directly to working directory
RUN unzip -q /tmp/geoserver.zip -d /usr/share/geoserver && \
    rm -f /tmp/geoserver.zip

# Download PostgreSQL JDBC driver (required for JDBCConfig)
RUN curl -fsSL https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar -o /tmp/postgresql-jdbc.jar && \
    # Verify the JAR is valid
    unzip -t /tmp/postgresql-jdbc.jar > /dev/null && \
    echo "PostgreSQL JDBC driver downloaded and verified successfully"

# Extract and install plugins
RUN mkdir -p /tmp/geoparquet-extract /tmp/pmtiles-extract /tmp/jdbcconfig-extract /tmp/ogcapi-features-extract /tmp/geopkg-output-extract /tmp/flatgeobuf-extract && \
    unzip -q /tmp/geoparquet-plugin.zip -d /tmp/geoparquet-extract && \
    unzip -q /tmp/pmtiles-plugin.zip -d /tmp/pmtiles-extract && \
    unzip -q /tmp/jdbcconfig-plugin.zip -d /tmp/jdbcconfig-extract && \
    unzip -q /tmp/ogcapi-features-plugin.zip -d /tmp/ogcapi-features-extract && \
    unzip -q /tmp/geopkg-output-plugin.zip -d /tmp/geopkg-output-extract && \
    unzip -q /tmp/flatgeobuf-plugin.zip -d /tmp/flatgeobuf-extract && \
    # Patch PMTiles plugin: Remove incompatible 'category' property from applicationContext.xml
    # The category property is not writable in ModuleStatusImpl in GeoServer 2.28
    PMTILES_JAR=$(find /tmp/pmtiles-extract -name "gs-pmtiles-store-*.jar" | head -1) && \
    if [ -n "$PMTILES_JAR" ]; then \
        WORKDIR=$(pwd) && \
        cd /tmp && \
        unzip -q "$PMTILES_JAR" applicationContext.xml && \
        sed -i '/<property name="category"/d' applicationContext.xml && \
        zip -q "$PMTILES_JAR" applicationContext.xml && \
        rm -f applicationContext.xml && \
        cd "$WORKDIR" && \
        echo "PMTiles plugin patched: removed incompatible category property"; \
    fi && \
    # Copy .jar files to GeoServer lib directory
    find /tmp/geoparquet-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/pmtiles-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/jdbcconfig-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/ogcapi-features-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/geopkg-output-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/flatgeobuf-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    # Copy PostgreSQL JDBC driver to GeoServer lib
    cp /tmp/postgresql-jdbc.jar webapps/geoserver/WEB-INF/lib/ && \
    rm -rf /tmp/*.zip /tmp/*.jar /tmp/*-extract

# Copy entrypoint script (before user creation so root can chmod)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create a non-root user for running GeoServer with a proper home directory
# DuckDB (used by GeoParquet plugin) requires a home directory for extensions
# Also create the data directory with proper permissions
RUN useradd -r -m -d /home/geoserver -s /bin/bash geoserver && \
    chown -R geoserver:geoserver /usr/share/geoserver && \
    mkdir -p /home/geoserver/.duckdb && \
    mkdir -p /var/local/geoserver && \
    chown -R geoserver:geoserver /home/geoserver && \
    chown -R geoserver:geoserver /var/local/geoserver

# Set environment variables
ENV GEOSERVER_HOME=/usr/share/geoserver
ENV HOME=/home/geoserver
ENV JAVA_OPTS="-Xms512m -Xmx2048m -Djava.awt.headless=true"

# Switch to non-root user
USER geoserver

# Expose GeoServer default port
EXPOSE 8080

# Set the working directory to GeoServer home
WORKDIR /usr/share/geoserver

# Start GeoServer
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
