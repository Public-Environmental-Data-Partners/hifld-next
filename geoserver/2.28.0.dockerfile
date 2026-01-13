# Use Java 17 as base image (GeoServer requires Java 17 or 21)
FROM eclipse-temurin:17-jre

# Set working directory
WORKDIR /usr/share/geoserver

# Install unzip, curl for health checks, and postgresql-client for DB checks
RUN apt-get update && \
    apt-get install -y unzip curl postgresql-client && \
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
COPY binaries/2.28.0/geoserver-2.28-SNAPSHOT-ogcapi-features-plugin.zip /tmp/ogcapi-features-plugin.zip
COPY binaries/2.28.0/geoserver-2.28.0-geopkg-output-plugin.zip /tmp/geopkg-output-plugin.zip

# Extract and install plugins
RUN mkdir -p /tmp/geoparquet-extract /tmp/pmtiles-extract /tmp/jdbcconfig-extract /tmp/ogcapi-features-extract /tmp/geopkg-output-extract && \
    unzip -q /tmp/geoparquet-plugin.zip -d /tmp/geoparquet-extract && \
    unzip -q /tmp/pmtiles-plugin.zip -d /tmp/pmtiles-extract && \
    unzip -q /tmp/jdbcconfig-plugin.zip -d /tmp/jdbcconfig-extract && \
    unzip -q /tmp/ogcapi-features-plugin.zip -d /tmp/ogcapi-features-extract && \
    unzip -q /tmp/geopkg-output-plugin.zip -d /tmp/geopkg-output-extract && \
    # Copy .jar files to GeoServer lib directory
    find /tmp/geoparquet-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/pmtiles-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/jdbcconfig-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/ogcapi-features-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    find /tmp/geopkg-output-extract -name "*.jar" -exec cp {} webapps/geoserver/WEB-INF/lib/ \; && \
    rm -rf /tmp/*.zip /tmp/*-extract

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
