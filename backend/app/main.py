from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.schemas.health import HealthResponse
from app.schemas.model import ModelStatusResponse
from app.schemas.scenario import ScenarioSummaryResponse, ScenarioUploadResponse
from app.schemas.prediction import SchedulerDecisionResponse, SchedulerPredictRequest, SchedulerPredictResponse
from app.schemas.simulation import SimulationStartRequest, SimulationStateResponse
from app.schemas.sdr import CaptureRequest, SampleRateRequest, SDRModesResponse, SDRObservation, SDRStatus, TuneRequest
from app.sdr import sdr_manager
from app.schemas.sdr import SmartMockStartRequest, SmartMockStateResponse
from app.services.sdr_inference_service import mock_smart_service
from app.services.model_loader import model_loader
from app.services.scenario_processing import build_scenario_summary
from app.services.scenario_validator import ScenarioValidationError, discard_scenario, get_scenario_path, save_upload, validate_scenario_file
from app.services.inference_service import predict_scenario, predict_scheduler_decision
from app.services.simulation_service import get_session, pause_simulation, reset_simulation, start_simulation


@asynccontextmanager
async def lifespan(_: FastAPI):
    model_loader.load_once()
    yield


app = FastAPI(title="Smart Scan Scheduler API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="smart-scheduler-backend", model_loaded=model_loader.state.loaded)


@app.get("/api/model/status", response_model=ModelStatusResponse)
def model_status() -> ModelStatusResponse:
    state = model_loader.state
    metadata = state.metadata
    return ModelStatusResponse(
        model_name="Random Forest",
        model_version=metadata.get("model_version", "unknown"),
        loaded=state.loaded,
        verification_status=state.verification_status,
        frozen=bool(metadata.get("inference_only", False)),
        feature_count=metadata.get("feature_count"),
        candidate_number=metadata.get("v3_candidate_id"),
        model_sha256=state.model_sha256,
        error=state.error,
    )


@app.get("/api/sdr/modes", response_model=SDRModesResponse)
def sdr_modes() -> SDRModesResponse:
    return SDRModesResponse(modes=sdr_manager.modes())


@app.get("/api/sdr/status", response_model=SDRStatus)
def sdr_status() -> SDRStatus:
    return sdr_manager.status()


@app.post("/api/sdr/connect", response_model=SDRStatus)
def sdr_connect() -> SDRStatus:
    return sdr_manager.connect()


@app.post("/api/sdr/disconnect", response_model=SDRStatus)
def sdr_disconnect() -> SDRStatus:
    return sdr_manager.disconnect()


@app.post("/api/sdr/sample-rate", response_model=SDRStatus)
def sdr_sample_rate(request: SampleRateRequest) -> SDRStatus:
    try:
        return sdr_manager.set_sample_rate(request.sample_rate_hz)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sdr/tune", response_model=SDRStatus)
def sdr_tune(request: TuneRequest) -> SDRStatus:
    try:
        return sdr_manager.tune(request.frequency_hz)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sdr/capture", response_model=SDRObservation)
def sdr_capture(request: CaptureRequest) -> SDRObservation:
    try:
        return sdr_manager.capture(request.duration_s)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sdr/smart/start", response_model=SmartMockStateResponse)
def sdr_smart_start(request: SmartMockStartRequest) -> SmartMockStateResponse:
    try:
        return mock_smart_service.start(request.scenario_duration_s)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sdr/smart/step", response_model=SmartMockStateResponse)
def sdr_smart_step() -> SmartMockStateResponse:
    try:
        return mock_smart_service.step()
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/sdr/smart/reset", response_model=SmartMockStateResponse)
def sdr_smart_reset() -> SmartMockStateResponse:
    return mock_smart_service.reset()


@app.get("/api/sdr/smart/status", response_model=SmartMockStateResponse)
def sdr_smart_status() -> SmartMockStateResponse:
    return mock_smart_service.state()


@app.post("/api/scenarios/upload", response_model=ScenarioUploadResponse)
def upload_scenario(file: UploadFile = File(...)) -> ScenarioUploadResponse:
    filename = file.filename or "unnamed.h5"
    if not filename.lower().endswith(".h5"):
        raise HTTPException(status_code=400, detail="Only .h5 TSRD files are accepted")
    try:
        scenario_id, path, file_size = save_upload(file.file, filename)
        return validate_scenario_file(path, filename, file_size, scenario_id)
    except ScenarioValidationError as error:
        if "scenario_id" in locals():
            discard_scenario(scenario_id)
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error


@app.get("/api/scenarios/{scenario_id}/summary", response_model=ScenarioSummaryResponse)
def scenario_summary(scenario_id: str) -> ScenarioSummaryResponse:
    path = get_scenario_path(scenario_id)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Scenario not found or upload has expired")
    try:
        return build_scenario_summary(path, scenario_id)
    except ScenarioValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/scheduler/predict", response_model=SchedulerPredictResponse)
def scheduler_predict(request: SchedulerPredictRequest) -> SchedulerPredictResponse:
    try:
        response, _ = predict_scenario(request.scenario_id, request.decision_time_seconds)
        return response
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/scheduler/decision", response_model=SchedulerDecisionResponse)
def scheduler_decision(request: SchedulerPredictRequest) -> SchedulerDecisionResponse:
    try:
        return predict_scheduler_decision(request.scenario_id, request.decision_time_seconds)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/simulation/start", response_model=SimulationStateResponse)
def simulation_start(request: SimulationStartRequest) -> SimulationStateResponse:
    try:
        return start_simulation(request.scenario_id, request.scheduler)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/simulation/{simulation_id}/step", response_model=SimulationStateResponse)
def simulation_step(simulation_id: str) -> SimulationStateResponse:
    try:
        return get_session(simulation_id).step()
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/simulation/{simulation_id}/pause", response_model=SimulationStateResponse)
def simulation_pause(simulation_id: str) -> SimulationStateResponse:
    try:
        return pause_simulation(simulation_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/simulation/{simulation_id}/reset", response_model=SimulationStateResponse)
def simulation_reset(simulation_id: str) -> SimulationStateResponse:
    try:
        return reset_simulation(simulation_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/simulation/{simulation_id}/state", response_model=SimulationStateResponse)
def simulation_state(simulation_id: str) -> SimulationStateResponse:
    try:
        return get_session(simulation_id).state_response()
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
