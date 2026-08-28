import json
from dataclasses import dataclass

import numpy as np

from app import config
from app.schemas.sdr import MockBand, ReceiverObservation, SmartMockDecision, SmartMockStateResponse
from app.sdr.history_adapter import ReceiverHistoryAdapter
from app.sdr.manager import sdr_manager
from app.services.model_loader import model_loader
from app.services import inference_service


@dataclass
class MockSmartSession:
    adapter: ReceiverHistoryAdapter
    bands: list[MockBand]
    scenario_duration_s: float
    status: str = "idle"
    last_decision: SmartMockDecision | None = None


def _new_session(duration_s: float) -> MockSmartSession:
    bands = sdr_manager.band_plan()
    return MockSmartSession(ReceiverHistoryAdapter(bands, duration_s), bands, duration_s)


class MockSmartInferenceService:
    def __init__(self) -> None:
        self._session = _new_session(60.0)

    def start(self, duration_s: float) -> SmartMockStateResponse:
        self._session = _new_session(duration_s)
        sdr_manager.connect()
        self._session.status = "running"
        return self.state()

    def reset(self) -> SmartMockStateResponse:
        self._session = _new_session(60.0)
        sdr_manager.disconnect()
        return self.state()

    def state(self) -> SmartMockStateResponse:
        adapter_state = self._session.adapter.state
        return SmartMockStateResponse(
            input_mode="mock_sdr",
            simulated=True,
            status=self._session.status,
            decision_index=adapter_state.decision_index,
            elapsed_time_s=adapter_state.elapsed_time_s,
            selected_band=self._session.last_decision.selected_band if self._session.last_decision else None,
            last_decision=self._session.last_decision,
            previous_scan_was_hit=adapter_state.previous_scan_was_hit,
            previous_scan_band_id=adapter_state.previous_scan_band_id,
            previous_scan_pulse_count=adapter_state.previous_scan_pulse_count,
            message="Software-simulated SDR closed loop - not a physical RF measurement.",
        )

    def step(self) -> SmartMockStateResponse:
        session = self._session
        if session.status == "idle":
            raise RuntimeError("Start the Mock SDR Smart V3 session before stepping")
        if session.status == "completed":
            return session_state(session)
        loader_state = model_loader.load_once()
        if not loader_state.loaded or loader_state.model is None:
            session.status = "error"
            raise RuntimeError(loader_state.error or "Frozen model is not loaded")
        matrix = session.adapter.feature_matrix()
        probabilities = np.asarray(loader_state.model.predict_proba(matrix)[:, 1], dtype=float)
        parameters = json.loads(config.V3_PARAMETERS_PATH.read_text(encoding="utf-8"))
        params = inference_service.scheduler.V3Params(**parameters["parameters"])
        selected_id, terms, _ = inference_service.scheduler.choose_v3_band(
            probabilities, session.adapter.histories, session.adapter.state.elapsed_time_s, session.adapter.recent_selected_bands, params
        )
        band = session.bands[selected_id]
        sdr_manager.tune(band.center_frequency_hz)
        observation = sdr_manager.capture(band.dwell_time_s).model_copy(update={
            "timestamp_s": session.adapter.state.elapsed_time_s,
            "band_id": selected_id,
            "bandwidth_hz": band.high_frequency_hz - band.low_frequency_hz,
            "dwell_time_s": band.dwell_time_s,
        })
        receiver_observation = ReceiverObservation.model_validate(observation.model_dump())
        session.adapter.apply(receiver_observation)
        session.last_decision = SmartMockDecision(
            input_mode="mock_sdr", simulated=True, decision_index=session.adapter.state.decision_index - 1,
            selected_band=band, rf_probability=float(probabilities[selected_id]), v3_score=float(terms["scores"][selected_id]),
            observed_power_dbm=observation.observed_power_dbm, noise_floor_dbm=observation.estimated_noise_floor_dbm,
            activity_detected=observation.activity_detected, pulse_count=observation.pulse_count,
            outcome="HIT" if observation.activity_detected else "MISS", elapsed_time_s=observation.timestamp_s,
            capture_duration_s=observation.capture_duration_s,
        )
        if session.adapter.state.elapsed_time_s >= session.scenario_duration_s - 1e-12:
            session.status = "completed"
        return session_state(session)


def session_state(session: MockSmartSession) -> SmartMockStateResponse:
    adapter_state = session.adapter.state
    return SmartMockStateResponse(
        input_mode="mock_sdr", simulated=True, status=session.status, decision_index=adapter_state.decision_index,
        elapsed_time_s=adapter_state.elapsed_time_s, selected_band=session.last_decision.selected_band if session.last_decision else None,
        last_decision=session.last_decision, previous_scan_was_hit=adapter_state.previous_scan_was_hit,
        previous_scan_band_id=adapter_state.previous_scan_band_id, previous_scan_pulse_count=adapter_state.previous_scan_pulse_count,
        message="Software-simulated SDR closed loop - not a physical RF measurement.",
    )


mock_smart_service = MockSmartInferenceService()