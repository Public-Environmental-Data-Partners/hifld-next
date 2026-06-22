FROM python:3.12-slim

# Install system dependencies for geospatial packages and build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    libgdal-dev \
    gdal-bin \
    libproj-dev \
    libgeos-dev \
    libspatialindex-dev \
    libsqlite3-dev \
    zlib1g-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install tippecanoe for PMTiles generation
RUN git clone https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
    && cd /tmp/tippecanoe \
    && make -j$(nproc) \
    && make install \
    && cd / \
    && rm -rf /tmp/tippecanoe

# Install uv
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Set default port
ENV PORT=8000

# Expose port
EXPOSE 8000

# Run the application using the dependencies baked into the image.
CMD ["sh", "-c", "uv run --no-sync uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
