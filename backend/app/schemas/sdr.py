from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


RFInputMode = Literal["tsrd_replay", "mock_sdr", "live_sdr"]
SDRHardwareStatus = Literal["available", "not_detected", "disconnected", "driver_not_installed", "connected"]
SDRDriverErrorCode = Literal[
    "DRIVER_NOT_INSTALLED",
    "DEVICE_NOT_FOUND",
    "DEVICE_BUSY",
    "CONNECTION_FAILED",
    "FREQUENCY_OUT_OF_RANGE",
    "SAMPLE_RATE_UNSUPPORTED",
    "BANDWIDTH_UNSUPPORTED",
    "TUNE_FAILED",
    "CAPTURE_FAILED",
    "DEVICE_DISCONNECTED",
]


class SDRMode(BaseModel):
    id: RFInputMode
    name: str
    description: str


class SDRModesResponse(BaseModel):
    modes: list[SDRMode]


class SDRStatus(BaseModel):
    input_mode: RFInputMode
    hardware_status: SDRHardwareStatus
    device_name: str
    connected: bool
    supported_frequency_min_hz: float = Field(ge=0)
    supported_frequency_max_hz: float = Field(gt=0)
    center_frequency_hz: float | None = Field(default=None, ge=0)
    sample_rate_hz: float | None = Field(default=None, gt=0)
    bandwidth_hz: float | None = Field(default=None, gt=0)
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
    capture_metadata: CaptureMetadata | None = None
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
    bandwidth_hz: float | None = Field(default=None, gt=0)
    dwell_time_s: float = Field(gt=0)
    enabled: bool = True

    @model_validator(mode="after")
    def validate_band_geometry(self) -> "MockBand":
        if self.low_frequency_hz >= self.high_frequency_hz:
            raise ValueError("low_frequency_hz must be less than high_frequency_hz")
        if not self.low_frequency_hz <= self.center_frequency_hz <= self.high_frequency_hz:
            raise ValueError("center_frequency_hz must be inside the band")
        if self.bandwidth_hz is None:
            self.bandwidth_hz = self.high_frequency_hz - self.low_frequency_hz
        if self.bandwidth_hz <= 0:
            raise ValueError("bandwidth_hz must be greater than zero")
        if self.bandwidth_hz > self.high_frequency_hz - self.low_frequency_hz:
            raise ValueError("bandwidth_hz cannot exceed band width")
        return self


class SDRTuningTiming(BaseModel):
    tune_requested_s: float | None = Field(default=None, ge=0)
    tune_completed_s: float | None = Field(default=None, ge=0)
    tuning_latency_s: float | None = Field(default=None, ge=0)
    settling_duration_s: float | None = Field(default=None, ge=0)
    capture_start_s: float | None = Field(default=None, ge=0)
    capture_end_s: float | None = Field(default=None, ge=0)
    latency_status: Literal["simulated", "measured", "unknown"] = "unknown"


class CaptureMetadata(BaseModel):
    requested_center_frequency_hz: float | None = Field(default=None, ge=0)
    actual_center_frequency_hz: float | None = Field(default=None, ge=0)
    requested_sample_rate_hz: float | None = Field(default=None, gt=0)
    actual_sample_rate_hz: float | None = Field(default=None, gt=0)
    requested_bandwidth_hz: float | None = Field(default=None, gt=0)
    actual_bandwidth_hz: float | None = Field(default=None, gt=0)
    requested_dwell_duration_s: float | None = Field(default=None, gt=0)
    actual_capture_duration_s: float | None = Field(default=None, ge=0)
    capture_timestamp_s: float | None = Field(default=None, ge=0)
    tuning_latency_s: float | None = Field(default=None, ge=0)
    settling_duration_s: float | None = Field(default=None, ge=0)
    dropped_samples: int | None = Field(default=None, ge=0)
    overflow: bool | None = None
    simulated: bool
    driver_name: str
    device_id: str
    device_name: str
    timing: SDRTuningTiming | None = None


class DeviceCapabilities(BaseModel):
    device_id: str
    device_name: str
    driver_name: str
    manufacturer: str | None = None
    connected: bool
    simulated: bool
    receive_supported: bool
    transmit_supported: bool
    min_frequency_hz: float | None = Field(default=None, ge=0)
    max_frequency_hz: float | None = Field(default=None, gt=0)
    min_sample_rate_hz: float | None = Field(default=None, gt=0)
    max_sample_rate_hz: float | None = Field(default=None, gt=0)
    supported_sample_rates_hz: list[float] | None = None
    max_bandwidth_hz: float | None = Field(default=None, gt=0)
    recommended_bandwidth_hz: float | None = Field(default=None, gt=0)
    current_center_frequency_hz: float | None = Field(default=None, ge=0)
    current_sample_rate_hz: float | None = Field(default=None, gt=0)
    current_bandwidth_hz: float | None = Field(default=None, gt=0)
    serial: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class SDRDeviceDescriptor(BaseModel):
    device_id: str
    device_name: str
    driver_name: str
    input_mode: RFInputMode
    driver_available: bool
    connected: bool
    simulated: bool
    receive_supported: bool
    transmit_supported: bool
    hardware_status: SDRHardwareStatus
    message: str


class SDRDevicesResponse(BaseModel):
    input_mode: RFInputMode
    devices: list[SDRDeviceDescriptor]


class SDRCapabilitiesResponse(BaseModel):
    input_mode: RFInputMode
    active_device_id: str
    capabilities: list[DeviceCapabilities]


class BandPlanResponse(BaseModel):
    input_mode: RFInputMode
    simulated: bool
    bands: list[MockBand]
    sample_rate_hz: float | None = Field(default=None, gt=0)
    bandwidth_hz: float | None = Field(default=None, gt=0)
    message: str


class RejectedBand(BaseModel):
    band_id: int
    reasons: list[str]


class FrequencyCoverage(BaseModel):
    min_frequency_hz: float | None = Field(default=None, ge=0)
    max_frequency_hz: float | None = Field(default=None, ge=0)


class BandPlanValidationRequest(BaseModel):
    device_id: str = "mock_sdr"
    bands: list[MockBand] | None = None
    sample_rate_hz: float | None = Field(default=None, gt=0)
    bandwidth_hz: float | None = Field(default=None, gt=0)


class BandPlanValidationReport(BaseModel):
    device_id: str
    compatible: bool
    errors: list[str]
    warnings: list[str]
    usable_band_count: int = Field(ge=0)
    rejected_bands: list[RejectedBand]
    device_frequency_coverage_hz: FrequencyCoverage
    requested_frequency_coverage_hz: FrequencyCoverage
    simulated: bool


class SDRDriverErrorDetail(BaseModel):
    code: SDRDriverErrorCode
    message: str
    device_id: str | None = None


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
