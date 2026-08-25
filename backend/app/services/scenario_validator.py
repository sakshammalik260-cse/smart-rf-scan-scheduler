import json
import tempfile
import uuid
from pathlib import Path
from typing import BinaryIO

import h5py
import numpy as np

from app import config
from app.schemas.scenario import ScenarioUploadResponse

EXPECTED_FEATURE_NAMES = ["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"]
_scenario_paths: dict[str, Path] = {}
_scenario_directories: dict[str, tempfile.TemporaryDirectory[str]] = {}


class ScenarioValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _decode_string(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _read_feature_names(dataset: h5py.Dataset) -> list[str]:
    return [_decode_string(value) for value in dataset[()]]


def _scan_numeric_columns(dataset: h5py.Dataset, toa_index: int, frequency_index: int) -> tuple[float, float, float, float]:
    if dataset.ndim != 2 or dataset.shape[1] <= max(toa_index, frequency_index):
        raise ScenarioValidationError("/data must be a 2D dataset containing ToA and Frequency columns")
    toa_min = frequency_min = float("inf")
    toa_max = frequency_max = float("-inf")
    for start in range(0, dataset.shape[0], 8192):
        rows = np.asarray(dataset[start : start + 8192, [toa_index, frequency_index]], dtype=float)
        if rows.size == 0:
            continue
        if not np.isfinite(rows).all():
            raise ScenarioValidationError("/data contains non-finite ToA or Frequency values")
        toa_min = min(toa_min, float(rows[:, 0].min()))
        toa_max = max(toa_max, float(rows[:, 0].max()))
        frequency_min = min(frequency_min, float(rows[:, 1].min()))
        frequency_max = max(frequency_max, float(rows[:, 1].max()))
    if dataset.shape[0] == 0:
        raise ScenarioValidationError("/data must contain at least one pulse")
    return frequency_min, frequency_max, toa_min, toa_max


def _count_unique_labels(dataset: h5py.Dataset) -> int:
    if dataset.ndim != 1 or dataset.shape[0] == 0:
        raise ScenarioValidationError("/labels must be a non-empty 1D dataset")
    unique_values: set[str] = set()
    for start in range(0, dataset.shape[0], 8192):
        unique_values.update(_decode_string(value) for value in dataset[start : start + 8192])
    return len(unique_values)


def validate_scenario_file(path: Path, filename: str, file_size: int, scenario_id: str) -> ScenarioUploadResponse:
    messages: list[str] = []
    try:
        with h5py.File(path, "r") as handle:
            required_paths = ("/data", "/labels", "/metadata", "/metadata/feature_names")
            missing = [required_path for required_path in required_paths if required_path not in handle]
            if missing:
                raise ScenarioValidationError(f"Missing required H5 path(s): {', '.join(missing)}")
            data = handle["/data"]
            labels = handle["/labels"]
            feature_names = _read_feature_names(handle["/metadata/feature_names"])
            if feature_names != EXPECTED_FEATURE_NAMES:
                raise ScenarioValidationError(f"Incompatible feature names: expected {EXPECTED_FEATURE_NAMES}, got {feature_names}")
            if data.shape[0] != labels.shape[0]:
                raise ScenarioValidationError("/data and /labels must contain the same number of pulses")
            toa_index = feature_names.index("ToA")
            frequency_index = feature_names.index("Frequency")
            frequency_min, frequency_max, toa_min, toa_max = _scan_numeric_columns(data, toa_index, frequency_index)
            unique_emitter_count = _count_unique_labels(labels)
            receiver_mode = handle["/metadata"].attrs.get("receiver_mode", "Stare")
            receiver_mode = _decode_string(receiver_mode)
            messages.append("H5 structure, feature names, and summary statistics validated")
            return ScenarioUploadResponse(scenario_id=scenario_id, filename=filename, valid=True, receiver_mode=receiver_mode, pulse_count=int(data.shape[0]), unique_emitter_count=unique_emitter_count, feature_names=feature_names, frequency_min=frequency_min, frequency_max=frequency_max, toa_min=toa_min, toa_max=toa_max, file_size=file_size, validation_messages=messages)
    except OSError as error:
        raise ScenarioValidationError(f"Unable to read H5 file: {error}") from error


def save_upload(upload: BinaryIO, filename: str) -> tuple[str, Path, int]:
    scenario_id = uuid.uuid4().hex
    temporary_directory = tempfile.TemporaryDirectory(prefix="smart_scheduler_upload_")
    path = Path(temporary_directory.name) / f"{scenario_id}.h5"
    total_size = 0
    try:
        with path.open("wb") as destination:
            while chunk := upload.read(config.UPLOAD_CHUNK_SIZE_BYTES):
                total_size += len(chunk)
                if total_size > config.MAX_UPLOAD_SIZE_BYTES:
                    raise ScenarioValidationError(f"Upload exceeds the {config.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB limit", 413)
                destination.write(chunk)
        _scenario_paths[scenario_id] = path
        _scenario_directories[scenario_id] = temporary_directory
        return scenario_id, path, total_size
    except Exception:
        temporary_directory.cleanup()
        raise


def get_scenario_path(scenario_id: str) -> Path | None:
    return _scenario_paths.get(scenario_id)


def discard_scenario(scenario_id: str) -> None:
    temporary_directory = _scenario_directories.pop(scenario_id, None)
    _scenario_paths.pop(scenario_id, None)
    if temporary_directory is not None:
        temporary_directory.cleanup()