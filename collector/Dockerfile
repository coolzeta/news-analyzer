FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

ENV MAIN_SERVICE_URL=http://main-service:8000
ENV CHROMA_PERSIST_DIR=/app/data/chroma
ENV FAILED_ARTICLES_FILE=/app/data/failed_articles.json
ENV LOG_FILE=/app/data/collector.log
ENV LOG_LEVEL=INFO
ENV LOG_FORMAT=json

CMD ["python", "main.py", "--daemon"]
