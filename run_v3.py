from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd


PACKAGE_ROOT = Path(__file__).resolve().parent
SRC_DIR = PACKAGE_ROOT / "src"
sys.path.insert(0, str(SRC_DIR))

# The frozen research source used these original module names. These aliases let
# the byte-for-byte source copies run from the smaller deployment package.
import preprocessing as tsrd

sys.modules["multi_scenario_pipeline"] = tsrd
import feature_generator as features

sys.modules["generate_ml_dataset_v2"] = features
import inference_metrics

sys.modules["train_and_evaluate_v2"] = inference_metrics
import smart_scheduler_v3 as scheduler


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def run_inference(h5_path: Path, output_path: Path, max_duration_s: float | None) -> pd.DataFrame:
    """Run frozen V3 online inference. No fitting or parameter updates occur."""

    metadata = load_json(PACKAGE_ROOT / "config" / "inference_metadata.json")
    scheduler_config = load_json(PACKAGE_ROOT / "config" / "v3_parameters.json")
    model_path = PACKAGE_ROOT / "models" / "random_forest.joblib"

    actual_model_hash = sha256_file(model_path)
    if actual_model_hash != metadata["model_sha256"]:
        raise RuntimeError("Random Forest checksum does not match frozen inference metadata.")
    if metadata["feature_names"] != features.FEATURE_NAMES:
        raise RuntimeError("Feature names/order do not match the frozen feature generator.")

    model = joblib.load(model_path)
    params = scheduler.V3Params(**scheduler_config["parameters"])
    receiver = metadata["receiver"]
    scenario = tsrd.load_scenario(
        h5_path,
        float(receiver["instantaneous_bandwidth_mhz"]),
        float(receiver["evaluation_slot_s"]),
        max_duration_s,
    )
    if scenario.receiver_mode != "Stare":
        raise ValueError(f"Expected a compatible Stare scenario, found {scenario.receiver_mode!r}.")
    if scenario.receiver_plan.band_count != int(receiver["band_count"]):
        raise ValueError("Scenario receiver layout does not have the expected 36 bands.")

    indexes = tsrd.build_band_indexes(scenario)
    histories = [
        features.ObservableBandHistory(last_update_s=scenario.start_s)
        for _ in range(scenario.receiver_plan.band_count)
    ]
    sentinel_s = float(
        scenario.end_s - scenario.start_s + np.sum(scenario.receiver_plan.dwell_times_s)
    )
    recent_selected_bands: list[int] = []
    previous_scan_was_hit = -1
    previous_scan_band_id = -1
    previous_scan_pulse_count = 0
    now_s = scenario.start_s
    decision_index = 0
    rows: list[dict] = []

    while now_s < scenario.end_s - 1e-12:
        # All 30 inputs come from static band definitions, elapsed time, and
        # histories of bands that the simulated receiver actually scanned.
        candidate_matrix = features.candidate_features(
            scenario,
            histories,
            now_s,
            decision_index,
            previous_scan_was_hit,
            previous_scan_band_id,
            previous_scan_pulse_count,
            float(metadata["memory_s"]),
            float(metadata["short_window_s"]),
            sentinel_s,
        )
        if candidate_matrix.shape != (36, metadata["feature_count"]):
            raise RuntimeError(f"Unexpected feature shape: {candidate_matrix.shape}")

        rf_probabilities = model.predict_proba(candidate_matrix)[:, 1]
        selected_band, score_terms, forced = scheduler.choose_v3_band(
            rf_probabilities,
            histories,
            now_s,
            recent_selected_bands,
            params,
        )
        dwell_s = float(scenario.receiver_plan.dwell_times_s[selected_band])
        end_s = min(now_s + dwell_s, scenario.end_s)

        # Ground truth is revealed only for the selected band and dwell window.
        observation = tsrd.observe_band(indexes, selected_band, now_s, end_s)
        hit = bool(observation["hit"])
        rows.append(
            {
                "decision_index": decision_index,
                "start_s": now_s,
                "end_s": end_s,
                "selected_band_id": selected_band,
                "band_center_mhz": float(scenario.receiver_plan.centres_mhz[selected_band]),
                "rf_activity_probability": float(rf_probabilities[selected_band]),
                "v3_score": float(score_terms["scores"][selected_band]),
                "maximum_revisit_rule_forced": forced,
                "outcome": "HIT" if hit else "MISS",
                "observed_pulse_count": int(observation["pulse_count"]),
            }
        )

        # Only the selected band's observable history is updated.
        features.update_observable_history(
            histories[selected_band],
            now_s,
            hit,
            int(observation["pulse_count"]),
            float(metadata["memory_s"]),
        )
        recent_selected_bands.append(selected_band)
        previous_scan_was_hit = 1 if hit else 0
        previous_scan_band_id = selected_band
        previous_scan_pulse_count = int(observation["pulse_count"])
        now_s = end_s
        decision_index += 1

    decisions = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    decisions.to_csv(output_path, index=False)
    return decisions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run frozen Smart Scheduler V3 Candidate 17 inference.")
    parser.add_argument("h5_path", type=Path, help="Compatible TSRD Stare .h5 scenario")
    parser.add_argument("--output", type=Path, default=Path("v3_decisions.csv"), help="Decision CSV path")
    parser.add_argument("--max-duration-s", type=float, default=None, help="Optional demo duration limit")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    decisions = run_inference(args.h5_path.resolve(), args.output.resolve(), args.max_duration_s)
    hits = int((decisions["outcome"] == "HIT").sum())
    total = len(decisions)
    print(f"Saved {total} frozen-V3 decisions to {args.output.resolve()}")
    print(f"HITs: {hits}; MISSes: {total - hits}; hit rate: {hits / total:.2%}" if total else "No decisions")
    print("Inference only: no model fitting or scheduler tuning was performed.")


if __name__ == "__main__":
    main()
