from pydantic import BaseModel


class ScenarioUploadResponse(BaseModel):
    scenario_id: str
    filename: str
    valid: bool
    receiver_mode: str | None
    pulse_count: int | None
    unique_emitter_count: int | None
    feature_names: list[str]
    frequency_min: float | None
    frequency_max: float | None
    toa_min: float | None
    toa_max: float | None
    file_size: int
    validation_messages: list[str]


class TimeBin(BaseModel):
    index: int
    start_s: float
    end_s: float
    active_bands: list[int]
    activity_count: int


class BandRange(BaseModel):
    band: int
    frequency_min_mhz: float
    frequency_max_mhz: float


class ScenarioSummaryResponse(BaseModel):
    scenario_id: str
    duration_seconds: float
    active_bands: list[int]
    activity_count_per_band: dict[str, int]
    time_bins: list[TimeBin]
    band_ranges: list[BandRange]
    emitter_count: int
    total_pulses: int