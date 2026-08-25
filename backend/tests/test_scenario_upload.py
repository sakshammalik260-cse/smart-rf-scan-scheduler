from io import BytesIO

import h5py
import numpy as np
import pytest

from app import config
from app.main import app
from app.services.scenario_validator import ScenarioValidationError, save_upload
from fastapi.testclient import TestClient


def h5_bytes(valid: bool = True) -> bytes:
    stream = BytesIO()
    with h5py.File(stream, "w") as handle:
        handle.create_dataset("data", data=np.array([[1.0, 100.0, 2.0, 10.0, 0.5], [2.0, 200.0, 3.0, 11.0, 0.7]]))
        handle.create_dataset("labels", data=np.array(["emitter-a", "emitter-b"], dtype="S12"))
        metadata = handle.create_group("metadata")
        metadata.attrs["receiver_mode"] = "Stare"
        metadata.create_dataset("feature_names", data=np.array(["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"] if valid else ["ToA", "Wrong", "PulseWidth", "AoA", "Amplitude"], dtype="S16"))
    return stream.getvalue()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_valid_stare_h5_upload(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("stare_config_101.h5", h5_bytes(), "application/x-hdf5")})
    body = response.json()
    assert response.status_code == 200
    assert body["valid"] is True
    assert body["receiver_mode"] == "Stare"
    assert body["pulse_count"] == 2
    assert body["unique_emitter_count"] == 2
    assert body["feature_names"] == ["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"]
    assert body["frequency_min"] == 100.0
    assert body["frequency_max"] == 200.0


def test_rejects_non_h5(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("scenario.txt", b"not h5", "text/plain")})
    assert response.status_code == 400
    assert "Only .h5" in response.json()["detail"]


def test_rejects_incompatible_feature_names(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("bad.h5", h5_bytes(False), "application/x-hdf5")})
    assert response.status_code == 400
    assert "Incompatible feature names" in response.json()["detail"]


def test_upload_size_limit(tmp_path) -> None:
    oversized = BytesIO(b"x" * (config.MAX_UPLOAD_SIZE_BYTES + 1))
    with pytest.raises(ScenarioValidationError, match="exceeds"):
        save_upload(oversized, "large.h5")