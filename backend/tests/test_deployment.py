from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app
from app.services.model_loader import FrozenModel, model_loader
from app.web import mount_frontend


def test_readiness_requires_a_verified_loaded_model(monkeypatch):
    with TestClient(app) as client:
        assert client.get("/api/ready").status_code == 200
        monkeypatch.setattr(model_loader, "_frozen_model", FrozenModel(None, {}, {}, None, "failed", "test failure"))
        response = client.get("/api/ready")
        assert response.status_code == 503
        assert response.json()["detail"] == "Frozen model is not ready"


def test_static_frontend_preserves_api_routes_and_does_not_expose_model(tmp_path):
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text('<html><div id="root"></div></html>')
    (frontend / "assets").mkdir()
    (frontend / "assets" / "app.js").write_text('console.log("ready")')
    (tmp_path / "random_forest.joblib").write_text("private artifact")
    application = FastAPI()

    @application.get("/api/health")
    def health():
        return {"status": "ok"}

    mount_frontend(application, frontend)
    with TestClient(application) as client:
        assert 'id="root"' in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/missing").status_code == 404
        assert client.get("/models/random_forest.joblib").status_code == 404
        assert client.get("/%2e%2e/random_forest.joblib").status_code == 404


def test_backend_can_run_without_frontend_build(tmp_path):
    application = FastAPI()
    mount_frontend(application, tmp_path / "missing")
    with TestClient(application) as client:
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/").status_code == 404
