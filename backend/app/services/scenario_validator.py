import hashlib
import json
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import h5py
import numpy as np

from app import config
from app.schemas.scenario import ReceiverPlanSummary, ScenarioUploadResponse

SRC_DIR = config.PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import preprocessing as frozen_preprocessing  # noqa: E402

EXPECTED_FEATURE_NAMES = ["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"]
_scenario_paths: dict[str, Path] = {}
_scenario_directories: dict[str, tempfile.TemporaryDirectory[str]] = {}
_scenario_records: dict[str, "ScenarioRecord"] = {}


@dataclass(frozen=True)
class ScenarioRecord:
    scenario_id: str
    filename: str
    path: Path
    sha256: str
    pulse_count: int
    duration_seconds: float
    receiver_plan: ReceiverPlanSummary


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


def _normalize_labels(dataset: h5py.Dataset) -> np.ndarray:
    if dataset.ndim == 1:
        labels = np.asarray(dataset[:])
    elif dataset.ndim == 2 and dataset.shape[1] == 1:
        labels = np.asarray(dataset[:, 0])
    else:
        raise ScenarioValidationError("/labels must be a non-empty 1D dataset")
    if labels.shape[0] == 0:
        raise ScenarioValidationError("/labels must be a non-empty 1D dataset")
    return labels


def _count_unique_labels(labels: np.ndarray) -> int:
    unique_values: set[str] = set()
    for start in range(0, labels.shape[0], 8192):
        unique_values.update(_decode_string(value) for value in labels[start : start + 8192])
    return len(unique_values)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(config.UPLOAD_CHUNK_SIZE_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _read_receiver_plan(handle: h5py.File) -> ReceiverPlanSummary:
    receiver = handle["/metadata/receiver"]
    centres = np.asarray(receiver["dwell_centres_mhz"][:], dtype=float)
    dwell_times = np.asarray(receiver["dwell_times_s"][:], dtype=float)
    receiver_mode = _decode_string(receiver.attrs.get("scan_mode", handle["/metadata"].attrs.get("receiver_mode", "")))
    bandwidth = float(receiver.attrs.get("bandwith_mhz", receiver.attrs.get("bandwidth_mhz", config.RECEIVER_BANDWIDTH_MHZ)))
    if centres.ndim != 1 or dwell_times.ndim != 1 or centres.size != dwell_times.size:
        raise ScenarioValidationError("Receiver dwell centres and dwell times must be matching 1D arrays")
    if centres.size == 0:
        if receiver_mode != "Stare":
            raise ScenarioValidationError("Empty receiver dwell arrays are only valid for Stare scenarios")
        if "/metadata/receiver/freq_range_mhz" not in handle:
            raise ScenarioValidationError("Stare scenarios with empty dwell arrays require receiver frequency metadata")
        frequency_range = np.asarray(handle["/metadata/receiver/freq_range_mhz"][:], dtype=float)
        canonical = frozen_preprocessing.read_receiver_plan(handle, bandwidth)
        if frequency_range.shape != (2,) or not np.isfinite(frequency_range).all() or frequency_range[0] < canonical.lows_mhz[0] or frequency_range[1] > canonical.highs_mhz[-1] or frequency_range[0] >= frequency_range[1]:
            raise ScenarioValidationError("Stare frequency metadata is incompatible with the frozen receiver plan")
        centres = canonical.centres_mhz
        dwell_times = canonical.dwell_times_s
    if centres.size != config.RECEIVER_BAND_COUNT:
        raise ScenarioValidationError(f"Receiver plan must contain exactly {config.RECEIVER_BAND_COUNT} bands")
    if not np.isfinite(centres).all() or not np.isfinite(dwell_times).all() or (dwell_times <= 0).any():
        raise ScenarioValidationError("Receiver plan contains invalid centre frequencies or dwell times")
    if not np.isfinite(bandwidth) or bandwidth <= 0:
        raise ScenarioValidationError("Receiver bandwidth must be a positive finite value")
    return ReceiverPlanSummary(
        band_count=int(centres.size),
        bandwidth_mhz=bandwidth,
        centres_mhz=[float(value) for value in centres],
        dwell_times_seconds=[float(value) for value in dwell_times],
        source="frozen_default_tsr_scan_plan" if receiver_mode == "Stare" and np.asarray(receiver["dwell_centres_mhz"][:]).size == 0 else "file_metadata",
    )


def validate_scenario_file(path: Path, filename: str, file_size: int, scenario_id: str) -> ScenarioUploadResponse:
    messages: list[str] = []
    try:
        with h5py.File(path, "r") as handle:
            required_paths = ("/data", "/labels", "/metadata", "/metadata/feature_names", "/metadata/receiver", "/metadata/receiver/dwell_centres_mhz", "/metadata/receiver/dwell_times_s")
            missing = [required_path for required_path in required_paths if required_path not in handle]
            if missing:
                raise ScenarioValidationError(f"Missing required H5 path(s): {', '.join(missing)}")
            data = handle["/data"]
            labels = handle["/labels"]
            feature_names = _read_feature_names(handle["/metadata/feature_names"])
            if feature_names != EXPECTED_FEATURE_NAMES:
                raise ScenarioValidationError(f"Incompatible feature names: expected {EXPECTED_FEATURE_NAMES}, got {feature_names}")
            normalized_labels = _normalize_labels(labels)
            if data.shape[0] != normalized_labels.shape[0]:
                raise ScenarioValidationError("/data and /labels must contain the same number of pulses")
            toa_index = feature_names.index("ToA")
            frequency_index = feature_names.index("Frequency")
            frequency_min, frequency_max, toa_min, toa_max = _scan_numeric_columns(data, toa_index, frequency_index)
            unique_emitter_count = _count_unique_labels(normalized_labels)
            receiver_plan = _read_receiver_plan(handle)
            receiver = handle["/metadata/receiver"]
            receiver_mode = receiver.attrs.get("scan_mode", handle["/metadata"].attrs.get("receiver_mode", "Stare"))
            receiver_mode = _decode_string(receiver_mode)
            if receiver_mode != "Stare":
                raise ScenarioValidationError(f"Expected a compatible Stare scenario, found {receiver_mode!r}")
            sha256 = _sha256(path)
            duration_seconds = max(0.0, toa_max / 1_000_000.0)
            messages.append("H5 structure, feature names, and summary statistics validated")
            response = ScenarioUploadResponse(scenario_id=scenario_id, filename=filename, sha256=sha256, valid=True, receiver_mode=receiver_mode, pulse_count=int(data.shape[0]), duration_seconds=duration_seconds, receiver_plan=receiver_plan, unique_emitter_count=unique_emitter_count, feature_names=feature_names, frequency_min=frequency_min, frequency_max=frequency_max, toa_min=toa_min, toa_max=toa_max, file_size=file_size, validation_messages=messages)
            _scenario_records[scenario_id] = ScenarioRecord(scenario_id=scenario_id, filename=filename, path=path, sha256=sha256, pulse_count=int(data.shape[0]), duration_seconds=duration_seconds, receiver_plan=receiver_plan)
            return response
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


def get_scenario_record(scenario_id: str) -> ScenarioRecord | None:
    return _scenario_records.get(scenario_id)


def discard_scenario(scenario_id: str) -> None:
    temporary_directory = _scenario_directories.pop(scenario_id, None)
    _scenario_paths.pop(scenario_id, None)
    _scenario_records.pop(scenario_id, None)
    if temporary_directory is not None:
        temporary_directory.cleanup()
