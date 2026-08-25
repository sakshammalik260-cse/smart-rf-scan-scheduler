from typing import Literal

from pydantic import BaseModel


class ModelStatusResponse(BaseModel):
    model_name: str
    model_version: str
    loaded: bool
    verification_status: Literal["verified", "failed", "not_checked"]
    frozen: bool
    feature_count: int | None
    candidate_number: int | None
    model_sha256: str | None
    error: str | None = None