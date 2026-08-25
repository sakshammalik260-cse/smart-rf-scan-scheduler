import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["model_loaded"] is True


def test_model_status_endpoint(client: TestClient) -> None:
    response = client.get("/api/model/status")
    body = response.json()
    assert response.status_code == 200
    assert body["verification_status"] == "verified"
    assert body["frozen"] is True
    assert body["feature_count"] == 30
    assert body["candidate_number"] == 17
