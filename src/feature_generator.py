from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
for fallback_name in ["h5runtime2", "h5runtime", "h5reader"]:
    fallback = WORKSPACE_ROOT / "work" / fallback_name
    if fallback.exists():
        sys.path.insert(0, str(fallback))

sys.path.insert(0, str(WORKSPACE_ROOT / "outputs" / "tsrd_multi_scenario_pipeline"))
import multi_scenario_pipeline as tsrd  # noqa: E402


FEATURE_NAMES = [
    "candidate_band_id",
    "candidate_band_center_mhz",
    "candidate_band_low_mhz",
    "candidate_band_high_mhz",
    "candidate_dwell_time_s",
    "elapsed_s",
    "elapsed_fraction",
    "decision_index",
    "time_since_band_last_visited_s",
    "band_never_visited",
    "time_since_last_hit_s",
    "band_never_hit",
    "recent_hit_count",
    "recent_miss_count",
    "recent_hit_rate",
    "recent_observed_pulse_score",
    "consecutive_misses",
    "number_of_visits",
    "number_of_hits",
    "number_of_misses",
    "last_observed_pulse_count",
    "was_last_band_observation_hit",
    "short_window_visit_count",
    "short_window_hit_count",
    "short_window_miss_count",
    "short_window_hit_rate",
    "short_window_observed_pulses",
    "previous_scan_was_hit",
    "previous_scan_band_id",
    "previous_scan_pulse_count",
]


FEATURE_DEFINITIONS = {
    "candidate_band_id": "Integer ID of the candidate frequency band, 0 to 35.",
    "candidate_band_center_mhz": "Center frequency of the candidate band in MHz.",
    "candidate_band_low_mhz": "Lower edge of the 500 MHz candidate band.",
    "candidate_band_high_mhz": "Upper edge of the 500 MHz candidate band.",
    "candidate_dwell_time_s": "How long the receiver would dwell if it selected this band.",
    "elapsed_s": "Scenario time at the decision, measured from the start.",
    "elapsed_fraction": "elapsed_s divided by the scenario duration.",
    "decision_index": "Sequential index of the receiver decision in this scenario.",
    "time_since_band_last_visited_s": "Seconds since this band was last scanned; sentinel value if never visited.",
    "band_never_visited": "1 if this band has never been scanned before this decision.",
    "time_since_last_hit_s": "Seconds since the most recent HIT in this band; sentinel value if never hit.",
    "band_never_hit": "1 if this band has never produced a HIT before this decision.",
    "recent_hit_count": "Exponentially decayed count of prior HIT observations in this band.",
    "recent_miss_count": "Exponentially decayed count of prior MISS observations in this band.",
    "recent_hit_rate": "recent_hit_count / (recent_hit_count + recent_miss_count), or 0 with no history.",
    "recent_observed_pulse_score": "Exponentially decayed count of pulses previously observed in this band.",
    "consecutive_misses": "Number of consecutive MISS observations for this band.",
    "number_of_visits": "How many times this band has been scanned before this decision.",
    "number_of_hits": "How many prior scans of this band were HITs.",
    "number_of_misses": "How many prior scans of this band were MISSes.",
    "last_observed_pulse_count": "Pulse count from the most recent scan of this band.",
    "was_last_band_observation_hit": "1 if the most recent scan of this band was a HIT.",
    "short_window_visit_count": "Number of scans of this band in the recent time window.",
    "short_window_hit_count": "Number of HITs for this band in the recent time window.",
    "short_window_miss_count": "Number of MISSes for this band in the recent time window.",
    "short_window_hit_rate": "short_window_hit_count / short_window_visit_count, or 0 with no visits.",
    "short_window_observed_pulses": "Total pulses observed in recent scans of this band.",
    "previous_scan_was_hit": "Previous scan result globally: 1 HIT, 0 MISS, -1 no previous scan.",
    "previous_scan_band_id": "Band selected by the previous scan, or -1 for no previous scan.",
    "previous_scan_pulse_count": "Observed pulse count from the previous scan, or 0 before any scan.",
}


TARGET_DEFINITIONS = {
    "target_would_hit": "Binary target: 1 if scanning this candidate band now would observe at least one pulse.",
    "target_pulse_count": "Number of pulses that would be observed by scanning this candidate band now.",
    "target_new_emitter": "1 if the scan would observe at least one emitter label not previously observed by the receiver in this scenario.",
}


@dataclass
class ObservableBandHistory:
    visits: int = 0
    hits: int = 0
    misses: int = 0
    consecutive_misses: int = 0
    last_visit_s: float | None = None
    last_hit_s: float | None = None
    last_update_s: float = 0.0
    recent_hits: float = 0.0
    recent_misses: float = 0.0
    recent_pulses: float = 0.0
    last_observed_pulse_count: int = 0
    last_observation_hit: int = 0
    recent_events: deque[tuple[float, int, int]] = field(default_factory=deque)


def sha1_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def split_file_paths(args: argparse.Namespace) -> dict[str, list[Path]]:
    paths = {
        "train": [path.resolve() for path in args.train_files],
        "validation": [path.resolve() for path in args.validation_files],
    }
    if args.test_files:
        paths["test"] = [path.resolve() for path in args.test_files]
    return paths


def build_manifest(split_paths: dict[str, list[Path]], bandwidth_mhz: float) -> pd.DataFrame:
    rows = []
    for split, paths in split_paths.items():
        for path in paths:
            item = tsrd.inspect_scenario(path, bandwidth_mhz)
            item["split"] = split
            item["content_sha1"] = sha1_file(path)
            rows.append(item)
    manifest = pd.DataFrame(rows)
    if manifest.empty:
        raise ValueError("No scenarios were provided.")
    duplicate_paths = manifest[manifest["file_path"].duplicated(keep=False)]
    if not duplicate_paths.empty:
        raise ValueError(f"The same file path appears in more than one split:\n{duplicate_paths[['file_name', 'split', 'file_path']]}")
    duplicate_content = manifest[manifest["content_sha1"].duplicated(keep=False)]
    if not duplicate_content.empty:
        raise ValueError(
            "At least one identical file appears in multiple rows. This would leak scenarios across splits:\n"
            + duplicate_content[["file_name", "split", "content_sha1"]].to_string(index=False)
        )
    return manifest


def decayed_values(history: ObservableBandHistory, now_s: float, memory_s: float) -> tuple[float, float, float]:
    if memory_s <= 0:
        return 0.0, 0.0, 0.0
    factor = math.exp(-max(0.0, now_s - history.last_update_s) / memory_s)
    return history.recent_hits * factor, history.recent_misses * factor, history.recent_pulses * factor


def trim_recent_events(history: ObservableBandHistory, now_s: float, window_s: float) -> None:
    cutoff = now_s - window_s
    while history.recent_events and history.recent_events[0][0] < cutoff:
        history.recent_events.popleft()


def short_window_values(history: ObservableBandHistory, now_s: float, window_s: float) -> tuple[int, int, int, int]:
    trim_recent_events(history, now_s, window_s)
    visits = len(history.recent_events)
    hits = sum(1 for _, hit, _ in history.recent_events if hit)
    misses = visits - hits
    pulses = sum(pulses for _, _, pulses in history.recent_events)
    return visits, hits, misses, pulses


def candidate_features(
    scenario: tsrd.ScenarioData,
    histories: list[ObservableBandHistory],
    now_s: float,
    decision_index: int,
    previous_scan_was_hit: int,
    previous_scan_band_id: int,
    previous_scan_pulse_count: int,
    memory_s: float,
    short_window_s: float,
    never_seen_sentinel_s: float,
) -> np.ndarray:
    rows = []
    duration_s = max(scenario.end_s - scenario.start_s, 1e-9)
    for band_id, history in enumerate(histories):
        recent_hits, recent_misses, recent_pulses = decayed_values(history, now_s, memory_s)
        recent_total = recent_hits + recent_misses
        short_visits, short_hits, short_misses, short_pulses = short_window_values(history, now_s, short_window_s)
        time_since_visit = never_seen_sentinel_s if history.last_visit_s is None else now_s - history.last_visit_s
        time_since_hit = never_seen_sentinel_s if history.last_hit_s is None else now_s - history.last_hit_s
        rows.append(
            [
                float(band_id),
                float(scenario.receiver_plan.centres_mhz[band_id]),
                float(scenario.receiver_plan.lows_mhz[band_id]),
                float(scenario.receiver_plan.highs_mhz[band_id]),
                float(scenario.receiver_plan.dwell_times_s[band_id]),
                float(now_s),
                float(now_s / duration_s),
                float(decision_index),
                float(time_since_visit),
                float(history.last_visit_s is None),
                float(time_since_hit),
                float(history.last_hit_s is None),
                float(recent_hits),
                float(recent_misses),
                float(recent_hits / recent_total) if recent_total > 0 else 0.0,
                float(recent_pulses),
                float(history.consecutive_misses),
                float(history.visits),
                float(history.hits),
                float(history.misses),
                float(history.last_observed_pulse_count),
                float(history.last_observation_hit),
                float(short_visits),
                float(short_hits),
                float(short_misses),
                float(short_hits / short_visits) if short_visits else 0.0,
                float(short_pulses),
                float(previous_scan_was_hit),
                float(previous_scan_band_id),
                float(previous_scan_pulse_count),
            ]
        )
    return np.asarray(rows, dtype=np.float32)


def candidate_targets(
    scenario: tsrd.ScenarioData,
    indexes: list[dict],
    now_s: float,
    seen_emitters: set[int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    hit_targets = np.zeros(scenario.receiver_plan.band_count, dtype=np.uint8)
    pulse_targets = np.zeros(scenario.receiver_plan.band_count, dtype=np.int32)
    new_emitter_targets = np.zeros(scenario.receiver_plan.band_count, dtype=np.uint8)
    for band_id in range(scenario.receiver_plan.band_count):
        dwell_s = float(scenario.receiver_plan.dwell_times_s[band_id])
        end_s = min(now_s + dwell_s, scenario.end_s)
        obs = tsrd.observe_band(indexes, band_id, now_s, end_s)
        hit_targets[band_id] = 1 if obs["hit"] else 0
        pulse_targets[band_id] = int(obs["pulse_count"])
        new_emitter_targets[band_id] = 1 if any(emitter not in seen_emitters for emitter in obs["emitter_ids"]) else 0
    return hit_targets, pulse_targets, new_emitter_targets


def update_observable_history(
    history: ObservableBandHistory,
    now_s: float,
    hit: bool,
    pulse_count: int,
    memory_s: float,
) -> None:
    recent_hits, recent_misses, recent_pulses = decayed_values(history, now_s, memory_s)
    history.recent_hits = recent_hits + (1.0 if hit else 0.0)
    history.recent_misses = recent_misses + (0.0 if hit else 1.0)
    history.recent_pulses = recent_pulses + float(pulse_count)
    history.last_update_s = now_s
    history.last_visit_s = now_s
    history.visits += 1
    history.last_observed_pulse_count = int(pulse_count)
    history.last_observation_hit = 1 if hit else 0
    history.recent_events.append((now_s, 1 if hit else 0, int(pulse_count)))
    if hit:
        history.hits += 1
        history.consecutive_misses = 0
        history.last_hit_s = now_s
    else:
        history.misses += 1
        history.consecutive_misses += 1


def generate_scenario_examples(
    scenario: tsrd.ScenarioData,
    memory_s: float,
    short_window_s: float,
    logging_policy: str,
) -> dict[str, np.ndarray]:
    if logging_policy != "sequential":
        raise ValueError("Only the deterministic sequential logging policy is implemented for dataset generation.")

    indexes = tsrd.build_band_indexes(scenario)
    histories = [ObservableBandHistory(last_update_s=scenario.start_s) for _ in range(scenario.receiver_plan.band_count)]
    seen_emitters: set[int] = set()
    never_seen_sentinel_s = float(max(scenario.end_s - scenario.start_s, 0.0) + np.sum(scenario.receiver_plan.dwell_times_s))

    x_parts = []
    y_hit_parts = []
    y_pulse_parts = []
    y_new_emitter_parts = []
    scenario_ids = []
    file_names = []
    decision_ids = []
    candidate_band_ids = []
    logged_band_ids = []
    was_logged_band = []
    decision_times = []

    now_s = scenario.start_s
    decision_index = 0
    previous_scan_was_hit = -1
    previous_scan_band_id = -1
    previous_scan_pulse_count = 0

    while now_s < scenario.end_s - 1e-12:
        features = candidate_features(
            scenario,
            histories,
            now_s,
            decision_index,
            previous_scan_was_hit,
            previous_scan_band_id,
            previous_scan_pulse_count,
            memory_s,
            short_window_s,
            never_seen_sentinel_s,
        )
        target_hit, target_pulses, target_new = candidate_targets(scenario, indexes, now_s, seen_emitters)
        selected_band_id = decision_index % scenario.receiver_plan.band_count

        x_parts.append(features)
        y_hit_parts.append(target_hit)
        y_pulse_parts.append(target_pulses)
        y_new_emitter_parts.append(target_new)
        band_ids = np.arange(scenario.receiver_plan.band_count, dtype=np.int16)
        scenario_ids.extend([scenario.scenario_id] * scenario.receiver_plan.band_count)
        file_names.extend([scenario.file_path.name] * scenario.receiver_plan.band_count)
        decision_ids.append(np.full(scenario.receiver_plan.band_count, decision_index, dtype=np.int32))
        candidate_band_ids.append(band_ids)
        logged_band_ids.append(np.full(scenario.receiver_plan.band_count, selected_band_id, dtype=np.int16))
        was_logged_band.append((band_ids == selected_band_id).astype(np.uint8))
        decision_times.append(np.full(scenario.receiver_plan.band_count, now_s, dtype=np.float32))

        selected_end_s = min(now_s + float(scenario.receiver_plan.dwell_times_s[selected_band_id]), scenario.end_s)
        observed = tsrd.observe_band(indexes, selected_band_id, now_s, selected_end_s)
        update_observable_history(
            histories[selected_band_id],
            now_s,
            bool(observed["hit"]),
            int(observed["pulse_count"]),
            memory_s,
        )
        if observed["hit"]:
            seen_emitters.update(int(emitter) for emitter in observed["emitter_ids"])

        previous_scan_was_hit = 1 if observed["hit"] else 0
        previous_scan_band_id = selected_band_id
        previous_scan_pulse_count = int(observed["pulse_count"])
        now_s = selected_end_s
        decision_index += 1

    return {
        "X": np.vstack(x_parts).astype(np.float32),
        "target_would_hit": np.concatenate(y_hit_parts).astype(np.uint8),
        "target_pulse_count": np.concatenate(y_pulse_parts).astype(np.int32),
        "target_new_emitter": np.concatenate(y_new_emitter_parts).astype(np.uint8),
        "scenario_id": np.asarray(scenario_ids),
        "file_name": np.asarray(file_names),
        "decision_index": np.concatenate(decision_ids).astype(np.int32),
        "candidate_band_id": np.concatenate(candidate_band_ids).astype(np.int16),
        "logged_band_id": np.concatenate(logged_band_ids).astype(np.int16),
        "was_logged_band": np.concatenate(was_logged_band).astype(np.uint8),
        "decision_time_s": np.concatenate(decision_times).astype(np.float32),
    }


def merge_split_parts(parts: list[dict[str, np.ndarray]]) -> dict[str, np.ndarray]:
    keys = parts[0].keys()
    return {key: np.concatenate([part[key] for part in parts], axis=0) for key in keys}


def save_npz(path: Path, arrays: dict[str, np.ndarray]) -> None:
    payload = dict(arrays)
    payload["feature_names"] = np.asarray(FEATURE_NAMES)
    np.savez_compressed(path, **payload)


def sample_rows(arrays: dict[str, np.ndarray], split: str, max_rows: int) -> pd.DataFrame:
    total = len(arrays["target_would_hit"])
    first_count = min(max_rows // 2, total)
    chosen = list(range(first_count))
    positive_indices = [int(index) for index in np.flatnonzero(arrays["target_would_hit"]) if int(index) not in chosen]
    chosen.extend(positive_indices[: max_rows - len(chosen)])
    if len(chosen) < min(max_rows, total):
        chosen_set = set(chosen)
        chosen.extend(index for index in range(total) if index not in chosen_set and len(chosen) < max_rows)
    indexer = np.asarray(chosen, dtype=np.int64)

    feature_frame = pd.DataFrame(arrays["X"][indexer], columns=[f"feature_{name}" for name in FEATURE_NAMES])
    meta_frame = pd.DataFrame(
        {
            "split": split,
            "scenario_id": arrays["scenario_id"][indexer],
            "file_name": arrays["file_name"][indexer],
            "decision_index": arrays["decision_index"][indexer],
            "candidate_band_id": arrays["candidate_band_id"][indexer],
            "logged_band_id": arrays["logged_band_id"][indexer],
            "was_logged_band": arrays["was_logged_band"][indexer],
            "decision_time_s": arrays["decision_time_s"][indexer],
            "target_would_hit": arrays["target_would_hit"][indexer],
            "target_pulse_count": arrays["target_pulse_count"][indexer],
            "target_new_emitter": arrays["target_new_emitter"][indexer],
        }
    )
    return pd.concat([meta_frame, feature_frame], axis=1)


def split_statistics(split: str, arrays: dict[str, np.ndarray], npz_path: Path) -> dict:
    positives = int(arrays["target_would_hit"].sum())
    examples = int(len(arrays["target_would_hit"]))
    return {
        "split": split,
        "examples": examples,
        "positive_examples": positives,
        "negative_examples": examples - positives,
        "positive_rate": positives / examples if examples else 0.0,
        "target_new_emitter_positive_examples": int(arrays["target_new_emitter"].sum()),
        "target_pulse_count_sum": int(arrays["target_pulse_count"].sum()),
        "npz_file": npz_path.name,
        "npz_size_mb": npz_path.stat().st_size / 1_000_000.0 if npz_path.exists() else 0.0,
    }


def write_feature_definitions(output_dir: Path) -> None:
    rows = []
    for name in FEATURE_NAMES:
        rows.append({"kind": "feature", "name": name, "definition": FEATURE_DEFINITIONS[name], "used_as_input": True})
    for name, definition in TARGET_DEFINITIONS.items():
        rows.append({"kind": "target", "name": name, "definition": definition, "used_as_input": False})
    pd.DataFrame(rows).to_csv(output_dir / "feature_definitions.csv", index=False)


def write_report(
    output_dir: Path,
    manifest: pd.DataFrame,
    stats: pd.DataFrame,
    leakage_checks: dict,
    args: argparse.Namespace,
) -> None:
    total_examples = int(stats["examples"].sum())
    raw_feature_matrix_mb = total_examples * len(FEATURE_NAMES) * 4 / 1_000_000.0
    npz_disk_mb = float(stats["npz_size_mb"].sum())
    input_disk_mb = float(manifest["file_size_bytes"].sum() / 1_000_000.0)
    lines = [
        "# Smart Scheduler V2 ML Dataset Report",
        "",
        "No machine learning model was trained or implemented.",
        "",
        "Each row is one question the future model could answer: at this decision time, for this candidate frequency band, should the receiver scan here next?",
        "",
        "The input features are built only from receiver-observable history before the decision. Ground-truth pulses and emitter labels are used only to build target columns.",
        "",
        "## Receiver Assumptions",
        "",
        f"- Band count: 36.",
        f"- Instantaneous bandwidth: {args.bandwidth_mhz:g} MHz.",
        f"- Dwell timing: TSRD-inspired 0.05/0.10 s schedule; Stare files do not include scan dwell metadata, so the validated default scan plan is used.",
        f"- Logging policy used to create observable history: `{args.logging_policy}`.",
        f"- Recent-history memory: {args.memory_s:g} s exponential decay.",
        f"- Short window: {args.short_window_s:g} s.",
        "",
        "## Scenario Counts",
        "",
        manifest.groupby("split").size().rename("scenario_count").reset_index().to_csv(index=False),
        "",
        "## Dataset Balance",
        "",
        stats.to_csv(index=False),
        "",
        "## Memory And Disk Requirements",
        "",
        f"- Input HDF5 footprint for this run: {input_disk_mb:.2f} MB.",
        f"- Compressed NPZ dataset footprint: {npz_disk_mb:.2f} MB.",
        f"- Raw float32 feature matrix size in memory: about {raw_feature_matrix_mb:.2f} MB.",
        f"- Practical RAM requirement is higher during generation because one scenario is loaded and candidate rows are assembled before compression; 8 GB RAM is comfortable for this {len(manifest)}-scenario run.",
        "- Parquet was not used because `pyarrow` was not installed in the local runtime; NPZ keeps the large arrays compact and efficient.",
        "",
        "## Leakage Checks",
        "",
        "```json",
        json.dumps(leakage_checks, indent=2),
        "```",
        "",
        "## Missing-Value Handling",
        "",
        "- No NaN values are written to the feature matrix.",
        "- If a band has never been visited or never had a HIT, the corresponding time-since feature uses a scenario-specific sentinel value: scenario duration plus one 2.15 s dwell cycle.",
        "- Companion indicator features (`band_never_visited`, `band_never_hit`) make those sentinel values explicit.",
        "- Previous scan fields use `-1` before the first scan where needed.",
        "",
        "## Target Meaning",
        "",
        "- `target_would_hit` is 1 when scanning the candidate band starting at the current decision time would observe at least one pulse during that band's dwell.",
        "- `target_pulse_count` is the number of pulses that would be observed in that hypothetical scan window.",
        "- `target_new_emitter` is 1 when that hypothetical scan would include at least one emitter label not already observed by the simulated receiver.",
        "",
        "## Split Assumption",
        "",
        "The TSRD HDF5 metadata identifies receiver mode, pulse data, and receiver settings, but not the dataset subset name. This run therefore uses an explicit scenario-level split manifest supplied by file path.",
        "",
        "If TEST is absent from the scenario-count table, no TEST/HOLDOUT HDF5 file was used to construct features or targets in this run.",
    ]
    (output_dir / "ml_dataset_report.md").write_text("\n".join(lines), encoding="utf-8")


def resource_summary(manifest: pd.DataFrame, stats: pd.DataFrame) -> dict:
    total_examples = int(stats["examples"].sum())
    return {
        "input_hdf5_size_mb": float(manifest["file_size_bytes"].sum() / 1_000_000.0),
        "compressed_npz_size_mb": float(stats["npz_size_mb"].sum()),
        "raw_feature_matrix_mb": float(total_examples * len(FEATURE_NAMES) * 4 / 1_000_000.0),
        "feature_count": len(FEATURE_NAMES),
        "total_examples": total_examples,
        "recommended_ram_gb": 8.0,
        "storage_format": "compressed_npz",
    }


def leakage_checks(manifest: pd.DataFrame) -> dict:
    split_sets = {split: set(group["scenario_id"]) for split, group in manifest.groupby("split")}
    overlaps = {}
    for left in split_sets:
        for right in split_sets:
            if left >= right:
                continue
            overlap = sorted(split_sets[left] & split_sets[right])
            overlaps[f"{left}_vs_{right}"] = overlap
    return {
        "scenario_id_overlaps": overlaps,
        "duplicate_file_paths": manifest["file_path"].duplicated().any().item(),
        "duplicate_content_hashes": manifest["content_sha1"].duplicated().any().item(),
        "all_receiver_modes": sorted(manifest["receiver_mode"].unique().tolist()),
        "all_scenarios_are_stare": bool((manifest["receiver_mode"].str.lower() == "stare").all()),
        "feature_columns_using_ground_truth": [],
        "ground_truth_used_only_for_targets": ["target_would_hit", "target_pulse_count", "target_new_emitter"],
        "scenario_level_splitting_only": True,
    }


def generate(args: argparse.Namespace) -> None:
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    split_paths = split_file_paths(args)
    manifest = build_manifest(split_paths, args.bandwidth_mhz)
    manifest.to_csv(output_dir / "scenario_manifest.csv", index=False)
    write_feature_definitions(output_dir)

    stats_rows = []
    samples = []
    for split in ["train", "validation", "test"]:
        scenario_parts = []
        split_manifest = manifest[manifest["split"] == split]
        if split_manifest.empty and split == "test":
            continue
        for _, row in split_manifest.iterrows():
            scenario = tsrd.load_scenario(Path(row["file_path"]), args.bandwidth_mhz, args.evaluation_slot_s, args.max_duration_s)
            scenario_parts.append(
                generate_scenario_examples(
                    scenario,
                    memory_s=args.memory_s,
                    short_window_s=args.short_window_s,
                    logging_policy=args.logging_policy,
                )
            )
        if not scenario_parts:
            raise ValueError(f"No scenarios were assigned to split {split!r}.")
        arrays = merge_split_parts(scenario_parts)
        npz_path = output_dir / f"{split}_dataset.npz"
        save_npz(npz_path, arrays)
        stats_rows.append(split_statistics(split, arrays, npz_path))
        if split == "train":
            samples.append(sample_rows(arrays, split, args.sample_rows))

    stats = pd.DataFrame(stats_rows)
    stats.to_csv(output_dir / "dataset_summary.csv", index=False)
    resources = resource_summary(manifest, stats)
    (output_dir / "resource_summary.json").write_text(json.dumps(resources, indent=2), encoding="utf-8")
    sample = pd.concat(samples, ignore_index=True)
    sample.to_csv(output_dir / "human_readable_sample_20_rows.csv", index=False)
    checks = leakage_checks(manifest)
    (output_dir / "leakage_checks.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
    write_report(output_dir, manifest, stats, checks, args)

    print(
        json.dumps(
            {
                "output_dir": str(output_dir),
                "scenario_counts": manifest.groupby("split").size().to_dict(),
                "example_counts": dict(zip(stats["split"], stats["examples"])),
                "positive_rates": dict(zip(stats["split"], stats["positive_rate"])),
            },
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Smart Scheduler V2 ML datasets without training a model.")
    parser.add_argument("--train-files", nargs="+", type=Path, required=True)
    parser.add_argument("--validation-files", nargs="+", type=Path, required=True)
    parser.add_argument(
        "--test-files",
        nargs="*",
        type=Path,
        default=[],
        help="Optional TEST files. Omit to build TRAIN/VALIDATION only and keep HOLDOUT untouched.",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--bandwidth-mhz", type=float, default=500.0)
    parser.add_argument("--evaluation-slot-s", type=float, default=0.05)
    parser.add_argument("--max-duration-s", type=float, default=None)
    parser.add_argument("--memory-s", type=float, default=2.0)
    parser.add_argument("--short-window-s", type=float, default=1.0)
    parser.add_argument("--logging-policy", choices=["sequential"], default="sequential")
    parser.add_argument("--sample-rows", type=int, default=20)
    return parser.parse_args()


if __name__ == "__main__":
    generate(parse_args())
