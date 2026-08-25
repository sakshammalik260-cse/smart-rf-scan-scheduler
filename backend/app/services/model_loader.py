import hashlib
import json
from dataclasses import dataclass
from typing import Any

import joblib

from app import config


class ModelVerificationError(RuntimeError):
    """Raised when the frozen model does not match its approved artifact hash."""


@dataclass
class FrozenModel:
    model: Any | None
    metadata: dict[str, Any]
    parameters: dict[str, Any]
    model_sha256: str | None
    verification_status: str
    error: str | None = None

    @property
    def loaded(self) -> bool:
        return self.model is not None


def calculate_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact_hash(path: str, expected_hash: str) -> str:
    actual_hash = calculate_sha256(path)
    if actual_hash != expected_hash:
        raise ModelVerificationError(f"Frozen model verification failed: expected {expected_hash}, got {actual_hash}")
    return actual_hash


class FrozenModelLoader:
    def __init__(self) -> None:
        self._frozen_model = FrozenModel(None, {}, {}, None, "not_checked")

    def load_once(self) -> FrozenModel:
        if self._frozen_model.verification_status != "not_checked":
            return self._frozen_model
        try:
            model_sha256 = verify_artifact_hash(str(config.MODEL_PATH), config.EXPECTED_MODEL_SHA256)
            with open(config.INFERENCE_METADATA_PATH, encoding="utf-8") as metadata_file:
                metadata = json.load(metadata_file)
            with open(config.V3_PARAMETERS_PATH, encoding="utf-8") as parameters_file:
                parameters = json.load(parameters_file)
            model = joblib.load(config.MODEL_PATH)
            self._frozen_model = FrozenModel(model, metadata, parameters, model_sha256, "verified")
        except (OSError, json.JSONDecodeError, ModelVerificationError, ValueError) as error:
            self._frozen_model = FrozenModel(None, {}, {}, None, "failed", str(error))
        return self._frozen_model

    @property
    def state(self) -> FrozenModel:
        return self._frozen_model


model_loader = FrozenModelLoader()