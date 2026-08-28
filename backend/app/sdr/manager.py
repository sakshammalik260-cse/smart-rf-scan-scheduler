from app.schemas.sdr import MockBand, SDRObservation, SDRStatus
from app.sdr.mock import MockSDRDevice


class SDRDeviceManager:
    def __init__(self) -> None:
        self._mock = MockSDRDevice()

    def modes(self) -> list[dict[str, str]]:
        return [
            {"id": "tsrd_replay", "name": "TSRD Replay", "description": "Existing TSRD H5 simulation."},
            {"id": "mock_sdr", "name": "Mock SDR", "description": "Software simulated SDR - no physical RF measurements."},
            {"id": "live_sdr", "name": "Live SDR", "description": "Hardware integration placeholder - physical SDR not connected."},
        ]

    def status(self) -> SDRStatus:
        return self._mock.status()

    def band_plan(self) -> list[MockBand]:
        return self._mock.default_band_plan()

    def connect(self) -> SDRStatus:
        return self._mock.connect()

    def disconnect(self) -> SDRStatus:
        return self._mock.disconnect()

    def tune(self, frequency_hz: float) -> SDRStatus:
        return self._mock.tune(frequency_hz)

    def set_sample_rate(self, sample_rate_hz: float) -> SDRStatus:
        return self._mock.set_sample_rate(sample_rate_hz)

    def capture(self, duration_s: float) -> SDRObservation:
        return self._mock.capture(duration_s)


sdr_manager = SDRDeviceManager()