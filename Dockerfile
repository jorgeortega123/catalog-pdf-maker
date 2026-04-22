FROM python:3.11-slim

# Instalar wkhtmltopdf y dependencias del sistema
RUN apt-get update && apt-get install -y \
    wkhtmltopdf \
    xvfb \
    libfontconfig1 \
    libxrender1 \
    libxext6 \
    libx11-6 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Wrapper para wkhtmltopdf con Xvfb (necesario en servidor sin pantalla)
RUN echo '#!/bin/bash\nxvfb-run -a --server-args="-screen 0 1024x768x24" /usr/bin/wkhtmltopdf "$@"' \
    > /usr/local/bin/wkhtmltopdf-xvfb && \
    chmod +x /usr/local/bin/wkhtmltopdf-xvfb

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
