import pytest
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.sdr import DeviceCapabilities, MockBand, ReceiverObservation
from app.sdr.history_adapter import ReceiverHistoryAdapter
from app.sdr.manager import sdr_manager
from app.sdr.mock import MockSDRDevice
from app.sdr.validation import validate_band_plan


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
    assert device.set_bandwidth(100e6).bandwidth_hz == 100e6


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
    assert observation.capture_metadata is not None
    assert observation.capture_metadata.simulated is True
    assert observation.capture_metadata.tuning_latency_s == device.SIMULATED_TUNING_LATENCY_S
    assert observation.capture_metadata.settling_duration_s == device.SIMULATED_SETTLING_DURATION_S


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


def test_sdr_device_contract_is_receive_only() -> None:
    prohibited = {"transmit", "set_tx_gain", "send_waveform", "jam", "replay_transmission", "inject_rf"}
    assert prohibited.isdisjoint(set(dir(MockSDRDevice)))
    assert prohibited.isdisjoint(set(dir(sdr_manager)))


def test_mock_capabilities_describe_receive_only_simulation() -> None:
    device = MockSDRDevice()
    capabilities = device.capabilities()
    assert capabilities.device_id == "mock_sdr"
    assert capabilities.receive_supported is True
    assert capabilities.transmit_supported is False
    assert capabilities.simulated is True
    assert capabilities.min_frequency_hz == device.MIN_FREQUENCY_HZ
    assert capabilities.max_sample_rate_hz == device.MAX_SAMPLE_RATE_HZ


def test_device_registry_lists_unavailable_physical_drivers() -> None:
    devices = sdr_manager.devices()
    by_id = {device.device_id: device for device in devices}
    assert set(by_id) == {"mock_sdr", "rtl_sdr", "hackrf", "plutosdr"}
    assert by_id["mock_sdr"].driver_available is True
    for device_id in ("rtl_sdr", "hackrf", "plutosdr"):
        assert by_id[device_id].driver_available is False
        assert by_id[device_id].connected is False
        assert by_id[device_id].hardware_status == "driver_not_installed"
        assert "not installed" in by_id[device_id].message


def test_unavailable_physical_capabilities_do_not_fake_detection() -> None:
    capabilities = {item.device_id: item for item in sdr_manager.capabilities()}
    assert capabilities["rtl_sdr"].connected is False
    assert capabilities["rtl_sdr"].simulated is False
    assert capabilities["rtl_sdr"].min_frequency_hz is None
    assert capabilities["hackrf"].transmit_supported is True
    assert any("informational only" in warning for warning in capabilities["hackrf"].warnings)


def test_valid_mock_band_plan_is_compatible() -> None:
    report = sdr_manager.validate_band_plan("mock_sdr")
    assert report.compatible is True
    assert report.usable_band_count == 36
    assert report.rejected_bands == []
    assert report.requested_frequency_coverage_hz.max_frequency_hz == 5.5e9


def test_out_of_range_band_is_rejected() -> None:
    bands = MockSDRDevice.default_band_plan()
    bands[0] = MockBand(band_id=0, low_frequency_hz=6.1e9, high_frequency_hz=6.2e9, center_frequency_hz=6.15e9, bandwidth_hz=100e6, dwell_time_s=0.1)
    report = sdr_manager.validate_band_plan("mock_sdr", bands=bands)
    assert report.compatible is False
    assert report.rejected_bands[0].band_id == 0
    assert any("outside the device range" in reason for reason in report.rejected_bands[0].reasons)


def test_invalid_bandwidth_and_dwell_are_rejected_by_validator() -> None:
    capabilities = DeviceCapabilities(
        device_id="test",
        device_name="Test RX",
        driver_name="test",
        connected=True,
        simulated=False,
        receive_supported=True,
        transmit_supported=False,
        min_frequency_hz=100e6,
        max_frequency_hz=200e6,
        max_bandwidth_hz=5e6,
    )
    band = MockBand.model_construct(
        band_id=0,
        low_frequency_hz=110e6,
        high_frequency_hz=120e6,
        center_frequency_hz=115e6,
        bandwidth_hz=10e6,
        dwell_time_s=0.0,
        enabled=True,
    )
    report = validate_band_plan(capabilities, [band], sample_rate_hz=2e6, bandwidth_hz=10e6)
    assert report.compatible is False
    assert "Requested bandwidth is above the device maximum." in report.errors
    assert any("bandwidth exceeds" in reason.lower() for reason in report.rejected_bands[0].reasons)
    assert any("dwell time" in reason.lower() for reason in report.rejected_bands[0].reasons)


def test_overlapping_bands_are_rejected() -> None:
    bands = [
        MockBand(band_id=0, low_frequency_hz=100e6, high_frequency_hz=200e6, center_frequency_hz=150e6, bandwidth_hz=50e6, dwell_time_s=0.1),
        MockBand(band_id=1, low_frequency_hz=150e6, high_frequency_hz=250e6, center_frequency_hz=220e6, bandwidth_hz=50e6, dwell_time_s=0.1),
    ]
    report = sdr_manager.validate_band_plan("mock_sdr", bands=bands)
    assert report.compatible is False
    assert any("overlap" in error for error in report.errors)


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


def test_sdr_hardware_readiness_api_routes(client: TestClient) -> None:
    devices = client.get("/api/sdr/devices")
    capabilities = client.get("/api/sdr/capabilities")
    band_plan = client.get("/api/sdr/band-plan")
    validation = client.post("/api/sdr/band-plan/validate", json={"device_id": "mock_sdr"})
    assert devices.status_code == 200
    assert capabilities.status_code == 200
    assert band_plan.status_code == 200
    assert validation.status_code == 200
    assert {device["device_id"] for device in devices.json()["devices"]} == {"mock_sdr", "rtl_sdr", "hackrf", "plutosdr"}
    assert all(device["connected"] is False for device in devices.json()["devices"] if device["device_id"] != "mock_sdr")
    assert band_plan.json()["simulated"] is True
    assert validation.json()["compatible"] is True


def test_sdr_api_validation_rejects_impossible_band(client: TestClient) -> None:
    response = client.post(
        "/api/sdr/band-plan/validate",
        json={
            "device_id": "mock_sdr",
            "bands": [
                {
                    "band_id": 0,
                    "low_frequency_hz": 6.1e9,
                    "high_frequency_hz": 6.2e9,
                    "center_frequency_hz": 6.15e9,
                    "bandwidth_hz": 100e6,
                    "dwell_time_s": 0.1,
                    "enabled": True,
                }
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["compatible"] is False
    assert response.json()["rejected_bands"][0]["band_id"] == 0


def test_sdr_api_driver_error_mapping(client: TestClient) -> None:
    client.post("/api/sdr/disconnect")
    response = client.post("/api/sdr/tune", json={"frequency_hz": 1e9})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "DEVICE_DISCONNECTED"


def test_sdr_api_controls_and_capture(client: TestClient) -> None:
    assert client.post("/api/sdr/connect").status_code == 200
    assert client.post("/api/sdr/tune", json={"frequency_hz": 1.2e9}).json()["center_frequency_hz"] == 1.2e9
    assert client.post("/api/sdr/sample-rate", json={"sample_rate_hz": 4e6}).json()["sample_rate_hz"] == 4e6
    capture = client.post("/api/sdr/capture", json={"duration_s": 0.1})
    assert capture.status_code == 200
    assert capture.json()["simulated"] is True
    assert client.post("/api/sdr/tune", json={"frequency_hz": 7e9}).status_code == 422
    assert client.post("/api/sdr/disconnect").json()["connected"] is False
