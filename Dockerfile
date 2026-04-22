FROM python:3.11-slim-bookworm

# Dependencias del sistema
RUN apt-get update && apt-get install -y \
    xvfb \
    libfontconfig1 \
    libxrender1 \
    libxext6 \
    libx11-6 \
    libssl3 \
    fonts-liberation \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Instalar wkhtmltopdf desde GitHub releases (Debian 12 bookworm)
RUN wget -q https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6.1-3/wkhtmltox_0.12.6.1-3.bookworm_amd64.deb \
    && apt-get update && apt-get install -y ./wkhtmltox_0.12.6.1-3.bookworm_amd64.deb \
    && rm wkhtmltox_0.12.6.1-3.bookworm_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Wrapper con Xvfb para servidor sin pantalla
RUN printf '#!/bin/bash\nxvfb-run -a --server-args="-screen 0 1024x768x24" /usr/local/bin/wkhtmltopdf "$@"' \
    > /usr/local/bin/wkhtmltopdf-xvfb && \
    chmod +x /usr/local/bin/wkhtmltopdf-xvfb

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
