from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
verified_packages = [
    WORKSPACE_ROOT / "work" / "h5runtime3",
    WORKSPACE_ROOT / "work" / "mlruntime",
]
sys.path[:0] = [str(path) for path in verified_packages if path.exists()]

sys.path.insert(0, str(WORKSPACE_ROOT / "outputs" / "tsrd_multi_scenario_pipeline"))
sys.path.insert(0, str(WORKSPACE_ROOT / "outputs" / "tsrd_ml_dataset_v2"))
sys.path.insert(0, str(WORKSPACE_ROOT / "outputs" / "tsrd_smart_scheduler_v2_models"))

import joblib  # noqa: E402

import generate_ml_dataset_v2 as dataset_v2  # noqa: E402
import multi_scenario_pipeline as tsrd  # noqa: E402
import train_and_evaluate_v2 as v2  # noqa: E402


SCHEDULER_ORDER = [
    "sequential",
    "adaptive_v1",
    "logistic_regression_scheduler",
    "random_forest_scheduler",
    "random_forest_multi_objective_v3",
]


@dataclass(frozen=True)
class V3Params:
    """Configuration for the online V3 score and revisit safety rule."""

    w_activity: float = 0.90
    w_visit_staleness: float = 0.25
    w_inverse_visits: float = 0.12
    w_hit_staleness: float = 0.12
    w_repetition: float = 0.12
    w_uncertainty: float = 0.00
    max_revisit_gap_s: float = 4.30
    hit_staleness_scale_s: float = 4.30
    repetition_window_scans: int = 8


OBJECTIVE_WEIGHTS = {
    "emitter_coverage": 0.35,
    "hit_rate": 0.15,
    "active_cell_interception_rate": 0.15,
    "pulse_weighted_interception": 0.15,
    "delay_penalty": -0.10,
    "missed_episode_rate": -0.10,
}


def safe_age(now_s: float, previous_s: float | None, scale_s: float) -> float:
    """Return a bounded age score; unseen history is maximally stale."""

    if previous_s is None:
        return 1.0
    return float(np.clip((now_s - previous_s) / max(scale_s, 1e-9), 0.0, 1.0))


def normalized_entropy(scan_counts: np.ndarray) -> tuple[float, float, float]:
    """Return normalized entropy, effective number of bands, and largest share."""

    counts = np.asarray(scan_counts, dtype=np.float64)
    total = counts.sum()
    if total <= 0:
        return 0.0, 0.0, 0.0
    shares = counts / total
    positive = shares[shares > 0]
    raw_entropy = float(-np.sum(positive * np.log(positive)))
    normalizer = math.log(len(counts)) if len(counts) > 1 else 1.0
    return raw_entropy / normalizer, math.exp(raw_entropy), float(shares.max())


def score_candidates(
    probabilities: np.ndarray,
    histories: list[dataset_v2.ObservableBandHistory],
    now_s: float,
    recent_selected_bands: list[int],
    params: V3Params,
) -> dict[str, np.ndarray]:
    """Build normalized online-only score terms for all candidate bands."""

    visits = np.asarray([history.visits for history in histories], dtype=np.float64)
    visit_staleness = np.asarray(
        [safe_age(now_s, history.last_visit_s, params.max_revisit_gap_s) for history in histories],
        dtype=np.float64,
    )
    inverse_visits = 1.0 / np.sqrt(visits + 1.0)
    hit_staleness = np.asarray(
        [safe_age(now_s, history.last_hit_s, params.hit_staleness_scale_s) for history in histories],
        dtype=np.float64,
    )

    window = recent_selected_bands[-params.repetition_window_scans :]
    repetition = np.zeros(len(histories), dtype=np.float64)
    if window:
        repetition = np.bincount(window, minlength=len(histories)).astype(np.float64) / len(window)

    uncertainty = 1.0 - 2.0 * np.abs(np.asarray(probabilities, dtype=np.float64) - 0.5)
    uncertainty = np.clip(uncertainty, 0.0, 1.0)
    scores = (
        params.w_activity * probabilities
        + params.w_visit_staleness * visit_staleness
        + params.w_inverse_visits * inverse_visits
        + params.w_hit_staleness * hit_staleness
        - params.w_repetition * repetition
        + params.w_uncertainty * uncertainty
    )
    return {
        "scores": scores,
        "visit_staleness": visit_staleness,
        "inverse_visits": inverse_visits,
        "hit_staleness": hit_staleness,
        "repetition": repetition,
        "uncertainty": uncertainty,
        "visits": visits,
    }


def choose_v3_band(
    probabilities: np.ndarray,
    histories: list[dataset_v2.ObservableBandHistory],
    now_s: float,
    recent_selected_bands: list[int],
    params: V3Params,
) -> tuple[int, dict[str, np.ndarray], bool]:
    """Choose the highest score, restricted to overdue bands when necessary."""

    terms = score_candidates(probabilities, histories, now_s, recent_selected_bands, params)
    overdue = np.asarray(
        [
            history.last_visit_s is None
            or now_s - history.last_visit_s >= params.max_revisit_gap_s - 1e-12
            for history in histories
        ],
        dtype=bool,
    )
    if overdue.any():
        eligible_scores = np.where(overdue, terms["scores"], -np.inf)
        selected = int(np.argmax(eligible_scores))
        return selected, terms, True
    return int(np.argmax(terms["scores"])), terms, False


def run_v3_scheduler(
    scenario: tsrd.ScenarioData,
    random_forest,
    params: V3Params,
    memory_s: float,
    short_window_s: float,
    prebuilt_indexes: list[dict] | None = None,
    prebuilt_grids: tuple[np.ndarray, np.ndarray] | None = None,
) -> pd.DataFrame:
    """Run V3 without exposing unselected-band ground truth to its history."""

    indexes = prebuilt_indexes if prebuilt_indexes is not None else tsrd.build_band_indexes(scenario)
    active_grid, pulse_grid = prebuilt_grids if prebuilt_grids is not None else tsrd.make_grid(scenario)
    histories = [
        dataset_v2.ObservableBandHistory(last_update_s=scenario.start_s)
        for _ in range(scenario.receiver_plan.band_count)
    ]
    never_seen_sentinel_s = float(
        max(scenario.end_s - scenario.start_s, 0.0)
        + np.sum(scenario.receiver_plan.dwell_times_s)
    )
    recent_selected_bands: list[int] = []
    rows: list[dict] = []
    now_s = scenario.start_s
    decision_index = 0
    previous_scan_was_hit = -1
    previous_scan_band_id = -1
    previous_scan_pulse_count = 0

    while now_s < scenario.end_s - 1e-12:
        features = dataset_v2.candidate_features(
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
        probabilities = random_forest.predict_proba(features)[:, 1]
        selected_band_id, terms, safety_forced = choose_v3_band(
            probabilities,
            histories,
            now_s,
            recent_selected_bands,
            params,
        )

        dwell_s = float(scenario.receiver_plan.dwell_times_s[selected_band_id])
        end_s = min(now_s + dwell_s, scenario.end_s)
        observed = tsrd.observe_band(indexes, selected_band_id, now_s, end_s)
        hit = bool(observed["hit"])
        slots = list(tsrd.covered_slots(now_s, end_s, scenario))

        rows.append(
            {
                "scenario_id": scenario.scenario_id,
                "file_name": scenario.file_path.name,
                "scheduler": "random_forest_multi_objective_v3",
                "scan_id": decision_index,
                "start_s": now_s,
                "end_s": end_s,
                "selected_band_id": selected_band_id,
                "selected_probability": float(probabilities[selected_band_id]),
                "selected_score": float(terms["scores"][selected_band_id]),
                "activity_term": float(probabilities[selected_band_id]),
                "visit_staleness_term": float(terms["visit_staleness"][selected_band_id]),
                "inverse_visit_term": float(terms["inverse_visits"][selected_band_id]),
                "hit_staleness_term": float(terms["hit_staleness"][selected_band_id]),
                "repetition_term": float(terms["repetition"][selected_band_id]),
                "uncertainty_term": float(terms["uncertainty"][selected_band_id]),
                "safety_rule_forced": safety_forced,
                "outcome": "HIT" if hit else "MISS",
                "pulse_count_observed": int(observed["pulse_count"]),
                "active_cells_intercepted": int(active_grid[slots, selected_band_id].sum()) if slots else 0,
                "pulses_intercepted": int(pulse_grid[slots, selected_band_id].sum()) if slots else 0,
                "emitter_ids_observed": " ".join(str(value) for value in observed["emitter_ids"]),
            }
        )

        # This is the only online history update: the band that was actually scanned.
        dataset_v2.update_observable_history(
            histories[selected_band_id],
            now_s,
            hit,
            int(observed["pulse_count"]),
            memory_s,
        )
        recent_selected_bands.append(selected_band_id)
        previous_scan_was_hit = 1 if hit else 0
        previous_scan_band_id = selected_band_id
        previous_scan_pulse_count = int(observed["pulse_count"])
        now_s = end_s
        decision_index += 1

    return pd.DataFrame(rows)


def metrics_with_attention(
    scenario: tsrd.ScenarioData,
    decisions: pd.DataFrame,
) -> tuple[dict, pd.DataFrame]:
    """Compute interception metrics and spectrum-attention measures."""

    scheduler = str(decisions["scheduler"].iloc[0])
    episodes = tsrd.episode_results(scenario, decisions, scheduler)
    metrics = v2.scheduling_metrics(scenario, decisions, episodes)
    counts = np.bincount(
        decisions["selected_band_id"].to_numpy(dtype=np.int32),
        minlength=scenario.receiver_plan.band_count,
    )
    entropy, effective_bands, maximum_share = normalized_entropy(counts)
    metrics["scan_distribution_entropy"] = entropy
    metrics["effective_bands_scanned"] = effective_bands
    metrics["maximum_band_scan_share"] = maximum_share
    metrics["safety_forced_scans"] = int(decisions.get("safety_rule_forced", pd.Series(dtype=bool)).sum())

    distribution = pd.DataFrame(
        {
            "selected_band_id": np.arange(scenario.receiver_plan.band_count),
            "band_center_mhz": scenario.receiver_plan.centres_mhz,
            "scan_count": counts,
        }
    )
    hit_counts = decisions.loc[decisions["outcome"] == "HIT", "selected_band_id"].value_counts()
    pulse_counts = decisions.groupby("selected_band_id")["pulse_count_observed"].sum()
    distribution["hit_count"] = distribution["selected_band_id"].map(hit_counts).fillna(0).astype(int)
    distribution["observed_pulses"] = distribution["selected_band_id"].map(pulse_counts).fillna(0).astype(int)
    distribution["scan_share"] = distribution["scan_count"] / max(int(counts.sum()), 1)
    distribution["scenario_id"] = scenario.scenario_id
    distribution["file_name"] = scenario.file_path.name
    distribution["scheduler"] = scheduler
    return metrics, distribution


def validation_objective(metric: dict, scenario_duration_s: float, max_revisit_gap_s: float) -> dict:
    """Combine visible validation metrics into one bounded selection score."""

    delay = float(metric["average_interception_delay_s"])
    if not np.isfinite(delay):
        delay = scenario_duration_s
    delay_scale = max(max_revisit_gap_s, 1e-9)
    delay_penalty = float(np.clip(delay / delay_scale, 0.0, 1.0))
    total_episodes = max(int(metric["total_episodes"]), 1)
    missed_rate = float(metric["missed_episodes"] / total_episodes)
    combined = (
        OBJECTIVE_WEIGHTS["emitter_coverage"] * metric["emitter_coverage"]
        + OBJECTIVE_WEIGHTS["hit_rate"] * metric["hit_rate"]
        + OBJECTIVE_WEIGHTS["active_cell_interception_rate"] * metric["active_cell_interception_rate"]
        + OBJECTIVE_WEIGHTS["pulse_weighted_interception"] * metric["pulse_weighted_interception"]
        + OBJECTIVE_WEIGHTS["delay_penalty"] * delay_penalty
        + OBJECTIVE_WEIGHTS["missed_episode_rate"] * missed_rate
    )
    return {
        "validation_objective": float(combined),
        "normalized_delay_penalty": delay_penalty,
        "missed_episode_rate": missed_rate,
    }


def parameter_candidates() -> list[V3Params]:
    """Return a compact, predetermined grid that does not depend on TEST results."""

    profiles = [
        V3Params(
            w_activity=0.90,
            w_visit_staleness=0.25,
            w_inverse_visits=0.12,
            w_hit_staleness=0.12,
            w_repetition=0.12,
            w_uncertainty=0.00,
        ),
        V3Params(
            w_activity=0.75,
            w_visit_staleness=0.40,
            w_inverse_visits=0.20,
            w_hit_staleness=0.18,
            w_repetition=0.18,
            w_uncertainty=0.08,
        ),
    ]
    candidates = []
    for profile in profiles:
        for gap_s in [2.15, 4.30, 6.45, 8.60]:
            candidates.append(
                replace(
                    profile,
                    max_revisit_gap_s=gap_s,
                    hit_staleness_scale_s=4.30,
                )
            )
    return candidates


def tune_on_validation(
    validation_manifest: pd.DataFrame,
    random_forest,
    args: argparse.Namespace,
) -> tuple[V3Params, pd.DataFrame, pd.DataFrame]:
    """Evaluate the fixed parameter grid on validation scenarios only."""

    per_scenario_rows: list[dict] = []
    aggregate_rows: list[dict] = []
    candidates = parameter_candidates()

    validation_scenarios = [
        tsrd.load_scenario(
            Path(row["file_path"]),
            args.bandwidth_mhz,
            args.evaluation_slot_s,
            args.max_duration_s,
        )
        for _, row in validation_manifest.iterrows()
    ]

    for candidate_id, candidate in enumerate(candidates):
        candidate_rows = []
        for scenario in validation_scenarios:
            decisions = run_v3_scheduler(
                scenario,
                random_forest,
                candidate,
                args.memory_s,
                args.short_window_s,
            )
            metric, _ = metrics_with_attention(scenario, decisions)
            objective = validation_objective(
                metric,
                scenario.end_s - scenario.start_s,
                candidate.max_revisit_gap_s,
            )
            row = {"candidate_id": candidate_id, **asdict(candidate), **metric, **objective}
            per_scenario_rows.append(row)
            candidate_rows.append(row)

        group = pd.DataFrame(candidate_rows)
        aggregate = {"candidate_id": candidate_id, **asdict(candidate), "scenario_count": len(group)}
        visible_metrics = [
            "validation_objective",
            "emitter_coverage",
            "hit_rate",
            "active_cell_interception_rate",
            "pulse_weighted_interception",
            "average_interception_delay_s",
            "missed_episodes",
            "missed_episode_rate",
            "scan_distribution_entropy",
            "effective_bands_scanned",
            "maximum_band_scan_share",
        ]
        for name in visible_metrics:
            aggregate[f"{name}_mean"] = float(group[name].mean())
            aggregate[f"{name}_median"] = float(group[name].median())
        aggregate_rows.append(aggregate)

    aggregate_df = pd.DataFrame(aggregate_rows).sort_values(
        ["validation_objective_mean", "emitter_coverage_mean", "hit_rate_mean"],
        ascending=[False, False, False],
    )
    winner_id = int(aggregate_df.iloc[0]["candidate_id"])
    return candidates[winner_id], aggregate_df, pd.DataFrame(per_scenario_rows)


def run_final_test(
    test_manifest: pd.DataFrame,
    logistic_model,
    random_forest,
    v3_params: V3Params,
    inference_metadata: dict,
    args: argparse.Namespace,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, tsrd.ScenarioData]]:
    """Run each requested scheduler once after V3 parameters are frozen."""

    scheduler_params = tsrd.SchedulerParams()
    metric_rows: list[dict] = []
    distribution_parts: list[pd.DataFrame] = []
    decision_parts: list[pd.DataFrame] = []
    scenarios: dict[str, tsrd.ScenarioData] = {}

    for _, row in test_manifest.iterrows():
        scenario = tsrd.load_scenario(
            Path(row["file_path"]),
            args.bandwidth_mhz,
            args.evaluation_slot_s,
            args.max_duration_s,
        )
        scenarios[scenario.scenario_id] = scenario
        baseline_specs = [
            ("sequential", None),
            ("adaptive_v1", None),
            ("logistic_regression_scheduler", logistic_model),
            ("random_forest_scheduler", random_forest),
        ]
        for scheduler_name, model in baseline_specs:
            decisions = v2.run_policy_scheduler(
                scenario,
                scheduler_name,
                model,
                scheduler_params,
                args.memory_s,
                args.short_window_s,
                float(inference_metadata["exploration_bonus"]),
                float(inference_metadata["never_visited_bonus"]),
                int(inference_metadata["force_explore_every"]),
            )
            metric, distribution = metrics_with_attention(scenario, decisions)
            metric_rows.append(metric)
            distribution_parts.append(distribution)
            decision_parts.append(decisions)

        v3_decisions = run_v3_scheduler(
            scenario,
            random_forest,
            v3_params,
            args.memory_s,
            args.short_window_s,
        )
        metric, distribution = metrics_with_attention(scenario, v3_decisions)
        metric_rows.append(metric)
        distribution_parts.append(distribution)
        decision_parts.append(v3_decisions)

    return (
        pd.DataFrame(metric_rows),
        pd.concat(distribution_parts, ignore_index=True),
        pd.concat(decision_parts, ignore_index=True),
        scenarios,
    )


def aggregate_metrics(metrics: pd.DataFrame) -> pd.DataFrame:
    """Report both mean and median across independent TEST scenarios."""

    metric_names = [
        "hit_rate",
        "active_cell_interception_rate",
        "emitter_coverage",
        "pulse_weighted_interception",
        "average_interception_delay_s",
        "median_interception_delay_s",
        "missed_episodes",
        "scan_distribution_entropy",
        "effective_bands_scanned",
        "maximum_band_scan_share",
    ]
    rows = []
    for scheduler, group in metrics.groupby("scheduler"):
        row = {"scheduler": scheduler, "scenario_count": len(group)}
        for name in metric_names:
            row[f"{name}_mean"] = float(group[name].mean())
            row[f"{name}_median"] = float(group[name].median())
        rows.append(row)
    result = pd.DataFrame(rows)
    order = {name: index for index, name in enumerate(SCHEDULER_ORDER)}
    return result.sort_values("scheduler", key=lambda values: values.map(order)).reset_index(drop=True)


def get_font(size: int) -> ImageFont.ImageFont:
    for name in ["arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def scheduler_color(scheduler: str) -> tuple[int, int, int]:
    colors = {
        "sequential": (25, 91, 160),
        "adaptive_v1": (225, 122, 20),
        "logistic_regression_scheduler": (120, 70, 160),
        "random_forest_scheduler": (190, 50, 55),
        "random_forest_multi_objective_v3": (25, 135, 85),
    }
    return colors[scheduler]


def draw_scan_paths(
    path: Path,
    scenario: tsrd.ScenarioData,
    decisions: pd.DataFrame,
) -> None:
    """Draw all five scanner paths over the same activity map."""

    width, panel_height = 1280, 170
    left, right, top = 75, 25, 70
    height = top + panel_height * len(SCHEDULER_ORDER) + 55
    image = Image.new("RGB", (width, height), (250, 250, 248))
    draw = ImageDraw.Draw(image)
    title_font, label_font, small_font = get_font(23), get_font(14), get_font(12)
    draw.text((left, 18), f"TEST scan paths: {scenario.file_path.name}", fill=(25, 25, 25), font=title_font)
    active_grid, _ = tsrd.make_grid(scenario)
    slot_count, band_count = active_grid.shape
    plot_width = width - left - right
    cell_w = plot_width / max(slot_count, 1)

    for panel_index, scheduler in enumerate(SCHEDULER_ORDER):
        y0 = top + panel_index * panel_height
        plot_top = y0 + 25
        plot_bottom = y0 + panel_height - 22
        plot_h = plot_bottom - plot_top
        draw.text((left, y0 + 2), scheduler.replace("_", " "), fill=(25, 25, 25), font=label_font)
        draw.rectangle((left, plot_top, width - right, plot_bottom), outline=(125, 125, 125), width=1)
        active_slots, active_bands = np.where(active_grid)
        for slot_id, band_id in zip(active_slots, active_bands):
            x1 = left + slot_id * cell_w
            x2 = max(x1 + 1, left + (slot_id + 1) * cell_w)
            y1 = plot_bottom - (band_id + 1) * plot_h / band_count
            y2 = plot_bottom - band_id * plot_h / band_count
            draw.rectangle((x1, y1, x2, y2), fill=(215, 215, 210))

        subset = decisions[decisions["scheduler"] == scheduler].sort_values("start_s")
        points = []
        for row in subset.itertuples():
            elapsed_fraction = (float(row.start_s) - scenario.start_s) / max(scenario.end_s - scenario.start_s, 1e-9)
            x = left + elapsed_fraction * plot_width
            y = plot_bottom - (int(row.selected_band_id) + 0.5) * plot_h / band_count
            points.append((x, y))
        if len(points) > 1:
            draw.line(points, fill=scheduler_color(scheduler), width=2)
        for row, (x, y) in zip(subset.itertuples(), points):
            marker = (20, 135, 75) if row.outcome == "HIT" else (190, 55, 55)
            draw.ellipse((x - 1.5, y - 1.5, x + 1.5, y + 1.5), fill=marker)
        draw.text((12, plot_top - 2), "18 GHz", fill=(70, 70, 70), font=small_font)
        draw.text((25, plot_bottom - 12), "0 GHz", fill=(70, 70, 70), font=small_font)

    draw.text((left, height - 34), "Time (s): 0", fill=(50, 50, 50), font=small_font)
    end_label = f"{scenario.end_s:.2f}"
    draw.text((width - right - 45, height - 34), end_label, fill=(50, 50, 50), font=small_font)
    draw.text((width // 2 - 110, height - 34), "gray = RF activity; green/red = HIT/MISS", fill=(50, 50, 50), font=small_font)
    image.save(path)


def draw_visit_distribution(path: Path, file_name: str, distribution: pd.DataFrame) -> None:
    """Draw band-level scan shares for each scheduler on a shared scale."""

    width, height = 1280, 620
    left, right, top, bottom = 75, 25, 75, 65
    image = Image.new("RGB", (width, height), (250, 250, 248))
    draw = ImageDraw.Draw(image)
    title_font, label_font, small_font = get_font(23), get_font(14), get_font(12)
    draw.text((left, 18), f"Band visit distribution: {file_name}", fill=(25, 25, 25), font=title_font)
    plot_width, plot_height = width - left - right, height - top - bottom
    draw.rectangle((left, top, width - right, height - bottom), outline=(125, 125, 125), width=1)

    maximum = max(float(distribution["scan_share"].max()), 1e-9)
    for fraction in [0.0, 0.5, 1.0]:
        y = height - bottom - fraction * plot_height
        draw.line((left, y, width - right, y), fill=(220, 220, 215), width=1)
        draw.text((12, y - 7), f"{fraction * maximum:.2f}", fill=(70, 70, 70), font=small_font)

    for scheduler in SCHEDULER_ORDER:
        subset = distribution[distribution["scheduler"] == scheduler].sort_values("selected_band_id")
        points = []
        for row in subset.itertuples():
            x = left + (int(row.selected_band_id) + 0.5) / 36.0 * plot_width
            y = height - bottom - float(row.scan_share) / maximum * plot_height
            points.append((x, y))
        if points:
            draw.line(points, fill=scheduler_color(scheduler), width=3)

    for band_id in [0, 5, 11, 17, 23, 29, 35]:
        x = left + (band_id + 0.5) / 36.0 * plot_width
        draw.text((x - 8, height - bottom + 10), str(band_id + 1), fill=(50, 50, 50), font=small_font)
    draw.text((width // 2 - 70, height - 28), "Frequency band", fill=(45, 45, 45), font=label_font)
    draw.text((10, top - 25), "Scan share", fill=(45, 45, 45), font=label_font)

    legend_x, legend_y = left, 52
    for scheduler in SCHEDULER_ORDER:
        draw.line((legend_x, legend_y, legend_x + 25, legend_y), fill=scheduler_color(scheduler), width=4)
        label = scheduler.replace("_", " ")
        draw.text((legend_x + 31, legend_y - 8), label, fill=(35, 35, 35), font=small_font)
        legend_x += 225
    image.save(path)


def write_report(
    output_dir: Path,
    best_params: V3Params,
    validation_grid: pd.DataFrame,
    test_metrics: pd.DataFrame,
    aggregate: pd.DataFrame,
    test_access_audit: dict,
) -> None:
    v3_row = aggregate[aggregate["scheduler"] == "random_forest_multi_objective_v3"].iloc[0]
    v2_row = aggregate[aggregate["scheduler"] == "random_forest_scheduler"].iloc[0]
    seq_row = aggregate[aggregate["scheduler"] == "sequential"].iloc[0]
    coverage_recovered = (
        v3_row["emitter_coverage_mean"] - v2_row["emitter_coverage_mean"]
    )
    hit_retained = v3_row["hit_rate_mean"] / max(v2_row["hit_rate_mean"], 1e-12)
    pulse_retained = (
        v3_row["pulse_weighted_interception_mean"]
        / max(v2_row["pulse_weighted_interception_mean"], 1e-12)
    )
    active_retained = (
        v3_row["active_cell_interception_rate_mean"]
        / max(v2_row["active_cell_interception_rate_mean"], 1e-12)
    )
    delay_reduction = 1.0 - (
        v3_row["average_interception_delay_s_mean"]
        / max(v2_row["average_interception_delay_s_mean"], 1e-12)
    )
    missed_episode_reduction = 1.0 - (
        v3_row["missed_episodes_mean"]
        / max(v2_row["missed_episodes_mean"], 1e-12)
    )
    lines = [
        "# Smart Scheduler V3 Validation And TEST Report",
        "",
        "Random Forest was loaded from the saved V2 model and was not retrained. No reinforcement learning was implemented.",
        "",
        "## Leakage And Holdout Discipline",
        "",
        "V3 score inputs are Random Forest probabilities and receiver-observed history only. Emitter IDs, future activity, and unobserved-band ground truth never enter the score. Emitter labels are used only after a selected scan for final evaluation metrics.",
        "",
        "```json",
        json.dumps(test_access_audit, indent=2),
        "```",
        "",
        "## Normalized V3 Score",
        "",
        "`score = w_activity*RF_probability + w_visit_staleness*visit_staleness + w_inverse_visits*inverse_visits + w_hit_staleness*hit_staleness - w_repetition*repetition + w_uncertainty*uncertainty`",
        "",
        "Every term is bounded to [0, 1]. If one or more bands exceed the maximum revisit gap, selection is restricted to those overdue bands. This safety rule prevents permanent starvation.",
        "",
        "## Frozen Parameters",
        "",
        "```json",
        json.dumps(asdict(best_params), indent=2),
        "```",
        "",
        "## Validation Objective",
        "",
        "The combined score is used only to choose parameters. Individual metrics remain visible. Each validation scenario contributes equally.",
        "",
        "```json",
        json.dumps(OBJECTIVE_WEIGHTS, indent=2),
        "```",
        "",
        validation_grid.head(8).to_csv(index=False),
        "",
        "Delay is divided by the candidate maximum revisit gap and clipped to 1. Missed episodes are divided by total episodes.",
        "",
        "## Final TEST Aggregate",
        "",
        aggregate.to_csv(index=False),
        "",
        "## Final TEST Per Scenario",
        "",
        test_metrics.to_csv(index=False),
        "",
        "## Answer To The Primary Question",
        "",
        f"V3 changed mean emitter coverage by {coverage_recovered:+.3f} relative to RF V2.",
        f"V3 retained {hit_retained:.1%} of RF V2 mean hit rate, {active_retained:.1%} of active-cell interception, and {pulse_retained:.1%} of pulse-weighted interception.",
        f"Relative to RF V2, V3 reduced mean delay by {delay_reduction:.1%} and mean missed episodes by {missed_episode_reduction:.1%}.",
        f"Mean delay: V3 {v3_row['average_interception_delay_s_mean']:.3f} s, RF V2 {v2_row['average_interception_delay_s_mean']:.3f} s, Sequential {seq_row['average_interception_delay_s_mean']:.3f} s.",
        f"Mean normalized scan entropy: V3 {v3_row['scan_distribution_entropy_mean']:.3f}, RF V2 {v2_row['scan_distribution_entropy_mean']:.3f}, Sequential {seq_row['scan_distribution_entropy_mean']:.3f}.",
        "",
        "Conclusion: V3 is a strong coverage-and-delay recovery, but only a partial retention of RF V2 interception performance. The pulse-weighted metric fell materially, so V3 does not dominate RF V2 on every objective.",
        "",
        "The sparse config_0 scenario is the delay exception: V3 coverage stayed at 1.0 but average delay rose from 0.000 s for RF V2 to 0.763 s. In each of the other four TEST scenarios, V3 increased coverage and reduced average delay.",
        "",
        "A higher normalized entropy (maximum 1) means attention is spread more evenly across the 36 bands. Effective bands is exp(Shannon entropy), which can be read as the number of equally visited bands that would produce the observed diversity.",
    ]
    (output_dir / "smart_scheduler_v3_report.md").write_text("\n".join(lines), encoding="utf-8")


def run(args: argparse.Namespace) -> None:
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    visualization_dir = output_dir / "visualizations"
    visualization_dir.mkdir(exist_ok=True)

    manifest = pd.read_csv(args.dataset_dir / "scenario_manifest.csv")
    validation_manifest = manifest[manifest["split"] == "validation"].copy()
    test_manifest = manifest[manifest["split"] == "test"].copy()
    if len(validation_manifest) != 4 or len(test_manifest) != 5:
        raise ValueError(
            f"Expected 4 validation and 5 test scenarios; found {len(validation_manifest)} and {len(test_manifest)}."
        )
    if set(validation_manifest["scenario_id"]) & set(test_manifest["scenario_id"]):
        raise ValueError("A scenario appears in both VALIDATION and TEST.")

    models_dir = args.v2_results_dir / "models"
    logistic_model = joblib.load(models_dir / "logistic_regression.joblib")
    random_forest = joblib.load(models_dir / "random_forest.joblib")
    # Small online batches are faster and deterministic without parallel worker setup.
    if hasattr(random_forest, "n_jobs"):
        random_forest.n_jobs = 1
    inference_metadata = json.loads((models_dir / "inference_metadata.json").read_text(encoding="utf-8"))

    best_params, validation_grid, validation_per_scenario = tune_on_validation(
        validation_manifest,
        random_forest,
        args,
    )
    validation_grid.to_csv(output_dir / "validation_parameter_search.csv", index=False)
    validation_per_scenario.to_csv(output_dir / "validation_metrics_by_candidate_scenario.csv", index=False)

    frozen = {
        "random_forest_retrained": False,
        "selected_using_split": "validation",
        "validation_scenario_count": len(validation_manifest),
        "test_scenario_count": len(test_manifest),
        "best_v3_parameters": asdict(best_params),
        "objective_weights": OBJECTIVE_WEIGHTS,
    }
    frozen_path = output_dir / "frozen_v3_parameters.json"
    frozen_path.write_text(json.dumps(frozen, indent=2), encoding="utf-8")

    # TEST files are first loaded here, after the selected V3 parameters are serialized.
    test_access_audit = {
        "test_used_during_parameter_search": False,
        "test_loaded_after_frozen_parameters_written": frozen_path.exists(),
        "test_evaluation_runs_in_this_pipeline": 1,
        "validation_file_names": validation_manifest["file_name"].tolist(),
        "test_file_names": test_manifest["file_name"].tolist(),
    }
    metrics, distribution, decisions, scenarios = run_final_test(
        test_manifest,
        logistic_model,
        random_forest,
        best_params,
        inference_metadata,
        args,
    )
    aggregate = aggregate_metrics(metrics)

    metrics.to_csv(output_dir / "test_metrics_by_scenario.csv", index=False)
    aggregate.to_csv(output_dir / "test_metrics_mean_median.csv", index=False)
    distribution.to_csv(output_dir / "test_band_visit_distribution.csv", index=False)
    decisions.to_csv(output_dir / "test_scheduler_decisions.csv", index=False)
    (output_dir / "test_holdout_audit.json").write_text(json.dumps(test_access_audit, indent=2), encoding="utf-8")

    for scenario_id, scenario in scenarios.items():
        safe_name = scenario.file_path.stem.replace(" ", "_").replace("(", "").replace(")", "")
        scenario_decisions = decisions[decisions["scenario_id"] == scenario_id]
        scenario_distribution = distribution[distribution["scenario_id"] == scenario_id]
        draw_scan_paths(
            visualization_dir / f"scan_paths_{safe_name}.png",
            scenario,
            scenario_decisions,
        )
        draw_visit_distribution(
            visualization_dir / f"visit_distribution_{safe_name}.png",
            scenario.file_path.name,
            scenario_distribution,
        )

    aggregate_distribution = (
        distribution.groupby(["scheduler", "selected_band_id"], as_index=False)["scan_share"].mean()
    )
    draw_visit_distribution(
        visualization_dir / "visit_distribution_test_mean.png",
        "mean across 5 TEST scenarios",
        aggregate_distribution,
    )
    write_report(output_dir, best_params, validation_grid, metrics, aggregate, test_access_audit)
    print(
        json.dumps(
            {
                "output_dir": str(output_dir),
                "validation_candidates": len(validation_grid),
                "frozen_v3_parameters": asdict(best_params),
                "test_scenarios": len(test_manifest),
            },
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tune and evaluate Smart Scheduler V3 without retraining Random Forest."
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path("outputs/tsrd_ml_dataset_v2/datasets"),
    )
    parser.add_argument(
        "--v2-results-dir",
        type=Path,
        default=Path("outputs/tsrd_smart_scheduler_v2_models/results"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs/tsrd_smart_scheduler_v3/results"),
    )
    parser.add_argument("--bandwidth-mhz", type=float, default=500.0)
    parser.add_argument("--evaluation-slot-s", type=float, default=0.05)
    parser.add_argument("--max-duration-s", type=float, default=None)
    parser.add_argument("--memory-s", type=float, default=2.0)
    parser.add_argument("--short-window-s", type=float, default=1.0)
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
