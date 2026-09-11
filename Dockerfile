FROM node:24-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_USE_MOCK_API=false VITE_API_BASE_URL=/api
RUN npm run build

FROM python:3.14-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
WORKDIR /app
COPY backend/requirements-production.txt /app/backend/requirements-production.txt
RUN pip install --no-cache-dir -r backend/requirements-production.txt
COPY backend/app/ /app/backend/app/
COPY src/ /app/src/
COPY config/ /app/config/
COPY models/random_forest.joblib /app/models/random_forest.joblib
COPY --from=frontend-build /build/frontend/dist/ /app/frontend/dist/
RUN python -c "from app.services.model_loader import model_loader; state = model_loader.load_once(); assert state.loaded and state.verification_status == 'verified', state.error" \
    && useradd --create-home --uid 10001 smart
USER smart
EXPOSE 10000
# Uploads and simulation sessions are process-local, so run exactly one worker.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
