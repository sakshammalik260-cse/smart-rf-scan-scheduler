from fastapi.testclient import TestClient

from app.main import app
from test_scheduler_predict import prediction_bytes, upload


def test_five_steps_advance_by_one_dwell_and_record_one_scan_each() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "five-step.h5")
        start = client.post("/api/simulation/start", json={"scenario_id": scenario_id})
        simulation_id = start.json()["simulation_id"]
        states = [client.post(f"/api/simulation/{simulation_id}/step").json() for _ in range(5)]
    assert start.status_code == 200
    assert start.json()["status"] == "running"
    assert start.json()["decision_count"] == 0
    assert [state["decision_count"] for state in states] == [1, 2, 3, 4, 5]
    assert all(state["selected_band"] is not None for state in states)
    assert all(item["outcome"] in {"HIT", "MISS"} for state in states for item in state["scan_history"])
    times = [state["current_simulation_time_seconds"] for state in states]
    assert times == sorted(times)
    assert all(later > earlier for earlier, later in zip(times, times[1:]))
    assert [len(state["scan_history"]) for state in states] == [1, 2, 3, 4, 5]
    assert all(len(state["latest_rf_probabilities"]) == 36 for state in states)
    assert all(len(state["latest_v3_scores"]) == 36 for state in states)
    assert all(state["progress_percent"] == state["progress_fraction"] * 100.0 for state in states)
    assert all(state["selected_band_details"]["band_id"] == state["selected_band"] for state in states)
    assert [len(state["recent_decisions"]) for state in states] == [1, 2, 3, 4, 5]
    assert all(state["band_visit_counts"] == state["per_band_visit_counts"] for state in states)
    assert all(state["scheduler"] == "smart_v3" for state in states)


def test_sequential_follows_exact_band_order() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "sequential-order.h5")
        start = client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": "sequential"})
        simulation_id = start.json()["simulation_id"]
        states = [client.post(f"/api/simulation/{simulation_id}/step").json() for _ in range(40)]
    assert start.status_code == 200
    assert start.json()["scheduler"] == "sequential"
    assert [state["selected_band"] for state in states[:40]] == list(range(36)) + [0, 1, 2, 3]
    assert all(value == 0.0 for state in states for value in state["latest_rf_probabilities"])
    assert all(value == 0.0 for state in states for value in state["latest_v3_scores"])


def test_sequential_and_smart_v3_use_identical_dwell_duration() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "same-dwell.h5")
        sequential_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": "sequential"}).json()["simulation_id"]
        smart_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": "smart_v3"}).json()["simulation_id"]
        sequential = client.post(f"/api/simulation/{sequential_id}/step").json()
        smart = client.post(f"/api/simulation/{smart_id}/step").json()
    assert sequential["scan_history"][0]["dwell_duration_seconds"] == smart["scan_history"][0]["dwell_duration_seconds"]
    assert sequential["current_simulation_time_seconds"] == smart["current_simulation_time_seconds"]


def test_pause_blocks_step_and_reset_clears_session_history() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "pause-reset.h5")
        simulation_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id}).json()["simulation_id"]
        stepped = client.post(f"/api/simulation/{simulation_id}/step").json()
        paused = client.post(f"/api/simulation/{simulation_id}/pause").json()
        blocked = client.post(f"/api/simulation/{simulation_id}/step")
        reset = client.post(f"/api/simulation/{simulation_id}/reset").json()
    assert stepped["decision_count"] == 1
    assert paused["status"] == "paused"
    assert blocked.status_code == 422
    assert reset["status"] == "running"
    assert reset["decision_count"] == 0
    assert reset["scan_history"] == []
    assert reset["recent_decisions"] == []
    assert reset["selected_band"] is None
    assert reset["selected_band_details"] is None
    assert reset["last_outcome"] is None
    assert reset["current_simulation_time_seconds"] == 0.0


def test_step_updates_only_selected_band_observable_history() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "selected-only.h5")
        started = client.post("/api/simulation/start", json={"scenario_id": scenario_id}).json()
        simulation_id = started["simulation_id"]
        stepped = client.post(f"/api/simulation/{simulation_id}/step").json()
    selected_band = str(stepped["selected_band"])
    assert sum(stepped["per_band_visit_counts"].values()) == 1
    assert stepped["per_band_visit_counts"][selected_band] == 1
    assert stepped["last_visit_times_seconds"][selected_band] == started["current_simulation_time_seconds"]
    for band_id, visits in stepped["per_band_visit_counts"].items():
        if band_id != selected_band:
            assert visits == 0
            assert stepped["last_visit_times_seconds"][band_id] is None
            assert stepped["last_hit_times_seconds"][band_id] is None
    if stepped["last_outcome"] == "HIT":
        assert stepped["last_hit_times_seconds"][selected_band] == started["current_simulation_time_seconds"]
    else:
        assert stepped["last_hit_times_seconds"][selected_band] is None


def test_both_schedulers_observe_only_their_selected_band() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "selected-only-both.h5")
        simulation_ids = [
            client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": scheduler}).json()["simulation_id"]
            for scheduler in ("sequential", "smart_v3")
        ]
        states = [client.post(f"/api/simulation/{simulation_id}/step").json() for simulation_id in simulation_ids]
    for state in states:
        selected_band = str(state["selected_band"])
        assert sum(state["per_band_visit_counts"].values()) == 1
        assert state["per_band_visit_counts"][selected_band] == 1
        for band_id, visits in state["per_band_visit_counts"].items():
            if band_id != selected_band:
                assert visits == 0
                assert state["last_visit_times_seconds"][band_id] is None
                assert state["last_hit_times_seconds"][band_id] is None


def test_default_smart_v3_behavior_matches_explicit_smart_v3() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "smart-unchanged.h5")
        default_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id}).json()["simulation_id"]
        explicit_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": "smart_v3"}).json()["simulation_id"]
        default_state = client.post(f"/api/simulation/{default_id}/step").json()
        explicit_state = client.post(f"/api/simulation/{explicit_id}/step").json()
    assert default_state["scheduler"] == "smart_v3"
    assert explicit_state["scheduler"] == "smart_v3"
    assert default_state["selected_band"] == explicit_state["selected_band"]
    assert default_state["last_outcome"] == explicit_state["last_outcome"]
    assert default_state["latest_rf_probabilities"] == explicit_state["latest_rf_probabilities"]
    assert default_state["latest_v3_scores"] == explicit_state["latest_v3_scores"]


def test_reset_returns_both_scheduler_sessions_to_initial_state() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "reset-both.h5")
        simulation_ids = [
            client.post("/api/simulation/start", json={"scenario_id": scenario_id, "scheduler": scheduler}).json()["simulation_id"]
            for scheduler in ("sequential", "smart_v3")
        ]
        for simulation_id in simulation_ids:
            for _ in range(3):
                client.post(f"/api/simulation/{simulation_id}/step")
        resets = [client.post(f"/api/simulation/{simulation_id}/reset").json() for simulation_id in simulation_ids]
    for reset in resets:
        assert reset["status"] == "running"
        assert reset["decision_count"] == 0
        assert reset["current_simulation_time_seconds"] == 0.0
        assert reset["selected_band"] is None
        assert reset["scan_history"] == []
        assert sum(reset["per_band_visit_counts"].values()) == 0


def test_unselected_future_activity_cannot_change_next_history_or_decision() -> None:
    with TestClient(app) as client:
        baseline_id = upload(client, prediction_bytes(750.0, 1), "leak-baseline.h5")
        changed_id = upload(client, prediction_bytes(17_750.0, 99), "leak-unselected-future.h5")
        baseline_simulation = client.post("/api/simulation/start", json={"scenario_id": baseline_id}).json()["simulation_id"]
        changed_simulation = client.post("/api/simulation/start", json={"scenario_id": changed_id}).json()["simulation_id"]
        baseline = client.post(f"/api/simulation/{baseline_simulation}/step").json()
        changed = client.post(f"/api/simulation/{changed_simulation}/step").json()
    assert baseline["selected_band"] == changed["selected_band"]
    assert baseline["scan_history"][0]["outcome"] == changed["scan_history"][0]["outcome"]
    assert baseline["scan_history"][0]["pulse_count_observed"] == changed["scan_history"][0]["pulse_count_observed"]
    assert baseline["per_band_visit_counts"] == changed["per_band_visit_counts"]
    assert baseline["last_visit_times_seconds"] == changed["last_visit_times_seconds"]
    assert baseline["last_hit_times_seconds"] == changed["last_hit_times_seconds"]
    assert baseline["latest_rf_probabilities"] == changed["latest_rf_probabilities"]
    assert baseline["latest_v3_scores"] == changed["latest_v3_scores"]


def test_state_endpoint_returns_same_state_without_advancing() -> None:
    with TestClient(app) as client:
        scenario_id = upload(client, prediction_bytes(750.0, 1), "state-no-advance.h5")
        simulation_id = client.post("/api/simulation/start", json={"scenario_id": scenario_id}).json()["simulation_id"]
        stepped = client.post(f"/api/simulation/{simulation_id}/step").json()
        state = client.get(f"/api/simulation/{simulation_id}/state").json()
    assert state == stepped


def test_new_scenario_session_does_not_inherit_previous_session_state() -> None:
    with TestClient(app) as client:
        first_scenario_id = upload(client, prediction_bytes(750.0, 1), "config_1009.h5")
        second_scenario_id = upload(client, prediction_bytes(17_750.0, 2), "config_1015.h5")
        first_id = client.post("/api/simulation/start", json={"scenario_id": first_scenario_id}).json()["simulation_id"]
        for _ in range(5):
            client.post(f"/api/simulation/{first_id}/step")
        second = client.post("/api/simulation/start", json={"scenario_id": second_scenario_id}).json()
    assert second["simulation_id"] != first_id
    assert second["scenario_id"] == second_scenario_id
    assert second["decision_count"] == 0
    assert second["scan_history"] == []
    assert second["recent_decisions"] == []
    assert second["selected_band"] is None
    assert second["last_outcome"] is None
    assert second["current_simulation_time_seconds"] == 0.0
    assert sum(second["per_band_visit_counts"].values()) == 0
