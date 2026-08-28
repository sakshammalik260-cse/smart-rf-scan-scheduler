from app.schemas.sdr import BandPlanValidationReport, DeviceCapabilities, FrequencyCoverage, MockBand, RejectedBand


def validate_band_plan(
    capabilities: DeviceCapabilities,
    bands: list[MockBand],
    sample_rate_hz: float | None = None,
    bandwidth_hz: float | None = None,
) -> BandPlanValidationReport:
    errors: list[str] = []
    warnings: list[str] = list(capabilities.warnings)
    rejected_bands: list[RejectedBand] = []
    enabled_bands = [band for band in bands if band.enabled]

    if not capabilities.receive_supported:
        errors.append("Device does not support receive operations.")
    if not capabilities.simulated and not capabilities.connected:
        warnings.append("Physical SDR is not connected; validation is capability-only.")
    if capabilities.min_frequency_hz is None or capabilities.max_frequency_hz is None:
        errors.append("Device frequency coverage is unknown.")
    if not enabled_bands:
        errors.append("Band plan must include at least one enabled band.")

    _validate_requested_sample_rate(capabilities, sample_rate_hz, errors)
    _validate_requested_bandwidth(capabilities, bandwidth_hz, errors)

    for band in enabled_bands:
        reasons = _band_rejection_reasons(capabilities, band)
        if reasons:
            rejected_bands.append(RejectedBand(band_id=band.band_id, reasons=reasons))

    overlap_errors = _overlap_errors(enabled_bands)
    errors.extend(overlap_errors)
    usable_band_count = len(enabled_bands) - len(rejected_bands)
    compatible = not errors and not rejected_bands and usable_band_count > 0
    return BandPlanValidationReport(
        device_id=capabilities.device_id,
        compatible=compatible,
        errors=errors,
        warnings=warnings,
        usable_band_count=max(usable_band_count, 0),
        rejected_bands=rejected_bands,
        device_frequency_coverage_hz=FrequencyCoverage(
            min_frequency_hz=capabilities.min_frequency_hz,
            max_frequency_hz=capabilities.max_frequency_hz,
        ),
        requested_frequency_coverage_hz=_requested_coverage(enabled_bands),
        simulated=capabilities.simulated,
    )


def _validate_requested_sample_rate(capabilities: DeviceCapabilities, sample_rate_hz: float | None, errors: list[str]) -> None:
    if sample_rate_hz is None:
        return
    if capabilities.min_sample_rate_hz is not None and sample_rate_hz < capabilities.min_sample_rate_hz:
        errors.append("Requested sample rate is below the device minimum.")
    if capabilities.max_sample_rate_hz is not None and sample_rate_hz > capabilities.max_sample_rate_hz:
        errors.append("Requested sample rate is above the device maximum.")
    if capabilities.supported_sample_rates_hz and sample_rate_hz not in capabilities.supported_sample_rates_hz:
        errors.append("Requested sample rate is not in the supported sample-rate list.")


def _validate_requested_bandwidth(capabilities: DeviceCapabilities, bandwidth_hz: float | None, errors: list[str]) -> None:
    if bandwidth_hz is None:
        return
    if capabilities.max_bandwidth_hz is not None and bandwidth_hz > capabilities.max_bandwidth_hz:
        errors.append("Requested bandwidth is above the device maximum.")
    if capabilities.current_sample_rate_hz is not None and bandwidth_hz > capabilities.current_sample_rate_hz:
        errors.append("Requested bandwidth exceeds the current sample rate.")


def _band_rejection_reasons(capabilities: DeviceCapabilities, band: MockBand) -> list[str]:
    reasons: list[str] = []
    if capabilities.min_frequency_hz is not None and band.low_frequency_hz < capabilities.min_frequency_hz:
        reasons.append("Band low frequency is outside the device range.")
    if capabilities.max_frequency_hz is not None and band.high_frequency_hz > capabilities.max_frequency_hz:
        reasons.append("Band high frequency is outside the device range.")
    if not band.low_frequency_hz <= band.center_frequency_hz <= band.high_frequency_hz:
        reasons.append("Band center frequency is outside the band edges.")
    if band.bandwidth_hz is None or band.bandwidth_hz <= 0:
        reasons.append("Band bandwidth must be greater than zero.")
    elif capabilities.max_bandwidth_hz is not None and band.bandwidth_hz > capabilities.max_bandwidth_hz:
        reasons.append("Band bandwidth exceeds the device maximum.")
    if band.dwell_time_s <= 0:
        reasons.append("Band dwell time must be greater than zero.")
    return reasons


def _overlap_errors(bands: list[MockBand]) -> list[str]:
    errors: list[str] = []
    sorted_bands = sorted(bands, key=lambda band: band.low_frequency_hz)
    for previous, current in zip(sorted_bands, sorted_bands[1:]):
        if current.low_frequency_hz < previous.high_frequency_hz:
            errors.append(f"Enabled bands {previous.band_id} and {current.band_id} overlap.")
    return errors


def _requested_coverage(bands: list[MockBand]) -> FrequencyCoverage:
    if not bands:
        return FrequencyCoverage()
    return FrequencyCoverage(
        min_frequency_hz=min(band.low_frequency_hz for band in bands),
        max_frequency_hz=max(band.high_frequency_hz for band in bands),
    )
