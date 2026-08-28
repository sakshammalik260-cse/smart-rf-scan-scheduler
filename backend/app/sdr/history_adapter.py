import json
from dataclasses import dataclass

import numpy as np

from app import config
from app.schemas.sdr import MockBand, ReceiverObservation
from app.services import inference_service


@dataclass
class AdapterState:
    decision_index: int
    elapsed_time_s: float
    previous_scan_was_hit: int
    previous_scan_band_id: int
    previous_scan_pulse_count: int


class ReceiverHistoryAdapter:
    """Translate receiver observations into the frozen V3 history contract."""

    def __init__(self, bands: list[MockBand], scenario_duration_s: float) -> None:
        if not bands:
            raise ValueError("At least one band is required")
        if scenario_duration_s <= 0:
            raise ValueError("Scenario duration must be greater than zero")
        self.bands = bands
        self.scenario_duration_s = scenario_duration_s
        self._metadata = json.loads(config.INFERENCE_METADATA_PATH.read_text(encoding="utf-8"))
        if len(bands) != int(self._metadata["receiver"]["band_count"]):
            raise ValueError("Mock band plan must contain exactly 36 candidates for the frozen model")
        self.histories = []
        self.recent_selected_bands: list[int] = []
        self.state = AdapterState(0, 0.0, -1, -1, 0)
        self.reset()

    def reset(self) -> None:
        self.histories = [inference_service.features.ObservableBandHistory(last_update_s=0.0) for _ in self.bands]
        self.recent_selected_bands = []
        self.state = AdapterState(0, 0.0, -1, -1, 0)

    def apply(self, observation: ReceiverObservation) -> None:
        if observation.band_id is None or not 0 <= observation.band_id < len(self.bands):
            raise ValueError("Observation must identify a valid band")
        if observation.timestamp_s < self.state.elapsed_time_s:
            raise ValueError("Observation timestamp cannot move backwards")
        expected_band = self.bands[observation.band_id]
        if not np.isclose(observation.center_frequency_hz, expected_band.center_frequency_hz):
            raise ValueError("Observation frequency does not match its band plan")
        if observation.pulse_count != len(observation.detected_events):
            raise ValueError("pulse_count must equal the number of detected events")
        hit = observation.activity_detected
        if hit != (observation.pulse_count > 0):
            raise ValueError("activity_detected must match pulse presence")
        memory_s = float(self._metadata["memory_s"])
        history = self.histories[observation.band_id]
        inference_service.features.update_observable_history(history, observation.timestamp_s, hit, observation.pulse_count, memory_s)
        self.recent_selected_bands.append(observation.band_id)
        self.state = AdapterState(
            decision_index=self.state.decision_index + 1,
            elapsed_time_s=observation.timestamp_s + observation.dwell_time_s,
            previous_scan_was_hit=1 if hit else 0,
            previous_scan_band_id=observation.band_id,
            previous_scan_pulse_count=observation.pulse_count,
        )

    def feature_matrix(self) -> np.ndarray:
        receiver = self._metadata["receiver"]
        receiver_plan = inference_service.tsrd.ReceiverPlan(
            centres_mhz=np.asarray([band.center_frequency_hz / 1e6 for band in self.bands], dtype=np.float64),
            dwell_times_s=np.asarray([band.dwell_time_s for band in self.bands], dtype=np.float64),
            bandwidth_mhz=float(self.bands[0].high_frequency_hz - self.bands[0].low_frequency_hz) / 1e6,
            source="mock_sdr_configured_plan",
        )
        scenario = inference_service.tsrd.ScenarioData(
            scenario_id="mock-sdr",
            file_path=config.PROJECT_ROOT,
            receiver_mode="Mock SDR",
            toa_s=np.empty(0, dtype=np.float64),
            frequency_mhz=np.empty(0, dtype=np.float64),
            emitter_id=np.empty(0, dtype=np.int32),
            band_id=np.empty(0, dtype=np.int16),
            receiver_plan=receiver_plan,
            start_s=0.0,
            end_s=self.scenario_duration_s,
            evaluation_slot_s=float(receiver["evaluation_slot_s"]),
        )
        sentinel_s = self.scenario_duration_s + float(np.sum(receiver_plan.dwell_times_s))
        matrix = inference_service.features.candidate_features(
            scenario,
            self.histories,
            self.state.elapsed_time_s,
            self.state.decision_index,
            self.state.previous_scan_was_hit,
            self.state.previous_scan_band_id,
            self.state.previous_scan_pulse_count,
            float(self._metadata["memory_s"]),
            float(self._metadata["short_window_s"]),
            sentinel_s,
        )
        expected_names = self._metadata["feature_names"]
        if expected_names != inference_service.features.FEATURE_NAMES:
            raise ValueError("Feature order does not match frozen inference metadata")
        if matrix.shape != (len(self.bands), int(self._metadata["feature_count"])):
            raise ValueError(f"Unexpected Mock SDR feature shape: {matrix.shape}")
        if not np.isfinite(matrix).all():
            raise ValueError("Mock SDR feature matrix contains NaN or Inf")
        return matrix