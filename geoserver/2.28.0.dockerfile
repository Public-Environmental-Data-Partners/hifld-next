# Use Java 17 as base image (GeoServer requires Java 17 or 21)
FROM eclipse-temurin:17-jre

# Set working directory
WORKDIR /usr/share/geoserver

# Install unzip and curl for health checks
RUN apt-get update && \
    apt-get install -y unzip curl && \
    rm -rf /var/lib/apt/lists/*

# Copy GeoServer binary
COPY binaries/2.28.0/geoserver-2.28.0-bin.zip /tmp/geoserver.zip

# Extract GeoServer directly to working directory
RUN unzip -q /tmp/geoserver.zip -d /usr/share/geoserver && \
    rm -f /tmp/geoserver.zip

# Copy plugin zip files (GeoParquet and PMTiles only - JDBCConfig removed)
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-geoparquet-plugin.zip /tmp/geoparquet-plugin.zip
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-pmtiles-store-plugin.zip /tmp/pmtiles-plugin.zip

# Extract and install plugins
RUN mkdir -p /tmp/geoparquet-extract /tmp/pmtiles-extract && \
    unzip -q /tmp/geoparquet-plugin.zip -d /tmp/geoparquet-extract && \
    unzip -q /tmp/pmtiles-plugin.zip -d /tmp/pmtiles-extract && \
    find /tmp/geoparquet-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/pmtiles-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    rm -rf /tmp/geoparquet-plugin.zip /tmp/pmtiles-plugin.zip /tmp/geoparquet-extract /tmp/pmtiles-extract

# Copy entrypoint script (before user creation so root can chmod)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create a non-root user for running GeoServer with a proper home directory
# DuckDB (used by GeoParquet plugin) requires a home directory for extensions
RUN useradd -r -m -d /home/geoserver -s /bin/bash geoserver && \
    chown -R geoserver:geoserver /usr/share/geoserver && \
    mkdir -p /home/geoserver/.duckdb && \
    chown -R geoserver:geoserver /home/geoserver

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
