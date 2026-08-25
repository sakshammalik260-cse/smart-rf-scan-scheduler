from pydantic import BaseModel, Field


class SchedulerPredictRequest(BaseModel):
    scenario_id: str
    decision_time_seconds: float = Field(ge=0)


class BandProbability(BaseModel):
    band_id: int
    frequency_start_mhz: float
    frequency_end_mhz: float
    activity_probability: float
    rank: int


class SchedulerPredictResponse(BaseModel):
    scenario_id: str
    decision_time_seconds: float
    model: str
    feature_count: int
    candidate_count: int
    bands: list[BandProbability]


class DecisionBand(BaseModel):
    band_id: int
    frequency_start_mhz: float
    frequency_end_mhz: float
    rf_probability: float
    v3_score: float


class DecisionComponents(BaseModel):
    activity_component: float
    visit_component: float
    inverse_visit_component: float
    hit_staleness_component: float
    repetition_penalty: float
    uncertainty_bonus: float


class SchedulerDecisionResponse(BaseModel):
    scenario_id: str
    decision_time_seconds: float
    scheduler: str
    candidate_count: int
    selected_band: DecisionBand
    decision_components: DecisionComponents
    top_candidates: list[DecisionBand]