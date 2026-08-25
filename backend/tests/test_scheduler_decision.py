import hashlib
import json

import numpy as np
from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.services.inference_service import scheduler
from app.services.inference_service import predict_scheduler_decision
from test_scheduler_predict import prediction_bytes, upload


def test_candidate_17_parameters_match_frozen_config() -> None:
    configured = json.loads(config.V3_PARAMETERS_PATH.read_text(encoding="utf-8"))
    params = scheduler.V3Params(**configured["parameters"])
    assert configured["candidate_id"] == 17
    assert vars(params) == configured["parameters"]


def test_decision_selects_one_highest_scored_band_and_scores_all_36() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "decision.h5")
        response = client.post("/api/scheduler/decision", json={"scenario_id": scenario_id, "decision_time_seconds": 0.0})
    body = response.json()
    assert response.status_code == 200
    assert body["scheduler"] == "Smart V3 Candidate 17"
    assert body["candidate_count"] == 36
    assert len(body["top_candidates"]) == 5
    assert body["selected_band"]["band_id"] == body["top_candidates"][0]["band_id"]
    assert body["selected_band"]["v3_score"] == max(candidate["v3_score"] for candidate in body["top_candidates"])
    components = body["decision_components"]
    assert abs(body["selected_band"]["v3_score"] - sum(components.values())) < 1e-9


def test_decision_is_deterministic_and_finite() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "repeat-decision.h5")
    first = predict_scheduler_decision(scenario_id, 0.2)
    second = predict_scheduler_decision(scenario_id, 0.2)
    assert first == second
    values = [first.selected_band.rf_probability, first.selected_band.v3_score] + [candidate.rf_probability for candidate in first.top_candidates] + [candidate.v3_score for candidate in first.top_candidates]
    assert np.isfinite(values).all()
    assert all(0.0 <= candidate.rf_probability <= 1.0 for candidate in first.top_candidates)


def test_future_activity_does_not_change_candidate_17_decision() -> None:
    with TestClient(app) as client:
        before_id = upload(client, prediction_bytes(750.0, 1), "decision-future-a.h5")
        changed_id = upload(client, prediction_bytes(17_750.0, 99), "decision-future-b.h5")
    before = predict_scheduler_decision(before_id, 0.2)
    changed = predict_scheduler_decision(changed_id, 0.2)
    assert before.selected_band == changed.selected_band
    assert before.decision_components == changed.decision_components
    assert [(candidate.band_id, candidate.v3_score, candidate.rf_probability) for candidate in before.top_candidates] == [(candidate.band_id, candidate.v3_score, candidate.rf_probability) for candidate in changed.top_candidates]


def test_frozen_hashes_match_approved_values() -> None:
    digest = hashlib.sha256(config.MODEL_PATH.read_bytes()).hexdigest()
    assert digest == config.EXPECTED_MODEL_SHA256
    assert json.loads(config.INFERENCE_METADATA_PATH.read_text(encoding="utf-8"))["model_sha256"] == digest
    assert config.V3_PARAMETERS_PATH.is_file()