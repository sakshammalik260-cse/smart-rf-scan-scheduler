from typing import Literal

from pydantic import BaseModel, Field, model_validator


RFInputMode = Literal["tsrd_replay", "mock_sdr", "live_sdr"]


class SDRMode(BaseModel):
    id: RFInputMode
    name: str
    description: str


class SDRModesResponse(BaseModel):
    modes: list[SDRMode]


class SDRStatus(BaseModel):
    input_mode: RFInputMode
    hardware_status: Literal["available", "not_detected", "disconnected"]
    device_name: str
    connected: bool
    supported_frequency_min_hz: float = Field(ge=0)
    supported_frequency_max_hz: float = Field(gt=0)
    center_frequency_hz: float | None = Field(default=None, ge=0)
    sample_rate_hz: float | None = Field(default=None, gt=0)
    observed_power_dbm: float | None = None
    estimated_noise_floor_dbm: float | None = None
    activity_detected: bool | None = None
    capture_duration_s: float | None = Field(default=None, ge=0)
    simulated: bool
    message: str


class SDRObservation(BaseModel):
    input_mode: RFInputMode
    device_name: str
    timestamp_s: float = Field(default=0.0, ge=0)
    band_id: int | None = Field(default=None, ge=0)
    center_frequency_hz: float
    bandwidth_hz: float = Field(default=0.0, gt=0)
    sample_rate_hz: float
    dwell_time_s: float = Field(default=0.0, gt=0)
    observed_power_dbm: float
    estimated_noise_floor_dbm: float
    activity_detected: bool
    capture_duration_s: float
    pulse_count: int = Field(default=0, ge=0)
    detected_events: list["PulseEvent"] = Field(default_factory=list)
    simulated: bool
    message: str


class ReceiverObservation(SDRObservation):
    """Observation contract consumed by the receiver-history adapter."""

    @model_validator(mode="after")
    def validate_event_consistency(self) -> "ReceiverObservation":
        if self.pulse_count != len(self.detected_events):
            raise ValueError("pulse_count must equal the number of detected events")
        if self.activity_detected != (self.pulse_count > 0):
            raise ValueError("activity_detected must match pulse presence")
        return self


class PulseEvent(BaseModel):
    timestamp_s: float = Field(ge=0)
    frequency_hz: float = Field(ge=0)
    pulse_width_s: float = Field(gt=0)
    amplitude_dbm: float


class MockBand(BaseModel):
    band_id: int = Field(ge=0)
    low_frequency_hz: float = Field(ge=0)
    high_frequency_hz: float = Field(gt=0)
    center_frequency_hz: float = Field(gt=0)
    dwell_time_s: float = Field(gt=0)


class SmartMockStartRequest(BaseModel):
    scenario_duration_s: float = Field(default=60.0, gt=0, le=86400)


class SmartMockDecision(BaseModel):
    input_mode: Literal["mock_sdr"]
    simulated: Literal[True]
    decision_index: int = Field(ge=0)
    selected_band: MockBand
    rf_probability: float = Field(ge=0, le=1)
    v3_score: float
    observed_power_dbm: float
    noise_floor_dbm: float
    activity_detected: bool
    pulse_count: int = Field(ge=0)
    outcome: Literal["HIT", "MISS"]
    elapsed_time_s: float = Field(ge=0)
    capture_duration_s: float = Field(ge=0)


class SmartMockStateResponse(BaseModel):
    input_mode: Literal["mock_sdr"]
    simulated: Literal[True]
    status: Literal["idle", "running", "completed", "error"]
    decision_index: int = Field(ge=0)
    elapsed_time_s: float = Field(ge=0)
    selected_band: MockBand | None = None
    last_decision: SmartMockDecision | None = None
    previous_scan_was_hit: int
    previous_scan_band_id: int
    previous_scan_pulse_count: int = Field(ge=0)
    feature_count: int = Field(default=30, ge=30, le=30)
    candidate_count: int = Field(default=36, ge=36, le=36)
    message: str


class SampleRateRequest(BaseModel):
    sample_rate_hz: float = Field(gt=0)


class TuneRequest(BaseModel):
    frequency_hz: float = Field(ge=0)


class CaptureRequest(BaseModel):
    duration_s: float = Field(gt=0, le=60)