from io import BytesIO

import h5py
import numpy as np
from fastapi.testclient import TestClient

from app.main import app


def scenario_bytes() -> bytes:
    stream = BytesIO()
    with h5py.File(stream, "w") as handle:
        handle.create_dataset("data", data=np.array([
            [1_000_000.0, 250.0, 2.0, 10.0, 0.5],
            [1_050_000.0, 750.0, 2.0, 10.0, 0.5],
            [2_000_000.0, 17_999.0, 2.0, 10.0, 0.5],
        ]))
        handle.create_dataset("labels", data=np.array(["a", "b", "a"], dtype="S4"))
        metadata = handle.create_group("metadata")
        metadata.attrs["receiver_mode"] = "Stare"
        metadata.create_dataset("feature_names", data=np.array(["ToA", "Frequency", "PulseWidth", "AoA", "Amplitude"], dtype="S16"))
        receiver = metadata.create_group("receiver")
        receiver.attrs["scan_mode"] = "Stare"
        receiver.create_dataset("dwell_centres_mhz", data=np.arange(250.0, 18000.0, 500.0))
        receiver.create_dataset("dwell_times_s", data=np.full(36, 0.05))
    return stream.getvalue()


def test_summary_assigns_bands_and_converts_to_seconds() -> None:
    with TestClient(app) as client:
        upload = client.post("/api/scenarios/upload", files={"file": ("summary_stare.h5", scenario_bytes(), "application/x-hdf5")})
        assert upload.status_code == 200
        scenario_id = upload.json()["scenario_id"]
        response = client.get(f"/api/scenarios/{scenario_id}/summary")
    body = response.json()
    assert response.status_code == 200
    assert body["scenario_id"] == scenario_id
    assert body["duration_seconds"] == 1.0
    assert body["active_bands"] == [0, 1, 35]
    assert body["activity_count_per_band"]["0"] == 1
    assert body["activity_count_per_band"]["1"] == 1
    assert body["activity_count_per_band"]["35"] == 1
    assert body["emitter_count"] == 2
    assert body["total_pulses"] == 3
    assert body["time_bins"][0]["active_bands"] == [0]
    assert body["time_bins"][1]["active_bands"] == [1]


def test_summary_keeps_sparse_bands_and_all_ranges() -> None:
    with TestClient(app) as client:
        upload = client.post("/api/scenarios/upload", files={"file": ("sparse.h5", scenario_bytes(), "application/x-hdf5")})
        summary = client.get(f"/api/scenarios/{upload.json()['scenario_id']}/summary")
    body = summary.json()
    assert len(body["band_ranges"]) == 36
    assert body["activity_count_per_band"]["2"] == 0
    assert body["band_ranges"][35] == {"band": 35, "frequency_min_mhz": 17500.0, "frequency_max_mhz": 18000.0}


def test_summary_rejects_unknown_scenario() -> None:
    with TestClient(app) as client:
        response = client.get("/api/scenarios/does-not-exist/summary")
    assert response.status_code == 404