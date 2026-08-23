from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont


try:
    import h5py
except ImportError:  # pragma: no cover - local fallback for this workspace only
    fallback = Path(__file__).resolve().parents[2] / "work" / "h5reader"
    if fallback.exists():
        sys.path.insert(0, str(fallback))
        import h5py
    else:
        raise
if not hasattr(h5py, "File"):  # pragma: no cover - handles broken namespace-only imports
    fallback = Path(__file__).resolve().parents[2] / "work" / "h5reader"
    if fallback.exists():
        sys.path.insert(0, str(fallback))
        import importlib

        h5py = importlib.import_module("h5py")
if not hasattr(h5py, "File"):
    raise ImportError("A working h5py installation is required. Run `python -m pip install -r requirements.txt`.")


REQUIRED_FEATURES = ["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"]
DEFAULT_CENTRES_MHZ = np.arange(250.0, 18000.0, 500.0, dtype=np.float64)
DEFAULT_DWELL_TIMES_S = np.array(
    [0.10, 0.10, 0.05, 0.05, 0.05, 0.05, 0.10, 0.10]
    + [0.05] * 9
    + [0.10, 0.10, 0.10]
    + [0.05] * 16,
    dtype=np.float64,
)


@dataclass(frozen=True)
class ReceiverPlan:
    centres_mhz: np.ndarray
    dwell_times_s: np.ndarray
    bandwidth_mhz: float
    source: str

    @property
    def band_count(self) -> int:
        return len(self.centres_mhz)

    @property
    def lows_mhz(self) -> np.ndarray:
        return self.centres_mhz - self.bandwidth_mhz / 2.0

    @property
    def highs_mhz(self) -> np.ndarray:
        return self.centres_mhz + self.bandwidth_mhz / 2.0


@dataclass(frozen=True)
class ScenarioData:
    scenario_id: str
    file_path: Path
    receiver_mode: str
    toa_s: np.ndarray
    frequency_mhz: np.ndarray
    emitter_id: np.ndarray
    band_id: np.ndarray
    receiver_plan: ReceiverPlan
    start_s: float
    end_s: float
    evaluation_slot_s: float


@dataclass
class BandState:
    visits: int = 0
    recent_hits: float = 0.0
    recent_misses: float = 0.0
    last_visit_s: float | None = None
    last_hit_s: float | None = None
    last_update_s: float = 0.0


@dataclass(frozen=True)
class SchedulerParams:
    hit_weight: float = 3.0
    miss_weight: float = 1.4
    stale_hit_weight: float = 1.0
    visit_weight: float = 1.8
    exploration_weight: float = 1.2
    memory_s: float = 2.0
    stale_hit_s: float = 4.0
    stale_visit_s: float = 2.15
    never_hit_bonus: float = 0.25
    force_explore_every: int = 8


def decode(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return [decode(item) for item in value.tolist()]
    return value


def attrs(group: h5py.Group) -> dict:
    return {key: decode(value) for key, value in group.attrs.items()}


def discover_h5_files(input_dirs: list[Path], pattern: str) -> list[Path]:
    files: list[Path] = []
    for directory in input_dirs:
        files.extend(directory.rglob(pattern))
    return sorted(set(path.resolve() for path in files))


def collect_input_files(input_dirs: list[Path] | None, input_files: list[Path] | None, pattern: str) -> list[Path]:
    files: list[Path] = []
    if input_dirs:
        files.extend(discover_h5_files(input_dirs, pattern))
    if input_files:
        files.extend(path.resolve() for path in input_files)
    return sorted(set(files))


def scenario_id_for(path: Path) -> str:
    return hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]


def feature_names(h5: h5py.File) -> list[str]:
    names = [decode(value) for value in h5["metadata/feature_names"][:]]
    missing = [name for name in REQUIRED_FEATURES if name not in names]
    if missing:
        raise ValueError(f"Missing required features {missing}")
    return names


def read_receiver_plan(h5: h5py.File, default_bandwidth_mhz: float) -> ReceiverPlan:
    receiver = h5["metadata/receiver"]
    receiver_attrs = attrs(receiver)
    bandwidth = float(receiver_attrs.get("bandwith_mhz", receiver_attrs.get("bandwidth_mhz", default_bandwidth_mhz)))
    centres = receiver["dwell_centres_mhz"][:].astype(np.float64)
    dwell_times = receiver["dwell_times_s"][:].astype(np.float64)

    if centres.size and dwell_times.size:
        return ReceiverPlan(
            centres_mhz=np.round(centres, 6),
            dwell_times_s=np.round(dwell_times, 6),
            bandwidth_mhz=bandwidth,
            source="file_metadata",
        )
    return ReceiverPlan(
        centres_mhz=DEFAULT_CENTRES_MHZ.copy(),
        dwell_times_s=DEFAULT_DWELL_TIMES_S.copy(),
        bandwidth_mhz=default_bandwidth_mhz,
        source="default_tsr_scan_plan",
    )


def inspect_scenario(path: Path, default_bandwidth_mhz: float) -> dict:
    with h5py.File(path, "r") as h5:
        receiver_attrs = attrs(h5["metadata/receiver"])
        labels = h5["labels"][:].reshape(-1)
        unique_labels = np.unique(labels)
        receiver_plan = read_receiver_plan(h5, default_bandwidth_mhz)
        data = h5["data"]
        names = feature_names(h5)
        toa_index = names.index("ToA")
        freq_index = names.index("Frequency")
        toa = data[:, toa_index]
        freq = data[:, freq_index]
        tx_count = len([key for key in h5["metadata/transmitters"].keys() if key.startswith("transmitters_")])
        metadata_attrs = attrs(h5["metadata"])
        freq_range = h5["metadata/receiver/freq_range_mhz"][:]
        return {
            "scenario_id": scenario_id_for(path),
            "file_name": path.name,
            "file_path": str(path),
            "file_size_bytes": path.stat().st_size,
            "receiver_mode": receiver_attrs.get("scan_mode", "unknown"),
            "pulse_count": int(data.shape[0]),
            "metadata_emitter_count": int(tx_count),
            "observed_emitter_count": int(len(unique_labels)),
            "label_min": int(unique_labels.min()) if len(unique_labels) else None,
            "label_max": int(unique_labels.max()) if len(unique_labels) else None,
            "freq_range_low_mhz": float(freq_range[0]),
            "freq_range_high_mhz": float(freq_range[1]),
            "observed_freq_min_mhz": float(np.nanmin(freq)) if len(freq) else None,
            "observed_freq_max_mhz": float(np.nanmax(freq)) if len(freq) else None,
            "duration_s": float((np.nanmax(toa) - np.nanmin(toa)) / 1_000_000.0) if len(toa) else 0.0,
            "collection_time_s": float(metadata_attrs.get("collection_time_s", np.nan)),
            "dwell_count": int(receiver_plan.band_count),
            "dwell_cycle_time_s": float(np.sum(receiver_plan.dwell_times_s)),
            "receiver_plan_source": receiver_plan.source,
        }


def make_splits(manifest: pd.DataFrame, ratios: tuple[float, float, float], seed: int) -> pd.DataFrame:
    if not np.isclose(sum(ratios), 1.0):
        raise ValueError("--split-ratios must sum to 1.0")

    rng = np.random.default_rng(seed)
    rows = []
    for mode, group in manifest.groupby("receiver_mode", dropna=False):
        ids = group["scenario_id"].to_numpy(copy=True)
        rng.shuffle(ids)
        n = len(ids)
        train_end = int(round(n * ratios[0]))
        val_end = train_end + int(round(n * ratios[1]))
        for index, scenario_id in enumerate(ids):
            split = "train" if index < train_end else "validation" if index < val_end else "test"
            rows.append({"scenario_id": scenario_id, "split": split, "receiver_mode": mode})
    result = pd.DataFrame(rows)
    if result["scenario_id"].duplicated().any():
        raise RuntimeError("A scenario appeared in more than one split.")
    return result


def force_splits(manifest: pd.DataFrame, split: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "scenario_id": manifest["scenario_id"],
            "split": split,
            "receiver_mode": manifest["receiver_mode"],
        }
    )


def assign_band_ids(frequency_mhz: np.ndarray, receiver_plan: ReceiverPlan) -> np.ndarray:
    band_ids = np.full(frequency_mhz.shape, -1, dtype=np.int16)
    for band_id, (low, high) in enumerate(zip(receiver_plan.lows_mhz, receiver_plan.highs_mhz)):
        mask = (frequency_mhz >= low) & (frequency_mhz < high)
        if band_id == receiver_plan.band_count - 1:
            mask = (frequency_mhz >= low) & (frequency_mhz <= high)
        band_ids[mask] = band_id
    return band_ids


def load_scenario(path: Path, default_bandwidth_mhz: float, evaluation_slot_s: float, max_duration_s: float | None) -> ScenarioData:
    with h5py.File(path, "r") as h5:
        names = feature_names(h5)
        indexes = {name: names.index(name) for name in REQUIRED_FEATURES}
        data = h5["data"][:]
        labels = h5["labels"][:].reshape(-1).astype(np.int32)
        receiver_mode = attrs(h5["metadata/receiver"]).get("scan_mode", "unknown")
        receiver_plan = read_receiver_plan(h5, default_bandwidth_mhz)

    toa_s = data[:, indexes["ToA"]].astype(np.float64) / 1_000_000.0
    frequency_mhz = data[:, indexes["Frequency"]].astype(np.float64)
    start_s = 0.0
    scenario_end = float(np.nanmax(toa_s)) if len(toa_s) else 0.0
    end_s = min(scenario_end, max_duration_s) if max_duration_s else scenario_end
    in_time = (toa_s >= start_s) & (toa_s < end_s)
    band_id = assign_band_ids(frequency_mhz[in_time], receiver_plan)
    in_band = band_id >= 0
    return ScenarioData(
        scenario_id=scenario_id_for(path),
        file_path=path,
        receiver_mode=receiver_mode,
        toa_s=toa_s[in_time][in_band],
        frequency_mhz=frequency_mhz[in_time][in_band],
        emitter_id=labels[in_time][in_band],
        band_id=band_id[in_band],
        receiver_plan=receiver_plan,
        start_s=start_s,
        end_s=end_s,
        evaluation_slot_s=evaluation_slot_s,
    )


def build_band_indexes(scenario: ScenarioData) -> list[dict]:
    indexes = []
    for band_id in range(scenario.receiver_plan.band_count):
        mask = scenario.band_id == band_id
        order = np.argsort(scenario.toa_s[mask])
        indexes.append({"toa_s": scenario.toa_s[mask][order], "emitter_id": scenario.emitter_id[mask][order]})
    return indexes


def observe_band(indexes: list[dict], band_id: int, start_s: float, end_s: float) -> dict:
    times = indexes[band_id]["toa_s"]
    emitters = indexes[band_id]["emitter_id"]
    left = int(np.searchsorted(times, start_s, side="left"))
    right = int(np.searchsorted(times, end_s, side="left"))
    observed = emitters[left:right]
    return {
        "hit": right > left,
        "pulse_count": int(right - left),
        "emitter_ids": tuple(int(value) for value in np.unique(observed)) if right > left else tuple(),
    }


def make_grid(scenario: ScenarioData) -> tuple[np.ndarray, np.ndarray]:
    slot_count = int(math.ceil((scenario.end_s - scenario.start_s) / scenario.evaluation_slot_s))
    pulse_grid = np.zeros((slot_count, scenario.receiver_plan.band_count), dtype=np.int32)
    slot_ids = np.floor((scenario.toa_s - scenario.start_s) / scenario.evaluation_slot_s).astype(np.int32)
    valid = (slot_ids >= 0) & (slot_ids < slot_count)
    np.add.at(pulse_grid, (slot_ids[valid], scenario.band_id[valid]), 1)
    return pulse_grid > 0, pulse_grid


def covered_slots(start_s: float, end_s: float, scenario: ScenarioData) -> range:
    if end_s <= start_s:
        return range(0, 0)
    eps = 1e-6
    slot_count = int(math.ceil((scenario.end_s - scenario.start_s) / scenario.evaluation_slot_s))
    first = int(math.floor(((start_s - scenario.start_s) + eps) / scenario.evaluation_slot_s))
    last = int(math.floor(((end_s - scenario.start_s) - eps) / scenario.evaluation_slot_s))
    first = max(0, min(first, slot_count))
    last = max(-1, min(last, slot_count - 1))
    if last < first:
        return range(0, 0)
    return range(first, last + 1)


def decay(state: BandState, now_s: float, memory_s: float) -> tuple[float, float]:
    factor = math.exp(-max(0.0, now_s - state.last_update_s) / memory_s) if memory_s > 0 else 0.0
    return state.recent_hits * factor, state.recent_misses * factor


def priority(state: BandState, now_s: float, params: SchedulerParams) -> float:
    recent_hits, recent_misses = decay(state, now_s, params.memory_s)
    hit_stale = params.never_hit_bonus if state.last_hit_s is None else min((now_s - state.last_hit_s) / params.stale_hit_s, 1.0)
    visit_stale = 1.0 if state.last_visit_s is None else min((now_s - state.last_visit_s) / params.stale_visit_s, 1.0)
    explore = 1.0 / math.sqrt(state.visits + 1.0)
    return (
        params.hit_weight * recent_hits
        - params.miss_weight * recent_misses
        + params.stale_hit_weight * hit_stale
        + params.visit_weight * visit_stale
        + params.exploration_weight * explore
    )


def choose_adaptive(states: list[BandState], now_s: float, step: int, params: SchedulerParams) -> int:
    if params.force_explore_every > 0 and step > 0 and step % params.force_explore_every == 0:
        candidates = [(state.visits, -1.0 if state.last_visit_s is None else state.last_visit_s, band_id) for band_id, state in enumerate(states)]
        candidates.sort()
        return int(candidates[0][2])
    scores = [(priority(state, now_s, params), band_id) for band_id, state in enumerate(states)]
    scores.sort(key=lambda item: (-item[0], item[1]))
    return int(scores[0][1])


def update_state(state: BandState, now_s: float, hit: bool, params: SchedulerParams) -> None:
    recent_hits, recent_misses = decay(state, now_s, params.memory_s)
    state.recent_hits = recent_hits + (1.0 if hit else 0.0)
    state.recent_misses = recent_misses + (0.0 if hit else 1.0)
    state.last_update_s = now_s
    state.last_visit_s = now_s
    state.visits += 1
    if hit:
        state.last_hit_s = now_s


def run_scheduler(scenario: ScenarioData, name: str, params: SchedulerParams) -> pd.DataFrame:
    indexes = build_band_indexes(scenario)
    active_grid, pulse_grid = make_grid(scenario)
    states = [BandState(last_update_s=scenario.start_s) for _ in range(scenario.receiver_plan.band_count)]
    now_s = scenario.start_s
    step = 0
    rows = []
    while now_s < scenario.end_s - 1e-12:
        band_id = step % scenario.receiver_plan.band_count if name == "sequential" else choose_adaptive(states, now_s, step, params)
        dwell_s = float(scenario.receiver_plan.dwell_times_s[band_id])
        end_s = min(now_s + dwell_s, scenario.end_s)
        obs = observe_band(indexes, band_id, now_s, end_s)
        update_state(states[band_id], now_s, obs["hit"], params)
        slots = list(covered_slots(now_s, end_s, scenario))
        cells = int(active_grid[slots, band_id].sum()) if slots else 0
        pulses = int(pulse_grid[slots, band_id].sum()) if slots else 0
        rows.append(
            {
                "scenario_id": scenario.scenario_id,
                "scheduler": name,
                "scan_id": step,
                "start_s": now_s,
                "end_s": end_s,
                "selected_band_id": band_id,
                "outcome": "HIT" if obs["hit"] else "MISS",
                "pulse_count_observed": obs["pulse_count"],
                "active_cells_intercepted": cells,
                "pulses_intercepted": pulses,
                "emitter_ids_observed": " ".join(str(value) for value in obs["emitter_ids"]),
            }
        )
        now_s = end_s
        step += 1
    return pd.DataFrame(rows)


def build_episodes(scenario: ScenarioData) -> pd.DataFrame:
    slot_count = int(math.ceil((scenario.end_s - scenario.start_s) / scenario.evaluation_slot_s))
    slot_ids = np.floor((scenario.toa_s - scenario.start_s) / scenario.evaluation_slot_s).astype(np.int32)
    cells = pd.DataFrame({"emitter_id": scenario.emitter_id, "band_id": scenario.band_id, "slot_id": slot_ids})
    cells = cells[(cells["slot_id"] >= 0) & (cells["slot_id"] < slot_count)].drop_duplicates()
    rows = []
    episode_id = 0
    for (emitter_id, band_id), group in cells.groupby(["emitter_id", "band_id"]):
        slots = np.sort(group["slot_id"].to_numpy(dtype=np.int32))
        breaks = np.where(np.diff(slots) > 1)[0] + 1
        for part in np.split(slots, breaks):
            rows.append({"episode_id": episode_id, "emitter_id": int(emitter_id), "band_id": int(band_id), "start_slot": int(part[0]), "end_slot": int(part[-1])})
            episode_id += 1
    return pd.DataFrame(rows)


def episode_results(scenario: ScenarioData, decisions: pd.DataFrame, scheduler: str) -> pd.DataFrame:
    episodes = build_episodes(scenario)
    selected = set()
    for _, row in decisions.iterrows():
        for slot_id in covered_slots(float(row["start_s"]), float(row["end_s"]), scenario):
            selected.add((slot_id, int(row["selected_band_id"])))
    rows = []
    for _, ep in episodes.iterrows():
        hit_slot = None
        for slot_id in range(int(ep["start_slot"]), int(ep["end_slot"]) + 1):
            if (slot_id, int(ep["band_id"])) in selected:
                hit_slot = slot_id
                break
        rows.append(
            {
                "scenario_id": scenario.scenario_id,
                "scheduler": scheduler,
                "episode_id": int(ep["episode_id"]),
                "intercepted": hit_slot is not None,
                "delay_s": None if hit_slot is None else (hit_slot - int(ep["start_slot"])) * scenario.evaluation_slot_s,
            }
        )
    return pd.DataFrame(rows)


def metrics_for(scenario: ScenarioData, decisions: pd.DataFrame, episodes: pd.DataFrame) -> dict:
    active_grid, pulse_grid = make_grid(scenario)
    observed_emitters = set()
    for text in decisions["emitter_ids_observed"]:
        if isinstance(text, str) and text.strip():
            observed_emitters.update(int(value) for value in text.split())
    intercepted = episodes[episodes["intercepted"]]
    hits = int((decisions["outcome"] == "HIT").sum())
    scans = int(len(decisions))
    total_emitters = int(np.unique(scenario.emitter_id).size)
    return {
        "scenario_id": scenario.scenario_id,
        "file_name": scenario.file_path.name,
        "receiver_mode": scenario.receiver_mode,
        "scheduler": str(decisions["scheduler"].iloc[0]),
        "total_scans": scans,
        "hits": hits,
        "misses": scans - hits,
        "hit_rate": hits / scans if scans else 0.0,
        "active_cells": int(active_grid.sum()),
        "active_cell_interception_rate": float(decisions["active_cells_intercepted"].sum() / active_grid.sum()) if active_grid.sum() else 0.0,
        "emitter_coverage": len(observed_emitters) / total_emitters if total_emitters else 0.0,
        "pulse_weighted_interception": float(decisions["pulses_intercepted"].sum() / len(scenario.toa_s)) if len(scenario.toa_s) else 0.0,
        "average_interception_delay_s": float(intercepted["delay_s"].mean()) if not intercepted.empty else np.nan,
        "missed_episodes": int((~episodes["intercepted"]).sum()) if not episodes.empty else 0,
        "total_episodes": int(len(episodes)),
    }


def estimate_resources(manifest: pd.DataFrame) -> dict:
    total_bytes = int(manifest["file_size_bytes"].sum()) if not manifest.empty else 0
    total_pulses = int(manifest["pulse_count"].sum()) if not manifest.empty else 0
    return {
        "selected_files": int(len(manifest)),
        "input_disk_gb": total_bytes / 1e9,
        "total_pulses": total_pulses,
        "approx_raw_numeric_ram_gb": total_pulses * 6 * 8 / 1e9,
        "recommended_ram_gb": max(8.0, total_pulses * 6 * 8 / 1e9 * 3.0),
    }


def add_sparse_flags(
    manifest: pd.DataFrame,
    metrics: pd.DataFrame,
    min_pulses: int,
    min_emitters: int,
    min_active_cells: int,
) -> pd.DataFrame:
    flags = manifest[
        [
            "scenario_id",
            "file_name",
            "receiver_mode",
            "pulse_count",
            "observed_emitter_count",
            "duration_s",
            "split",
        ]
    ].copy()
    active = metrics.groupby("scenario_id")["active_cells"].max().reset_index()
    flags = flags.merge(active, on="scenario_id", how="left")
    flags["active_cells"] = flags["active_cells"].fillna(0).astype(int)
    flags["sparse_by_pulse_count"] = flags["pulse_count"] < min_pulses
    flags["sparse_by_emitter_count"] = flags["observed_emitter_count"] < min_emitters
    flags["sparse_by_active_cells"] = flags["active_cells"] < min_active_cells
    flags["is_sparse"] = flags[
        ["sparse_by_pulse_count", "sparse_by_emitter_count", "sparse_by_active_cells"]
    ].any(axis=1)

    reasons = []
    for _, row in flags.iterrows():
        row_reasons = []
        if row["sparse_by_pulse_count"]:
            row_reasons.append(f"pulse_count<{min_pulses}")
        if row["sparse_by_emitter_count"]:
            row_reasons.append(f"observed_emitters<{min_emitters}")
        if row["sparse_by_active_cells"]:
            row_reasons.append(f"active_cells<{min_active_cells}")
        reasons.append("; ".join(row_reasons))
    flags["sparse_reason"] = reasons
    return flags


def draw_distribution(path: Path, metrics: pd.DataFrame, metric: str) -> None:
    width, height = 900, 520
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font = get_font(13)
    draw.text((55, 24), f"Distribution: {metric}", fill=(25, 25, 25), font=get_font(18))
    box = (80, 80, 820, 410)
    draw.rectangle(box, outline=(80, 80, 80), width=1)
    schedulers = ["sequential", "adaptive"]
    colors = {"sequential": (60, 100, 170), "adaptive": (130, 45, 170)}
    values = metrics[metric].dropna()
    if values.empty:
        image.save(path)
        return
    lo, hi = float(values.min()), float(values.max())
    if np.isclose(lo, hi):
        hi = lo + 1.0
    for s_idx, scheduler in enumerate(schedulers):
        subset = metrics[metrics["scheduler"] == scheduler][metric].dropna().to_numpy()
        y = box[1] + 110 + s_idx * 95
        draw.text((box[0], y - 38), scheduler, fill=(25, 25, 25), font=font)
        for value in subset:
            x = int(box[0] + (float(value) - lo) / (hi - lo) * (box[2] - box[0]))
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=colors[scheduler])
        if subset.size:
            mean_x = int(box[0] + (float(np.mean(subset)) - lo) / (hi - lo) * (box[2] - box[0]))
            draw.line((mean_x, y - 22, mean_x, y + 22), fill=(30, 30, 30), width=2)
    draw.text((box[0], box[3] + 20), f"min {lo:.3g}", fill=(25, 25, 25), font=font)
    draw.text((box[2] - 80, box[3] + 20), f"max {hi:.3g}", fill=(25, 25, 25), font=font)
    image.save(path)


def get_font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def aggregate_metrics(metrics: pd.DataFrame) -> pd.DataFrame:
    metric_cols = ["hit_rate", "emitter_coverage", "average_interception_delay_s", "active_cell_interception_rate", "pulse_weighted_interception", "missed_episodes", "active_cells"]
    rows = []
    for scheduler, group in metrics.groupby("scheduler"):
        row = {"scheduler": scheduler, "scenario_count": len(group)}
        for col in metric_cols:
            row[f"{col}_mean"] = float(group[col].mean())
            row[f"{col}_median"] = float(group[col].median())
            row[f"{col}_std"] = float(group[col].std(ddof=0))
        rows.append(row)
    return pd.DataFrame(rows)


def aggregate_metrics_by_mode(metrics: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (mode, scheduler), group in metrics.groupby(["receiver_mode", "scheduler"]):
        row = {"receiver_mode": mode, "scheduler": scheduler, "scenario_count": len(group)}
        for col in ["hit_rate", "emitter_coverage", "average_interception_delay_s", "active_cell_interception_rate", "pulse_weighted_interception", "missed_episodes", "active_cells"]:
            row[f"{col}_mean"] = float(group[col].mean())
            row[f"{col}_median"] = float(group[col].median())
        rows.append(row)
    return pd.DataFrame(rows)


def scheduler_deltas(metrics: pd.DataFrame) -> pd.DataFrame:
    adaptive = metrics[metrics["scheduler"] == "adaptive"].copy()
    sequential = metrics[metrics["scheduler"] == "sequential"].copy()
    if adaptive.empty or sequential.empty:
        return pd.DataFrame()
    merged = adaptive.merge(sequential, on="scenario_id", suffixes=("_adaptive", "_sequential"))
    rows = merged[
        [
            "scenario_id",
            "file_name_adaptive",
            "receiver_mode_adaptive",
            "split_adaptive",
            "is_sparse_adaptive",
            "sparse_reason_adaptive",
        ]
    ].rename(
        columns={
            "file_name_adaptive": "file_name",
            "receiver_mode_adaptive": "receiver_mode",
            "split_adaptive": "split",
            "is_sparse_adaptive": "is_sparse",
            "sparse_reason_adaptive": "sparse_reason",
        }
    )
    for col in [
        "hit_rate",
        "emitter_coverage",
        "average_interception_delay_s",
        "active_cell_interception_rate",
        "pulse_weighted_interception",
        "missed_episodes",
    ]:
        rows[f"{col}_adaptive_minus_sequential"] = merged[f"{col}_adaptive"] - merged[f"{col}_sequential"]
    return rows


def write_reports(
    output_dir: Path,
    manifest: pd.DataFrame,
    metrics: pd.DataFrame,
    sparse_flags: pd.DataFrame,
    resources: dict,
) -> None:
    aggregate = aggregate_metrics(metrics)
    non_sparse_ids = set(sparse_flags.loc[~sparse_flags["is_sparse"], "scenario_id"])
    non_sparse_metrics = metrics[metrics["scenario_id"].isin(non_sparse_ids)].copy()
    aggregate_non_sparse = aggregate_metrics(non_sparse_metrics) if not non_sparse_metrics.empty else pd.DataFrame()
    seq = aggregate[aggregate["scheduler"] == "sequential"]
    ada = aggregate[aggregate["scheduler"] == "adaptive"]
    sparse_count = int(sparse_flags["is_sparse"].sum()) if not sparse_flags.empty else 0
    lines = [
        "# Adaptive V1 Multi-Scenario Consistency Report",
        "",
        "No machine learning was implemented.",
        "",
        f"Scenarios processed: {len(manifest)}.",
        f"Sparse scenarios flagged separately: {sparse_count}.",
        "",
        "Each `.h5` file was processed independently; scheduler state resets between files.",
        "Files can be forced into TEST for holdout evaluation; no training or parameter tuning is performed by this script.",
        "",
        "## Aggregate Metrics",
        "",
        aggregate.to_csv(index=False),
        "",
        "## Aggregate Metrics Excluding Sparse Scenarios",
        "",
        aggregate_non_sparse.to_csv(index=False) if not aggregate_non_sparse.empty else "No non-sparse scenarios available.",
        "",
        "## Aggregate Metrics By Receiver Mode",
        "",
        aggregate_metrics_by_mode(metrics).to_csv(index=False),
        "",
        "## Sparse Scenario Flags",
        "",
        sparse_flags.to_csv(index=False),
        "",
        "## Adaptive Minus Sequential Deltas",
        "",
        scheduler_deltas(metrics).to_csv(index=False),
        "",
    ]
    if not seq.empty and not ada.empty:
        lines.extend([
            "## Pattern Check",
            "",
            f"Mean sequential hit rate: {seq.iloc[0]['hit_rate_mean']:.3f}; mean adaptive hit rate: {ada.iloc[0]['hit_rate_mean']:.3f}.",
            f"Mean sequential emitter coverage: {seq.iloc[0]['emitter_coverage_mean']:.3f}; mean adaptive emitter coverage: {ada.iloc[0]['emitter_coverage_mean']:.3f}.",
            f"Mean sequential delay: {seq.iloc[0]['average_interception_delay_s_mean']:.3f}; mean adaptive delay: {ada.iloc[0]['average_interception_delay_s_mean']:.3f}.",
            "",
            "Compare the full aggregate with the non-sparse aggregate before drawing conclusions. Sparse scenarios are useful edge cases, but they should not dominate claims about typical scheduler behavior.",
        ])
    (output_dir / "adaptive_consistency_report.md").write_text("\n".join(lines), encoding="utf-8")

    resource_lines = [
        "# Resource Estimate",
        "",
        f"Selected files: {resources['selected_files']}",
        f"Input disk footprint: {resources['input_disk_gb']:.3f} GB",
        f"Total pulses: {resources['total_pulses']:,}",
        f"Approx raw numeric RAM: {resources['approx_raw_numeric_ram_gb']:.3f} GB",
        f"Recommended RAM for this run: {resources['recommended_ram_gb']:.1f} GB",
        "",
        "Rule of thumb before downloading: Stare files are much larger than Scan files. Start with 50 Stare training scenarios plus 10 validation and 10 test Stare scenarios, then scale once runtime is comfortable.",
    ]
    (output_dir / "resource_estimate.md").write_text("\n".join(resource_lines), encoding="utf-8")

    download_lines = [
        "# Download Recommendations For Next Stage",
        "",
        "Download from the official TSRD Hugging Face dataset after accepting its access terms.",
        "",
        "For scheduler development, prioritize Stare-mode files because they are the closest available full RF activity references:",
        "",
        "1. `stare/train_stare/*.h5`: first 50 sorted files.",
        "2. `stare/validation_stare/*.h5`: first 10 sorted files.",
        "3. `stare/test_stare/*.h5`: first 10 sorted files.",
        "",
        "Also download a small Scanning subset for receiver-metadata checks and comparisons:",
        "",
        "4. `scan/train_scan/*.h5`: first 10 sorted files.",
        "5. `scan/validation_scan/*.h5`: first 5 sorted files.",
        "6. `scan/test_scan/*.h5`: first 5 sorted files.",
        "",
        "Official downloader equivalent when you are ready for full directories:",
        "",
        "```python",
        "from pathlib import Path",
        "from turing_deinterleaving_challenge import download_dataset",
        "download_dataset(save_dir=Path('data/tsrd'), subsets=['train', 'validation', 'test'], modes=['stare'])",
        "download_dataset(save_dir=Path('data/tsrd'), subsets=['train', 'validation', 'test'], modes=['scan'])",
        "```",
        "",
        "Do not download the full TSRD yet unless you have at least 100 GB free and enough time. The public dataset card lists 70 GB total file size and about 4 billion pulses.",
    ]
    (output_dir / "download_recommendations.md").write_text("\n".join(download_lines), encoding="utf-8")


def run(args: argparse.Namespace) -> None:
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    viz_dir = output_dir / "visualizations"
    viz_dir.mkdir(parents=True, exist_ok=True)
    files = collect_input_files(args.input_dirs, args.input_files, args.pattern)
    if args.max_scenarios:
        files = files[: args.max_scenarios]
    if not files:
        raise ValueError("No .h5 files discovered.")

    manifest = pd.DataFrame([inspect_scenario(path, args.bandwidth_mhz) for path in files])
    if args.receiver_modes:
        requested_modes = {mode.lower() for mode in args.receiver_modes}
        manifest = manifest[manifest["receiver_mode"].str.lower().isin(requested_modes)].copy()
        files = [Path(path) for path in manifest["file_path"]]
        if manifest.empty:
            raise ValueError(f"No scenarios matched requested receiver modes: {args.receiver_modes}")
    if args.force_split:
        splits = force_splits(manifest, args.force_split)
    else:
        splits = make_splits(manifest, tuple(args.split_ratios), args.split_seed)
    manifest = manifest.merge(splits[["scenario_id", "split"]], on="scenario_id", how="left")
    manifest.to_csv(output_dir / "scenario_manifest.csv", index=False)
    splits.to_csv(output_dir / "scenario_splits.csv", index=False)

    params = SchedulerParams(
        hit_weight=args.hit_weight,
        miss_weight=args.miss_weight,
        stale_hit_weight=args.stale_hit_weight,
        visit_weight=args.visit_weight,
        exploration_weight=args.exploration_weight,
        memory_s=args.memory_s,
        stale_hit_s=args.stale_hit_s,
        stale_visit_s=args.stale_visit_s,
        never_hit_bonus=args.never_hit_bonus,
        force_explore_every=args.force_explore_every,
    )

    all_metrics = []
    band_distributions = []
    for path in files:
        scenario = load_scenario(path, args.bandwidth_mhz, args.evaluation_slot_s, args.max_duration_s)
        for scheduler in ["sequential", "adaptive"]:
            decisions = run_scheduler(scenario, scheduler, params)
            episodes = episode_results(scenario, decisions, scheduler)
            metric = metrics_for(scenario, decisions, episodes)
            metric["split"] = manifest.loc[manifest["scenario_id"] == scenario.scenario_id, "split"].iloc[0]
            all_metrics.append(metric)
            grouped = decisions.groupby("selected_band_id").agg(scan_count=("scan_id", "size"), hit_count=("outcome", lambda x: int((x == "HIT").sum()))).reset_index()
            grouped["scenario_id"] = scenario.scenario_id
            grouped["scheduler"] = scheduler
            band_distributions.append(grouped)

    metrics = pd.DataFrame(all_metrics)
    sparse_flags = add_sparse_flags(
        manifest,
        metrics,
        args.sparse_min_pulses,
        args.sparse_min_emitters,
        args.sparse_min_active_cells,
    )
    metrics = metrics.merge(sparse_flags[["scenario_id", "is_sparse", "sparse_reason"]], on="scenario_id", how="left")
    metrics.to_csv(output_dir / "per_scenario_metrics.csv", index=False)
    aggregate = aggregate_metrics(metrics)
    aggregate.to_csv(output_dir / "aggregate_metrics.csv", index=False)
    non_sparse_metrics = metrics[~metrics["is_sparse"]].copy()
    if not non_sparse_metrics.empty:
        aggregate_metrics(non_sparse_metrics).to_csv(output_dir / "aggregate_metrics_non_sparse.csv", index=False)
    else:
        pd.DataFrame().to_csv(output_dir / "aggregate_metrics_non_sparse.csv", index=False)
    aggregate_metrics_by_mode(metrics).to_csv(output_dir / "aggregate_metrics_by_receiver_mode.csv", index=False)
    sparse_flags.to_csv(output_dir / "sparse_scenario_flags.csv", index=False)
    scheduler_deltas(metrics).to_csv(output_dir / "adaptive_vs_sequential_deltas.csv", index=False)
    pd.concat(band_distributions, ignore_index=True).to_csv(output_dir / "band_scan_distribution_by_scenario.csv", index=False)
    resources = estimate_resources(manifest)
    Path(output_dir / "resource_estimate.json").write_text(json.dumps(resources, indent=2), encoding="utf-8")
    write_reports(output_dir, manifest, metrics, sparse_flags, resources)

    for metric in ["hit_rate", "emitter_coverage", "average_interception_delay_s", "active_cell_interception_rate", "pulse_weighted_interception"]:
        draw_distribution(viz_dir / f"{metric}_distribution.png", metrics, metric)
    print(json.dumps({"scenarios": len(manifest), "metrics_rows": len(metrics), "resources": resources}, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Sequential and Adaptive V1 across independent TSRD scenarios.")
    parser.add_argument("--input-dirs", nargs="*", type=Path, default=None)
    parser.add_argument("--input-files", nargs="*", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--pattern", default="*.h5")
    parser.add_argument("--max-scenarios", type=int, default=None)
    parser.add_argument("--receiver-modes", nargs="*", default=None, help="Optional receiver modes to include, e.g. Stare Scanning.")
    parser.add_argument("--split-ratios", nargs=3, type=float, default=[0.7, 0.15, 0.15])
    parser.add_argument("--split-seed", type=int, default=7)
    parser.add_argument("--force-split", choices=["train", "validation", "test"], default=None, help="Assign every selected scenario to one split.")
    parser.add_argument("--sparse-min-pulses", type=int, default=10000)
    parser.add_argument("--sparse-min-emitters", type=int, default=3)
    parser.add_argument("--sparse-min-active-cells", type=int, default=50)
    parser.add_argument("--bandwidth-mhz", type=float, default=500.0)
    parser.add_argument("--evaluation-slot-s", type=float, default=0.05)
    parser.add_argument("--max-duration-s", type=float, default=None)
    parser.add_argument("--hit-weight", type=float, default=3.0)
    parser.add_argument("--miss-weight", type=float, default=1.4)
    parser.add_argument("--stale-hit-weight", type=float, default=1.0)
    parser.add_argument("--visit-weight", type=float, default=1.8)
    parser.add_argument("--exploration-weight", type=float, default=1.2)
    parser.add_argument("--memory-s", type=float, default=2.0)
    parser.add_argument("--stale-hit-s", type=float, default=4.0)
    parser.add_argument("--stale-visit-s", type=float, default=2.15)
    parser.add_argument("--never-hit-bonus", type=float, default=0.25)
    parser.add_argument("--force-explore-every", type=int, default=8)
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
