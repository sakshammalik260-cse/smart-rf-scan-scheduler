import json
import sys
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from app import config
from app.schemas.prediction import BandProbability, SchedulerDecisionResponse, DecisionBand, DecisionComponents, SchedulerPredictResponse
from app.services.model_loader import FrozenModel, model_loader
from app.services.scenario_validator import get_scenario_path

SRC_DIR = config.PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import preprocessing as tsrd  # noqa: E402

sys.modules["multi_scenario_pipeline"] = tsrd
import feature_generator as features  # noqa: E402
sys.modules["generate_ml_dataset_v2"] = features
import inference_metrics  # noqa: E402
sys.modules["train_and_evaluate_v2"] = inference_metrics
import smart_scheduler_v3 as scheduler  # noqa: E402


@dataclass
class HistoricalDecisionState:
    scenario: object
    histories: list
    recent_selected_bands: list[int]
    decision_index: int
    previous_scan_was_hit: int
    previous_scan_band_id: int
    previous_scan_pulse_count: int
    sentinel_s: float


def _frozen_metadata() -> dict:
    with config.INFERENCE_METADATA_PATH.open(encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def _load_scenario(path: Path, scenario_id: str):
    metadata = _frozen_metadata()
    receiver = metadata["receiver"]
    scenario = tsrd.load_scenario(path, float(receiver["instantaneous_bandwidth_mhz"]), float(receiver["evaluation_slot_s"]), None)
    if scenario.receiver_mode != "Stare":
        raise ValueError(f"Expected a compatible Stare scenario, found {scenario.receiver_mode!r}")
    if scenario.receiver_plan.band_count != int(receiver["band_count"]):
        raise ValueError("Scenario receiver layout does not have the expected 36 bands")
    return replace(scenario, scenario_id=scenario_id)


def build_historical_state(path: Path, scenario_id: str, decision_time_seconds: float) -> HistoricalDecisionState:
    metadata = _frozen_metadata()
    scenario = _load_scenario(path, scenario_id)
    if decision_time_seconds > scenario.end_s + 1e-12:
        raise ValueError("decision_time_seconds is beyond the scenario duration")
    indexes = tsrd.build_band_indexes(scenario)
    histories = [features.ObservableBandHistory(last_update_s=scenario.start_s) for _ in range(scenario.receiver_plan.band_count)]
    sentinel_s = float(scenario.end_s - scenario.start_s + np.sum(scenario.receiver_plan.dwell_times_s))
    now_s = scenario.start_s
    decision_index = 0
    previous_scan_was_hit = -1
    previous_scan_band_id = -1
    previous_scan_pulse_count = 0
    recent_selected_bands: list[int] = []
    while now_s < decision_time_seconds - 1e-12:
        selected_band_id = decision_index % scenario.receiver_plan.band_count
        dwell_s = float(scenario.receiver_plan.dwell_times_s[selected_band_id])
        end_s = min(now_s + dwell_s, scenario.end_s)
        if end_s > decision_time_seconds + 1e-12:
            break
        observed = tsrd.observe_band(indexes, selected_band_id, now_s, end_s)
        features.update_observable_history(histories[selected_band_id], now_s, bool(observed["hit"]), int(observed["pulse_count"]), float(metadata["memory_s"]))
        previous_scan_was_hit = 1 if observed["hit"] else 0
        previous_scan_band_id = selected_band_id
        previous_scan_pulse_count = int(observed["pulse_count"])
        recent_selected_bands.append(selected_band_id)
        now_s = end_s
        decision_index += 1
    return HistoricalDecisionState(scenario, histories, recent_selected_bands, decision_index, previous_scan_was_hit, previous_scan_band_id, previous_scan_pulse_count, sentinel_s)


def build_historical_feature_matrix(path: Path, scenario_id: str, decision_time_seconds: float) -> np.ndarray:
    metadata = _frozen_metadata()
    state = build_historical_state(path, scenario_id, decision_time_seconds)
    scenario = state.scenario
    matrix = features.candidate_features(scenario, state.histories, decision_time_seconds, state.decision_index, state.previous_scan_was_hit, state.previous_scan_band_id, state.previous_scan_pulse_count, float(metadata["memory_s"]), float(metadata["short_window_s"]), state.sentinel_s)
    expected_shape = (int(metadata["receiver"]["band_count"]), int(metadata["feature_count"]))
    if matrix.shape != expected_shape:
        raise ValueError(f"Unexpected feature matrix shape: {matrix.shape}")
    if metadata["feature_names"] != features.FEATURE_NAMES:
        raise ValueError("Feature order does not match frozen inference metadata")
    if not np.isfinite(matrix).all():
        raise ValueError("Feature matrix contains NaN or Inf")
    return matrix


def predict_scenario(scenario_id: str, decision_time_seconds: float) -> tuple[SchedulerPredictResponse, np.ndarray]:
    path = get_scenario_path(scenario_id)
    if path is None or not path.is_file():
        raise LookupError("Scenario not found or upload has expired")
    state: FrozenModel = model_loader.load_once()
    if not state.loaded or state.model is None:
        raise RuntimeError(state.error or "Frozen model is not loaded")
    metadata = _frozen_metadata()
    matrix = build_historical_feature_matrix(path, scenario_id, decision_time_seconds)
    probabilities = np.round(np.asarray(state.model.predict_proba(matrix)[:, 1], dtype=float), decimals=10)
    if probabilities.shape != (36,) or not np.isfinite(probabilities).all() or (probabilities < 0).any() or (probabilities > 1).any():
        raise ValueError("Frozen model returned invalid band probabilities")
    scenario = _load_scenario(path, scenario_id)
    order = np.argsort(-probabilities, kind="stable")
    bands = [BandProbability(band_id=int(band_id), frequency_start_mhz=float(scenario.receiver_plan.lows_mhz[band_id]), frequency_end_mhz=float(scenario.receiver_plan.highs_mhz[band_id]), activity_probability=float(probabilities[band_id]), rank=rank + 1) for rank, band_id in enumerate(order)]
    return SchedulerPredictResponse(scenario_id=scenario_id, decision_time_seconds=decision_time_seconds, model="Random Forest", feature_count=int(metadata["feature_count"]), candidate_count=36, bands=bands), matrix


def predict_scheduler_decision(scenario_id: str, decision_time_seconds: float) -> SchedulerDecisionResponse:
    path = get_scenario_path(scenario_id)
    if path is None or not path.is_file():
        raise LookupError("Scenario not found or upload has expired")
    state: FrozenModel = model_loader.load_once()
    if not state.loaded or state.model is None:
        raise RuntimeError(state.error or "Frozen model is not loaded")
    metadata = _frozen_metadata()
    parameters = json.loads(config.V3_PARAMETERS_PATH.read_text(encoding="utf-8"))
    if parameters.get("candidate_id") != 17:
        raise ValueError("Loaded V3 configuration is not Candidate 17")
    historical = build_historical_state(path, scenario_id, decision_time_seconds)
    matrix = features.candidate_features(historical.scenario, historical.histories, decision_time_seconds, historical.decision_index, historical.previous_scan_was_hit, historical.previous_scan_band_id, historical.previous_scan_pulse_count, float(metadata["memory_s"]), float(metadata["short_window_s"]), historical.sentinel_s)
    expected_shape = (int(metadata["receiver"]["band_count"]), int(metadata["feature_count"]))
    if matrix.shape != expected_shape or not np.isfinite(matrix).all():
        raise ValueError(f"Unexpected or invalid feature matrix: {matrix.shape}")
    probabilities = np.round(np.asarray(state.model.predict_proba(matrix)[:, 1], dtype=float), decimals=10)
    if probabilities.shape != (expected_shape[0],) or not np.isfinite(probabilities).all() or (probabilities < 0).any() or (probabilities > 1).any():
        raise ValueError("Frozen model returned invalid band probabilities")
    params = scheduler.V3Params(**parameters["parameters"])
    selected_band, terms, _ = scheduler.choose_v3_band(probabilities, historical.histories, decision_time_seconds, historical.recent_selected_bands, params)
    scores = np.asarray(terms["scores"], dtype=float)
    if not np.isfinite(scores).all():
        raise ValueError("Candidate 17 returned invalid scores")
    order = np.argsort(-scores, kind="stable")
    scenario = historical.scenario

    def band_response(band_id: int) -> DecisionBand:
        return DecisionBand(
            band_id=band_id,
            frequency_start_mhz=float(scenario.receiver_plan.lows_mhz[band_id]),
            frequency_end_mhz=float(scenario.receiver_plan.highs_mhz[band_id]),
            rf_probability=float(probabilities[band_id]),
            v3_score=float(scores[band_id]),
        )

    selected = band_response(selected_band)
    return SchedulerDecisionResponse(
        scenario_id=scenario_id,
        decision_time_seconds=decision_time_seconds,
        scheduler="Smart V3 Candidate 17",
        candidate_count=int(expected_shape[0]),
        selected_band=selected,
        decision_components=DecisionComponents(
            activity_component=float(params.w_activity * probabilities[selected_band]),
            visit_component=float(params.w_visit_staleness * terms["visit_staleness"][selected_band]),
            inverse_visit_component=float(params.w_inverse_visits * terms["inverse_visits"][selected_band]),
            hit_staleness_component=float(params.w_hit_staleness * terms["hit_staleness"][selected_band]),
            repetition_penalty=float(-params.w_repetition * terms["repetition"][selected_band]),
            uncertainty_bonus=float(params.w_uncertainty * terms["uncertainty"][selected_band]),
        ),
        top_candidates=[band_response(int(band_id)) for band_id in order[:5]],
    )