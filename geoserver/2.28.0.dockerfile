# Use Java 17 as base image (GeoServer requires Java 17 or 21)
FROM eclipse-temurin:17-jre

# Build date for GeoServer SNAPSHOT builds - ensures all components are from the same build
ARG BUILD_DATE=2026-01-15

# Install unzip, curl for health checks, and postgresql-client for schema checks
RUN apt-get update && \
    apt-get install -y unzip curl postgresql-client wget && \
    rm -rf /var/lib/apt/lists/*

# Download plugin zip files from GeoServer build server
# Using dated 2.28.x SNAPSHOT builds for consistency
# All components from same build date ensures compatibility
RUN set -eux && \
    echo "Downloading GeoParquet plugin from GeoServer build server (${BUILD_DATE})" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-${BUILD_DATE}/geoserver-2.28-SNAPSHOT-geoparquet-plugin.zip" -o /tmp/geoparquet-plugin.zip && \
    test -s /tmp/geoparquet-plugin.zip && \
    echo "GeoParquet plugin downloaded successfully" && \
    echo "Skipping PMTiles plugin (incompatible ModuleStatusImpl.category property)" && \
    echo "Downloading JDBCConfig plugin from GeoServer build server (${BUILD_DATE})" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/community-${BUILD_DATE}/geoserver-2.28-SNAPSHOT-jdbcconfig-plugin.zip" -o /tmp/jdbcconfig-plugin.zip && \
    test -s /tmp/jdbcconfig-plugin.zip && \
    echo "JDBCConfig plugin downloaded successfully" && \
    echo "Downloading OGC API Features plugin from GeoServer build server (${BUILD_DATE})" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/ext-${BUILD_DATE}/geoserver-2.28-SNAPSHOT-ogcapi-features-plugin.zip" -o /tmp/ogcapi-features-plugin.zip && \
    test -s /tmp/ogcapi-features-plugin.zip && \
    echo "OGC API Features plugin downloaded successfully" && \
    echo "Downloading GeoPackage output plugin from GeoServer build server (${BUILD_DATE})" && \
    curl -fsSL "https://build.geoserver.org/geoserver/2.28.x/ext-${BUILD_DATE}/geoserver-2.28-SNAPSHOT-geopkg-output-plugin.zip" -o /tmp/geopkg-output-plugin.zip && \
    test -s /tmp/geopkg-output-plugin.zip && \
    echo "GeoPackage output plugin downloaded successfully"

# Set working directory
WORKDIR /usr/share/geoserver

# Download GeoServer binary from build server (same dated build as plugins for compatibility)
ARG BUILD_DATE
RUN curl -fsSL -o /tmp/geoserver.zip \
    "https://build.geoserver.org/geoserver/2.28.x/geoserver-2.28.x-${BUILD_DATE}-bin.zip" && \
    echo "GeoServer binary downloaded successfully (${BUILD_DATE} build)"

# Extract GeoServer directly to working directory
RUN unzip -q /tmp/geoserver.zip -d /usr/share/geoserver && \
    rm -f /tmp/geoserver.zip

# Download PostgreSQL JDBC driver (required for JDBCConfig)
RUN curl -fsSL https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar -o /tmp/postgresql-jdbc.jar && \
    # Verify the JAR is valid
    unzip -t /tmp/postgresql-jdbc.jar > /dev/null && \
    echo "PostgreSQL JDBC driver downloaded and verified successfully"

# Extract and install plugins (PMTiles skipped due to incompatibility)
RUN mkdir -p /tmp/geoparquet-extract /tmp/jdbcconfig-extract /tmp/ogcapi-features-extract /tmp/geopkg-output-extract && \
    unzip -q /tmp/geoparquet-plugin.zip -d /tmp/geoparquet-extract && \
    unzip -q /tmp/jdbcconfig-plugin.zip -d /tmp/jdbcconfig-extract && \
    unzip -q /tmp/ogcapi-features-plugin.zip -d /tmp/ogcapi-features-extract && \
    unzip -q /tmp/geopkg-output-plugin.zip -d /tmp/geopkg-output-extract && \
    # Copy .jar files to GeoServer lib directory
    find /tmp/geoparquet-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/jdbcconfig-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/ogcapi-features-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/geopkg-output-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
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
