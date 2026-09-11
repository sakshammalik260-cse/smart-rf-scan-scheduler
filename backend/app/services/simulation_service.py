import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app import config
from app.schemas.prediction import DecisionBand
from app.schemas.simulation import ScanHistoryItem, SimulationStateResponse
from app.services import inference_service
from app.services.model_loader import model_loader
from app.services.scenario_validator import get_scenario_path


@dataclass
class SimulationSession:
    simulation_id: str
    scenario_id: str
    scheduler_name: str
    scenario: object
    indexes: list[dict]
    histories: list
    params: object | None
    memory_s: float
    short_window_s: float
    sentinel_s: float
    current_time_s: float
    status: str = "running"
    selected_band: int | None = None
    decision_count: int = 0
    recent_selected_bands: list[int] = field(default_factory=list)
    previous_scan_was_hit: int = -1
    previous_scan_band_id: int = -1
    previous_scan_pulse_count: int = 0
    scan_history: list[ScanHistoryItem] = field(default_factory=list)
    latest_probabilities: np.ndarray = field(default_factory=lambda: np.zeros(36, dtype=float))
    latest_scores: np.ndarray = field(default_factory=lambda: np.zeros(36, dtype=float))

    def _band_response(self, band_id: int) -> DecisionBand:
        return DecisionBand(
            band_id=int(band_id),
            frequency_start_mhz=float(self.scenario.receiver_plan.lows_mhz[band_id]),
            frequency_end_mhz=float(self.scenario.receiver_plan.highs_mhz[band_id]),
            rf_probability=float(self.latest_probabilities[band_id]),
            v3_score=float(self.latest_scores[band_id]),
        )

    def state_response(self) -> SimulationStateResponse:
        duration = max(float(self.scenario.end_s - self.scenario.start_s), 1e-9)
        top_order = np.argsort(-self.latest_scores, kind="stable")[:5]
        top_candidates = [self._band_response(int(band)) for band in top_order] if self.decision_count else []
        progress_fraction = min(max(float((self.current_time_s - self.scenario.start_s) / duration), 0.0), 1.0)
        visit_counts = {str(index): int(history.visits) for index, history in enumerate(self.histories)}
        return SimulationStateResponse(
            simulation_id=self.simulation_id,
            scenario_id=self.scenario_id,
            scheduler=self.scheduler_name,
            status=self.status,
            current_simulation_time_seconds=float(self.current_time_s),
            scenario_duration_seconds=duration,
            selected_band=self.selected_band,
            selected_band_details=self._band_response(self.selected_band) if self.selected_band is not None else None,
            last_outcome=self.scan_history[-1].outcome if self.scan_history else None,
            decision_count=self.decision_count,
            scan_history=self.scan_history,
            recent_decisions=self.scan_history[-10:],
            hit_miss_history=[item.outcome for item in self.scan_history],
            per_band_visit_counts=visit_counts,
            band_visit_counts=visit_counts,
            last_visit_times_seconds={str(index): history.last_visit_s for index, history in enumerate(self.histories)},
            last_hit_times_seconds={str(index): history.last_hit_s for index, history in enumerate(self.histories)},
            latest_rf_probabilities=[float(value) for value in self.latest_probabilities],
            latest_v3_scores=[float(value) for value in self.latest_scores],
            top_candidates=top_candidates,
            progress_fraction=progress_fraction,
            progress_percent=progress_fraction * 100.0,
        )

    def _smart_v3_decision(self) -> tuple[int, float]:
        metadata = json.loads(config.INFERENCE_METADATA_PATH.read_text(encoding="utf-8"))
        matrix = inference_service.features.candidate_features(self.scenario, self.histories, self.current_time_s, self.decision_count, self.previous_scan_was_hit, self.previous_scan_band_id, self.previous_scan_pulse_count, float(metadata["memory_s"]), float(metadata["short_window_s"]), self.sentinel_s)
        expected_shape = (int(metadata["receiver"]["band_count"]), int(metadata["feature_count"]))
        if matrix.shape != expected_shape or not np.isfinite(matrix).all():
            raise ValueError(f"Unexpected feature matrix shape: {matrix.shape}")
        if metadata["feature_names"] != inference_service.features.FEATURE_NAMES:
            raise ValueError("Feature order does not match frozen inference metadata")
        model_state = model_loader.load_once()
        if model_state.model is None:
            raise RuntimeError(model_state.error or "Frozen model is not loaded")
        probabilities = np.round(np.asarray(model_state.model.predict_proba(matrix)[:, 1], dtype=float), decimals=10)
        if self.params is None:
            raise ValueError("Smart V3 parameters are not loaded")
        selected, terms, _ = inference_service.scheduler.choose_v3_band(probabilities, self.histories, self.current_time_s, self.recent_selected_bands, self.params)
        self.latest_probabilities = probabilities
        self.latest_scores = np.asarray(terms["scores"], dtype=float)
        return selected, float(terms["scores"][selected])

    def _sequential_decision(self) -> tuple[int, float]:
        band_count = int(self.scenario.receiver_plan.band_count)
        selected = int(self.decision_count % band_count)
        self.latest_probabilities = np.zeros(band_count, dtype=float)
        self.latest_scores = np.zeros(band_count, dtype=float)
        return selected, 0.0

    def step(self) -> SimulationStateResponse:
        if self.status == "paused":
            raise ValueError("Simulation is paused")
        if self.status == "completed":
            raise ValueError("Simulation is already completed")
        if self.scheduler_name == "smart_v3":
            selected, score = self._smart_v3_decision()
        elif self.scheduler_name == "sequential":
            selected, score = self._sequential_decision()
        else:
            raise ValueError(f"Unsupported scheduler: {self.scheduler_name}")
        dwell = float(self.scenario.receiver_plan.dwell_times_s[selected])
        end_time = min(self.current_time_s + dwell, self.scenario.end_s)
        observed = inference_service.tsrd.observe_band(self.indexes, selected, self.current_time_s, end_time)
        hit = bool(observed["hit"])
        self.selected_band = selected
        self.scan_history.append(ScanHistoryItem(decision_number=self.decision_count, simulation_time_seconds=float(self.current_time_s), dwell_duration_seconds=float(end_time - self.current_time_s), band_id=selected, frequency_start_mhz=float(self.scenario.receiver_plan.lows_mhz[selected]), frequency_end_mhz=float(self.scenario.receiver_plan.highs_mhz[selected]), outcome="HIT" if hit else "MISS", pulse_count_observed=int(observed["pulse_count"]), rf_probability=float(self.latest_probabilities[selected]), v3_score=score))
        inference_service.features.update_observable_history(self.histories[selected], self.current_time_s, hit, int(observed["pulse_count"]), float(self.memory_s))
        self.recent_selected_bands.append(selected)
        self.previous_scan_was_hit = 1 if hit else 0
        self.previous_scan_band_id = selected
        self.previous_scan_pulse_count = int(observed["pulse_count"])
        self.current_time_s = end_time
        self.decision_count += 1
        if self.current_time_s >= self.scenario.end_s - 1e-12:
            self.status = "completed"
        return self.state_response()


_sessions: dict[str, SimulationSession] = {}


def start_simulation(scenario_id: str, scheduler_name: str = "smart_v3") -> SimulationStateResponse:
    if scheduler_name not in {"smart_v3", "sequential"}:
        raise ValueError("scheduler must be 'smart_v3' or 'sequential'")
    path = get_scenario_path(scenario_id)
    if path is None or not path.is_file():
        raise LookupError("Scenario not found or upload has expired")
    metadata = json.loads(config.INFERENCE_METADATA_PATH.read_text(encoding="utf-8"))
    scenario = inference_service._load_scenario(path, scenario_id)
    params = None
    if scheduler_name == "smart_v3":
        parameters = json.loads(config.V3_PARAMETERS_PATH.read_text(encoding="utf-8"))
        if parameters.get("candidate_id") != 17:
            raise ValueError("Loaded V3 configuration is not Candidate 17")
        params = inference_service.scheduler.V3Params(**parameters["parameters"])
    session = SimulationSession(simulation_id=uuid.uuid4().hex, scenario_id=scenario_id, scheduler_name=scheduler_name, scenario=scenario, indexes=inference_service.tsrd.build_band_indexes(scenario), histories=[inference_service.features.ObservableBandHistory(last_update_s=scenario.start_s) for _ in range(36)], params=params, memory_s=float(metadata["memory_s"]), short_window_s=float(metadata["short_window_s"]), sentinel_s=float(scenario.end_s - scenario.start_s + np.sum(scenario.receiver_plan.dwell_times_s)), current_time_s=float(scenario.start_s))
    _sessions[session.simulation_id] = session
    return session.state_response()


def get_session(simulation_id: str) -> SimulationSession:
    session = _sessions.get(simulation_id)
    if session is None:
        raise LookupError("Simulation not found")
    return session


def pause_simulation(simulation_id: str) -> SimulationStateResponse:
    session = get_session(simulation_id)
    if session.status == "running":
        session.status = "paused"
    return session.state_response()


def reset_simulation(simulation_id: str) -> SimulationStateResponse:
    session = get_session(simulation_id)
    metadata = json.loads(config.INFERENCE_METADATA_PATH.read_text(encoding="utf-8"))
    session.histories = [inference_service.features.ObservableBandHistory(last_update_s=session.scenario.start_s) for _ in range(36)]
    session.current_time_s = float(session.scenario.start_s)
    session.status = "running"
    session.selected_band = None
    session.decision_count = 0
    session.recent_selected_bands.clear()
    session.previous_scan_was_hit = -1
    session.previous_scan_band_id = -1
    session.previous_scan_pulse_count = 0
    session.scan_history.clear()
    session.latest_probabilities = np.zeros(36, dtype=float)
    session.latest_scores = np.zeros(36, dtype=float)
    session.memory_s = float(metadata["memory_s"])
    session.short_window_s = float(metadata["short_window_s"])
    if session.scheduler_name == "smart_v3":
        parameters = json.loads(config.V3_PARAMETERS_PATH.read_text(encoding="utf-8"))
        session.params = inference_service.scheduler.V3Params(**parameters["parameters"])
    else:
        session.params = None
    return session.state_response()
