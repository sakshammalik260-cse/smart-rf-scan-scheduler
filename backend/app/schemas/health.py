from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str
    model_loaded: bool