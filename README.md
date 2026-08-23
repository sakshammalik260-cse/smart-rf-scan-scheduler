# Smart Scheduler V3 Candidate 17: Final Frozen Inference Package

This package runs the exact expanded Random Forest and Smart Scheduler V3 Candidate 17 used in the one-time FINAL HOLDOUT evaluation. It performs **inference only**. It does not train, refit, tune, calibrate, or change the model or scheduler.

## Package contents

| Path | Purpose |
|---|---|
| `models/random_forest.joblib` | Byte-for-byte copy of the frozen expanded Random Forest. |
| `config/v3_parameters.json` | Exact Candidate 17 multi-objective weights and revisit rule. |
| `config/inference_metadata.json` | The 30 RF feature names in exact order, history-window settings, receiver assumptions, and version identifiers. |
| `src/smart_scheduler_v3.py` | Byte-for-byte copy of the V3 implementation used by the final evaluation. |
| `src/feature_generator.py` | Byte-for-byte copy of the leakage-safe feature/history source. `run_v3.py` uses only its inference functions. |
| `src/preprocessing.py` | Byte-for-byte copy of the TSRD H5 loader and receiver preprocessing source used by the final evaluation. |
| `src/inference_metrics.py` | Small compatibility helper required by the frozen scheduler module. It does not train anything. |
| `run_v3.py` | Beginner-readable, inference-only command-line example. |
| `requirements.txt` | Tested package versions for loading the model and H5 files. |
| `verification_report.json` | Packaging-time frozen-artifact checks and provenance notes. |
| `checksums.json` | SHA-256 hashes for packaged artifacts. |

## How Smart V3 works

At each receiver decision, the feature generator creates one 30-value row for each of 36 candidate frequency bands. The values describe the candidate band, elapsed scenario time, and only the receiver's previous observations: visits, HITs, MISSes, stale bands, pulse counts, and the previous scan result.

The frozen Random Forest returns an activity probability for each band. Candidate 17 combines that probability with visit staleness, inverse visit count, time since the last HIT, an uncertainty bonus, and a repeated-scan penalty. If a band reaches the 12.9-second maximum revisit gap, the safety rule restricts selection to overdue bands. The receiver selects one band, reveals only that band's activity during its dwell, updates only that band's history, and repeats.

Emitter IDs, future pulses, and unobserved-band activity are not input features or online score terms.

## Install

Python 3.12 is recommended.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run frozen inference

```powershell
python run_v3.py "C:\path	o\config_115.h5" --output "v3_decisions.csv"
```

For a quick smoke test, limit the simulated duration:

```powershell
python run_v3.py "C:\path	o\compatible_stare_file.h5" --max-duration-s 2 --output "demo_decisions.csv"
```

The output CSV has one row per decision, including selected band, RF probability, final V3 score, HIT/MISS result, and observed pulse count.

## Compatible TSRD scenarios

The input file must be a TSRD Stare HDF5 scenario with `/data`, `/labels`, `/metadata`, `/metadata/feature_names`, and receiver metadata. Its feature layout must contain `ToA`, `Frequency`, `PulseWidth`, `AoA`, and `Amplitude`. The package preserves the validated 36-band, 500 MHz receiver model and TSRD-inspired 0.05/0.10-second dwell timing.

## Frozen provenance

- Model: expanded Random Forest V2.
- Scheduler: Smart Scheduler V3 Candidate 17.
- Model fitting used TRAIN scenarios only; model and threshold selection used VALIDATION only.
- V3 parameter selection used VALIDATION only.
- The final HOLDOUT evaluation was executed once and did not modify these artifacts.

`verification_report.json` explains the exact checks. The original frozen manifest did not store a hash for the H5 loader source; this package records its SHA-256 and verifies that the exact imported source predates the one-time final evaluation. RF, feature-generator, and scheduler hashes match the frozen records directly.

This package was validated on unseen synthetic TSRD scenarios. It has not been validated on real radar hardware and is not a claim of operational deployment readiness.
