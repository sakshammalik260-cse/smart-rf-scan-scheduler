from pathlib import Path

import h5py
import numpy as np

from app import config
from app.schemas.scenario import BandRange, ScenarioSummaryResponse, TimeBin
from app.services.scenario_validator import EXPECTED_FEATURE_NAMES, ScenarioValidationError, _normalize_labels


def _decode(value: object) -> str:
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value)


def _band_for_frequency(frequency_mhz: float) -> int | None:
    band = int((frequency_mhz - config.RECEIVER_LOW_MHZ) // config.RECEIVER_BANDWIDTH_MHZ)
    if 0 <= band < config.RECEIVER_BAND_COUNT:
        return band
    return None


def build_scenario_summary(path: Path, scenario_id: str) -> ScenarioSummaryResponse:
    activity_count_per_band = {str(band): 0 for band in range(config.RECEIVER_BAND_COUNT)}
    time_bin_bands: dict[int, set[int]] = {}
    time_bin_counts: dict[int, int] = {}
    emitters: set[str] = set()
    try:
        with h5py.File(path, "r") as handle:
            required_paths = ("/data", "/labels", "/metadata/feature_names")
            missing = [required_path for required_path in required_paths if required_path not in handle]
            if missing:
                raise ScenarioValidationError(f"Missing required H5 path(s): {', '.join(missing)}")
            data = handle["/data"]
            labels = _normalize_labels(handle["/labels"])
            feature_names = [_decode(value) for value in handle["/metadata/feature_names"][()]]
            if feature_names != EXPECTED_FEATURE_NAMES:
                raise ScenarioValidationError("Incompatible feature names in stored scenario")
            if data.ndim != 2 or data.shape[0] == 0 or labels.shape[0] != data.shape[0]:
                raise ScenarioValidationError("Scenario data and labels are empty, malformed, or mismatched")
            toa_index = feature_names.index("ToA")
            frequency_index = feature_names.index("Frequency")
            toa_min_us = float("inf")
            toa_max_us = float("-inf")
            chunk_size = 8192
            for start in range(0, data.shape[0], chunk_size):
                rows = np.asarray(data[start : start + 8192, [toa_index, frequency_index]], dtype=float)
                if not np.isfinite(rows).all():
                    raise ScenarioValidationError("Scenario contains non-finite ToA or Frequency values")
                toa_min_us = min(toa_min_us, float(rows[:, 0].min()))
                toa_max_us = max(toa_max_us, float(rows[:, 0].max()))
            for start in range(0, data.shape[0], chunk_size):
                rows = np.asarray(data[start : start + chunk_size, [toa_index, frequency_index]], dtype=float)
                label_chunk = labels[start : start + chunk_size]
                emitters.update(_decode(value) for value in label_chunk)
                for toa_us, frequency_mhz in rows:
                    band = _band_for_frequency(float(frequency_mhz))
                    if band is None:
                        continue
                    relative_seconds = (float(toa_us) - toa_min_us) / 1_000_000.0
                    bin_index = int(relative_seconds // config.TIME_BIN_SECONDS)
                    time_bin_bands.setdefault(bin_index, set()).add(band)
                    time_bin_counts[bin_index] = time_bin_counts.get(bin_index, 0) + 1
                    activity_count_per_band[str(band)] += 1
            duration_seconds = (toa_max_us - toa_min_us) / 1_000_000.0
            time_bins = [TimeBin(index=index, start_s=index * config.TIME_BIN_SECONDS, end_s=(index + 1) * config.TIME_BIN_SECONDS, active_bands=sorted(time_bin_bands.get(index, set())), activity_count=time_bin_counts.get(index, 0)) for index in range(int(duration_seconds // config.TIME_BIN_SECONDS) + 1)]
            active_bands = [band for band in range(config.RECEIVER_BAND_COUNT) if activity_count_per_band[str(band)] > 0]
            band_ranges = [BandRange(band=band, frequency_min_mhz=config.RECEIVER_LOW_MHZ + band * config.RECEIVER_BANDWIDTH_MHZ, frequency_max_mhz=config.RECEIVER_LOW_MHZ + (band + 1) * config.RECEIVER_BANDWIDTH_MHZ) for band in range(config.RECEIVER_BAND_COUNT)]
            return ScenarioSummaryResponse(scenario_id=scenario_id, duration_seconds=duration_seconds, active_bands=active_bands, activity_count_per_band=activity_count_per_band, time_bins=time_bins, band_ranges=band_ranges, emitter_count=len(emitters), total_pulses=int(data.shape[0]))
    except OSError as error:
        raise ScenarioValidationError(f"Unable to read stored scenario: {error}") from error