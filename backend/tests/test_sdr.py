import pytest
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.sdr import ReceiverObservation
from app.sdr.history_adapter import ReceiverHistoryAdapter
from app.sdr.mock import MockSDRDevice


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_mock_connect_disconnect() -> None:
    device = MockSDRDevice()
    assert device.status().connected is False
    assert device.connect().connected is True
    assert device.disconnect().connected is False


def test_mock_tuning_and_sample_rate() -> None:
    device = MockSDRDevice()
    device.connect()
    assert device.tune(1e9).center_frequency_hz == 1e9
    assert device.set_sample_rate(4e6).sample_rate_hz == 4e6


def test_mock_rejects_invalid_tuning_frequency() -> None:
    device = MockSDRDevice()
    device.connect()
    with pytest.raises(ValueError, match="outside"):
        device.tune(7e9)


def test_mock_capture_reports_simulated_observation() -> None:
    device = MockSDRDevice()
    device.connect()
    observation = device.capture(0.25)
    assert observation.simulated is True
    assert observation.capture_duration_s == 0.25
    assert observation.device_name.startswith("Mock SDR")
    assert observation.observed_power_dbm > observation.estimated_noise_floor_dbm
    assert isinstance(observation.activity_detected, bool)


def test_mock_events_are_deterministic_and_consistent() -> None:
    first = MockSDRDevice()
    second = MockSDRDevice()
    first.connect()
    second.connect()
    first.tune(1.0e9)
    second.tune(1.0e9)
    first_observation = first.capture(0.25)
    second_observation = second.capture(0.25)
    assert first_observation == second_observation
    assert first_observation.pulse_count == len(first_observation.detected_events)
    assert first_observation.activity_detected is (first_observation.pulse_count > 0)
    assert first_observation.simulated is True


def test_receiver_observation_validation_rejects_invalid_event_count() -> None:
    device = MockSDRDevice()
    device.connect()
    observation = device.capture(0.25)
    payload = observation.model_dump()
    payload["band_id"] = 0
    payload["pulse_count"] += 1
    with pytest.raises(ValueError):
        ReceiverObservation.model_validate(payload)


def test_history_adapter_updates_previous_state_and_exact_features() -> None:
    device = MockSDRDevice()
    device.connect()
    bands = device.default_band_plan()
    adapter = ReceiverHistoryAdapter(bands, 10.0)
    band = bands[0]
    device.tune(band.center_frequency_hz)
    observation = device.capture(band.dwell_time_s).model_copy(update={"band_id": 0, "timestamp_s": 0.0, "bandwidth_hz": band.high_frequency_hz - band.low_frequency_hz})
    adapter.apply(ReceiverObservation.model_validate(observation.model_dump()))
    matrix = adapter.feature_matrix()
    history = adapter.histories[0]
    assert matrix.shape == (36, 30)
    assert matrix.dtype.name == "float32"
    assert np.isfinite(matrix).all()
    assert history.visits == 1
    assert history.hits == (1 if observation.pulse_count > 0 else 0)
    assert adapter.state.previous_scan_band_id == 0
    assert adapter.state.previous_scan_pulse_count == observation.pulse_count
    assert matrix[0, 27] == float(adapter.state.previous_scan_was_hit)
    assert matrix[0, 29] == float(observation.pulse_count)


def test_history_adapter_tracks_misses_and_repeated_visits() -> None:
    device = MockSDRDevice()
    device.connect()
    bands = device.default_band_plan()
    adapter = ReceiverHistoryAdapter(bands, 10.0)
    band = bands[19]
    device.tune(band.center_frequency_hz)
    first = device.capture(band.dwell_time_s).model_copy(update={"band_id": 19, "timestamp_s": 0.0, "bandwidth_hz": band.high_frequency_hz - band.low_frequency_hz})
    second = device.capture(band.dwell_time_s).model_copy(update={"band_id": 19, "timestamp_s": band.dwell_time_s, "bandwidth_hz": band.high_frequency_hz - band.low_frequency_hz})
    adapter.apply(ReceiverObservation.model_validate(first.model_dump()))
    adapter.apply(ReceiverObservation.model_validate(second.model_dump()))
    history = adapter.histories[19]
    assert first.pulse_count == 0
    assert history.visits == 2
    assert history.misses == 2
    assert history.consecutive_misses == 2
    assert adapter.state.previous_scan_band_id == 19
    assert adapter.state.previous_scan_was_hit == 0
    assert adapter.state.previous_scan_pulse_count == 0


def test_mock_smart_api_closed_loop_steps_and_reset(client: TestClient) -> None:
    start = client.post("/api/sdr/smart/start", json={"scenario_duration_s": 1.0})
    assert start.status_code == 200
    assert start.json()["input_mode"] == "mock_sdr"
    assert start.json()["simulated"] is True
    first = client.post("/api/sdr/smart/step")
    second = client.post("/api/sdr/smart/step")
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["decision_index"] == 2
    assert second.json()["last_decision"]["selected_band"]["band_id"] >= 0
    assert second.json()["last_decision"]["pulse_count"] >= 0
    assert second.json()["last_decision"]["outcome"] in {"HIT", "MISS"}
    reset = client.post("/api/sdr/smart/reset")
    assert reset.status_code == 200
    assert reset.json()["status"] == "idle"
    assert reset.json()["decision_index"] == 0


def test_sdr_api_status_and_modes(client: TestClient) -> None:
    modes_response = client.get("/api/sdr/modes")
    status_response = client.get("/api/sdr/status")
    assert modes_response.status_code == 200
    assert [mode["id"] for mode in modes_response.json()["modes"]] == ["tsrd_replay", "mock_sdr", "live_sdr"]
    assert status_response.status_code == 200
    assert status_response.json()["simulated"] is True


def test_sdr_api_controls_and_capture(client: TestClient) -> None:
    assert client.post("/api/sdr/connect").status_code == 200
    assert client.post("/api/sdr/tune", json={"frequency_hz": 1.2e9}).json()["center_frequency_hz"] == 1.2e9
    assert client.post("/api/sdr/sample-rate", json={"sample_rate_hz": 4e6}).json()["sample_rate_hz"] == 4e6
    capture = client.post("/api/sdr/capture", json={"duration_s": 0.1})
    assert capture.status_code == 200
    assert capture.json()["simulated"] is True
    assert client.post("/api/sdr/tune", json={"frequency_hz": 7e9}).status_code == 422
    assert client.post("/api/sdr/disconnect").json()["connected"] is False