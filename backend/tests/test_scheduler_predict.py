from io import BytesIO

import h5py
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.inference_service import build_historical_feature_matrix, predict_scenario
from app.services.scenario_validator import get_scenario_path


def prediction_bytes(future_frequency: float, future_label: int) -> bytes:
    stream = BytesIO()
    with h5py.File(stream, "w") as handle:
        handle.create_dataset("data", data=np.array([
            [1_000_000.0, 250.0, 2.0, 10.0, 0.5],
            [1_100_000.0, 750.0, 2.0, 10.0, 0.5],
            [2_000_000.0, future_frequency, 2.0, 10.0, 0.5],
        ]))
        handle.create_dataset("labels", data=np.array([0, 1, future_label], dtype=np.int32))
        metadata = handle.create_group("metadata")
        metadata.attrs["receiver_mode"] = "Stare"
        metadata.create_dataset("feature_names", data=np.array(["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"], dtype="S16"))
        receiver = metadata.create_group("receiver")
        receiver.attrs["scan_mode"] = "Stare"
        receiver.create_dataset("dwell_centres_mhz", data=np.arange(250.0, 18000.0, 500.0))
        receiver.create_dataset("dwell_times_s", data=np.full(36, 0.05))
    return stream.getvalue()


def upload(client: TestClient, content: bytes, filename: str) -> str:
    response = client.post("/api/scenarios/upload", files={"file": (filename, content, "application/x-hdf5")})
    assert response.status_code == 200, response.text
    return response.json()["scenario_id"]


def test_prediction_scores_all_bands_with_exact_shape_and_order() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "predictable.h5")
        response = client.post("/api/scheduler/predict", json={"scenario_id": scenario_id, "decision_time_seconds": 0.2})
    body = response.json()
    assert response.status_code == 200
    assert body["feature_count"] == 30
    assert body["candidate_count"] == 36
    assert len(body["bands"]) == 36
    assert [band["rank"] for band in body["bands"]] == list(range(1, 37))
    assert all(0.0 <= band["activity_probability"] <= 1.0 for band in body["bands"])


def test_feature_matrix_matches_frozen_metadata_and_is_deterministic() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "deterministic.h5")
    path = get_scenario_path(scenario_id)
    assert path is not None
    first = build_historical_feature_matrix(path, scenario_id, 0.2)
    second = build_historical_feature_matrix(path, scenario_id, 0.2)
    assert first.shape == (36, 30)
    assert np.isfinite(first).all()
    assert np.array_equal(first, second)
    response_one, _ = predict_scenario(scenario_id, 0.2)
    response_two, _ = predict_scenario(scenario_id, 0.2)
    assert response_one == response_two


def test_future_activity_cannot_change_features_or_probabilities() -> None:
    with TestClient(app) as client:
        before_id = upload(client, prediction_bytes(750.0, 1), "future-a.h5")
        changed_id = upload(client, prediction_bytes(17_750.0, 99), "future-b.h5")
    before_path = get_scenario_path(before_id)
    changed_path = get_scenario_path(changed_id)
    assert before_path is not None and changed_path is not None
    before_matrix = build_historical_feature_matrix(before_path, before_id, 0.2)
    changed_matrix = build_historical_feature_matrix(changed_path, changed_id, 0.2)
    assert np.array_equal(before_matrix, changed_matrix)
    before_response, _ = predict_scenario(before_id, 0.2)
    changed_response, _ = predict_scenario(changed_id, 0.2)
    assert [band.activity_probability for band in before_response.bands] == [band.activity_probability for band in changed_response.bands]


def test_prediction_rejects_decision_after_scenario() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "duration.h5")
        response = client.post("/api/scheduler/predict", json={"scenario_id": scenario_id, "decision_time_seconds": 2.1})
    assert response.status_code == 422