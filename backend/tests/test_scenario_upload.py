import hashlib
from io import BytesIO

import h5py
import numpy as np
import pytest

from app import config
from app.main import app
from app.services.scenario_validator import ScenarioValidationError, save_upload
from fastapi.testclient import TestClient


def h5_bytes(valid: bool = True, frequency_offset: float = 0.0, labels_shape: tuple[int, ...] = (2,), empty_dwell: bool = False, receiver_mode: str = "Stare") -> bytes:
    stream = BytesIO()
    with h5py.File(stream, "w") as handle:
        handle.create_dataset("data", data=np.array([[1.0, 100.0 + frequency_offset, 2.0, 10.0, 0.5], [2.0, 200.0 + frequency_offset, 3.0, 11.0, 0.7]]))
        labels = np.array(["emitter-a", "emitter-b"], dtype="S12")
        handle.create_dataset("labels", data=labels.reshape(labels_shape))
        metadata = handle.create_group("metadata")
        metadata.attrs["receiver_mode"] = receiver_mode
        metadata.create_dataset("feature_names", data=np.array(["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"] if valid else ["ToA", "Wrong", "PulseWidth", "AoA", "Amplitude"], dtype="S16"))
        receiver = metadata.create_group("receiver")
        receiver.attrs["scan_mode"] = receiver_mode
        receiver.create_dataset("dwell_centres_mhz", data=np.array([], dtype=float) if empty_dwell else np.arange(250.0, 18000.0, 500.0))
        receiver.create_dataset("dwell_times_s", data=np.array([], dtype=float) if empty_dwell else np.full(36, 0.05))
        if empty_dwell:
            receiver.create_dataset("freq_range_mhz", data=np.array([500.0, 18000.0]))
    return stream.getvalue()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_valid_stare_h5_upload(client: TestClient) -> None:
    content = h5_bytes()
    response = client.post("/api/scenarios/upload", files={"file": ("stare_config_101.h5", content, "application/x-hdf5")})
    body = response.json()
    assert response.status_code == 200
    assert body["valid"] is True
    assert body["receiver_mode"] == "Stare"
    assert body["pulse_count"] == 2
    assert body["unique_emitter_count"] == 2
    assert body["feature_names"] == ["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"]
    assert body["frequency_min"] == 100.0
    assert body["frequency_max"] == 200.0
    assert body["sha256"] == hashlib.sha256(content).hexdigest()
    assert body["duration_seconds"] == 0.000002
    assert body["receiver_plan"]["band_count"] == 36
    assert len(body["receiver_plan"]["centres_mhz"]) == 36
    assert len(body["receiver_plan"]["dwell_times_seconds"]) == 36


def test_accepts_column_vector_labels(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("column_labels.h5", h5_bytes(labels_shape=(2, 1)), "application/x-hdf5")})
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_accepts_stare_with_empty_dwell_arrays(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("empty_dwell.h5", h5_bytes(empty_dwell=True), "application/x-hdf5")})
    assert response.status_code == 200
    body = response.json()
    assert body["receiver_plan"]["band_count"] == 36
    assert body["receiver_plan"]["centres_mhz"] == list(np.arange(250.0, 18000.0, 500.0))
    assert body["receiver_plan"]["source"] == "frozen_default_tsr_scan_plan"


def test_rejects_empty_dwell_arrays_for_non_stare(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("bad_scan.h5", h5_bytes(empty_dwell=True, receiver_mode="Scanning"), "application/x-hdf5")})
    assert response.status_code == 400
    assert "only valid for Stare" in response.json()["detail"]


def test_rejects_multidimensional_labels(client: TestClient) -> None:
    response = client.post("/api/scenarios/upload", files={"file": ("bad_labels.h5", h5_bytes(labels_shape=(1, 2)), "application/x-hdf5")})
    assert response.status_code == 400
    assert "/labels must be a non-empty 1D dataset" in response.json()["detail"]


def test_each_upload_gets_unique_scenario_identity(client: TestClient) -> None:
    first = h5_bytes()
    second = h5_bytes(frequency_offset=1.0)
    first_response = client.post("/api/scenarios/upload", files={"file": ("config_1009.h5", first, "application/x-hdf5")})
    second_response = client.post("/api/scenarios/upload", files={"file": ("config_1015.h5", second, "application/x-hdf5")})
    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["scenario_id"] != second_response.json()["scenario_id"]
    assert first_response.json()["sha256"] != second_response.json()["sha256"]


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
