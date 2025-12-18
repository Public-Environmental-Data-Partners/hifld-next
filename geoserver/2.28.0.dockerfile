# Use Java 17 as base image (GeoServer requires Java 17 or 21)
FROM eclipse-temurin:17-jre

# Set working directory
WORKDIR /usr/share/geoserver

# Install unzip and netcat for health checks
RUN apt-get update && \
    apt-get install -y unzip postgresql-client netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy GeoServer binary
COPY binaries/2.28.0/geoserver-2.28.0-bin.zip /tmp/geoserver.zip

# Extract GeoServer directly to working directory
RUN unzip -q /tmp/geoserver.zip -d /usr/share/geoserver && \
    rm -f /tmp/geoserver.zip

# Copy plugin zip files
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-geoparquet-plugin.zip /tmp/geoparquet-plugin.zip
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-pmtiles-store-plugin.zip /tmp/pmtiles-plugin.zip
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-jdbcconfig-plugin.zip /tmp/jdbcconfig-plugin.zip

# Extract and install plugins
# Extract plugins to temporary directories
RUN mkdir -p /tmp/geoparquet-extract /tmp/pmtiles-extract /tmp/jdbcconfig-extract && \
    unzip -q /tmp/geoparquet-plugin.zip -d /tmp/geoparquet-extract && \
    unzip -q /tmp/pmtiles-plugin.zip -d /tmp/pmtiles-extract && \
    unzip -q /tmp/jdbcconfig-plugin.zip -d /tmp/jdbcconfig-extract && \
    # Copy .jar files to GeoServer lib directory
    find /tmp/geoparquet-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/pmtiles-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/jdbcconfig-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    # Clean up
    rm -rf /tmp/geoparquet-plugin.zip /tmp/pmtiles-plugin.zip /tmp/jdbcconfig-plugin.zip /tmp/geoparquet-extract /tmp/pmtiles-extract /tmp/jdbcconfig-extract

# Set environment variables
ENV GEOSERVER_HOME=/usr/share/geoserver
ENV JAVA_OPTS="-Xms512m -Xmx2048m"

# Create a non-root user for running GeoServer
RUN useradd -r geoserver && \
    chown -R geoserver:geoserver /usr/share/geoserver

# Switch to non-root user
USER geoserver

# Expose GeoServer default port
EXPOSE 8080

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set the working directory to GeoServer home
WORKDIR /usr/share/geoserver

# Use entrypoint script that auto-configures JDBCConfig
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

