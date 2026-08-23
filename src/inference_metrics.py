from __future__ import annotations

import numpy as np


def scheduling_metrics(scenario, decisions, episodes):
    """Compatibility helper used by the frozen scheduler's optional metrics function."""

    import preprocessing as tsrd

    base = tsrd.metrics_for(scenario, decisions, episodes)
    intercepted = episodes[episodes["intercepted"]]
    base["median_interception_delay_s"] = (
        float(intercepted["delay_s"].median()) if not intercepted.empty else np.nan
    )
    base["scheduler"] = str(decisions["scheduler"].iloc[0])
    return base
