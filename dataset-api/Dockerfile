FROM python:3.12-slim

# Install uv
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Make baked dependencies available to direct python/uvicorn commands.
ENV PATH="/app/.venv/bin:${PATH}"

# Copy application code
COPY . .

# Set default port
ENV PORT=8000

# Expose port
EXPOSE 8000

# Run the application using the dependencies baked into the image.
CMD ["sh", "-c", "uv run --no-sync uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
