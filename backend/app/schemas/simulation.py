from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.prediction import DecisionBand


class SimulationStartRequest(BaseModel):
    scenario_id: str
    scheduler: Literal["smart_v3", "sequential"] = "smart_v3"


class ScanHistoryItem(BaseModel):
    decision_number: int
    simulation_time_seconds: float
    dwell_duration_seconds: float
    band_id: int
    outcome: Literal["HIT", "MISS"]
    pulse_count_observed: int
    rf_probability: float
    v3_score: float


class SimulationStateResponse(BaseModel):
    simulation_id: str
    scenario_id: str
    scheduler: Literal["smart_v3", "sequential"]
    status: Literal["running", "paused", "completed"]
    current_simulation_time_seconds: float
    scenario_duration_seconds: float
    selected_band: int | None
    selected_band_details: DecisionBand | None
    last_outcome: Literal["HIT", "MISS"] | None
    decision_count: int
    scan_history: list[ScanHistoryItem]
    recent_decisions: list[ScanHistoryItem]
    hit_miss_history: list[Literal["HIT", "MISS"]]
    per_band_visit_counts: dict[str, int]
    band_visit_counts: dict[str, int]
    last_visit_times_seconds: dict[str, float | None]
    last_hit_times_seconds: dict[str, float | None]
    latest_rf_probabilities: list[float]
    latest_v3_scores: list[float]
    top_candidates: list[DecisionBand]
    progress_fraction: float = Field(ge=0, le=1)
    progress_percent: float = Field(ge=0, le=100)
