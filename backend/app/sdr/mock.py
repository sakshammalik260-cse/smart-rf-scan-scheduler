import math

from app.schemas.sdr import MockBand, PulseEvent, SDRObservation, SDRStatus
from app.sdr.base import SDRDevice


class MockSDRDevice(SDRDevice):
    MIN_FREQUENCY_HZ = 70e6
    MAX_FREQUENCY_HZ = 6e9
    DEFAULT_FREQUENCY_HZ = 915e6
    DEFAULT_SAMPLE_RATE_HZ = 2.4e6
    NOISE_FLOOR_DBM = -92.0

    @classmethod
    def default_band_plan(cls) -> list[MockBand]:
        bandwidth_hz = 150e6
        return [
            MockBand(
                band_id=band_id,
                low_frequency_hz=100e6 + band_id * bandwidth_hz,
                high_frequency_hz=100e6 + (band_id + 1) * bandwidth_hz,
                center_frequency_hz=175e6 + band_id * bandwidth_hz,
                dwell_time_s=0.05 if band_id % 3 else 0.10,
            )
            for band_id in range(36)
        ]

    def __init__(self) -> None:
        self._connected = False
        self._center_frequency_hz = self.DEFAULT_FREQUENCY_HZ
        self._sample_rate_hz = self.DEFAULT_SAMPLE_RATE_HZ
        self._last_observation: SDRObservation | None = None

    def status(self) -> SDRStatus:
        observation = self._last_observation
        return SDRStatus(
            input_mode="mock_sdr",
            hardware_status="available" if self._connected else "disconnected",
            device_name="Mock SDR (software simulation)",
            connected=self._connected,
            supported_frequency_min_hz=self.MIN_FREQUENCY_HZ,
            supported_frequency_max_hz=self.MAX_FREQUENCY_HZ,
            center_frequency_hz=self._center_frequency_hz if self._connected else None,
            sample_rate_hz=self._sample_rate_hz if self._connected else None,
            observed_power_dbm=observation.observed_power_dbm if observation else None,
            estimated_noise_floor_dbm=observation.estimated_noise_floor_dbm if observation else None,
            activity_detected=observation.activity_detected if observation else None,
            capture_duration_s=observation.capture_duration_s if observation else None,
            simulated=True,
            message="Software simulated SDR - no physical RF measurements.",
        )

    def connect(self) -> SDRStatus:
        self._connected = True
        return self.status()

    def disconnect(self) -> SDRStatus:
        self._connected = False
        return self.status()

    def tune(self, frequency_hz: float) -> SDRStatus:
        self._require_connected()
        if not self.MIN_FREQUENCY_HZ <= frequency_hz <= self.MAX_FREQUENCY_HZ:
            raise ValueError("Frequency is outside the Mock SDR supported range")
        self._center_frequency_hz = frequency_hz
        self._last_observation = None
        return self.status()

    def set_sample_rate(self, sample_rate_hz: float) -> SDRStatus:
        self._require_connected()
        if not 250e3 <= sample_rate_hz <= 20e6:
            raise ValueError("Sample rate must be between 250000 and 20000000 Hz")
        self._sample_rate_hz = sample_rate_hz
        return self.status()

    def capture(self, duration_s: float) -> SDRObservation:
        self._require_connected()
        if duration_s <= 0:
            raise ValueError("Capture duration must be greater than zero")
        phase = self._center_frequency_hz / 1e9 * math.pi
        activity_detected = math.sin(phase) > 0.15
        pulse_count = 2 + int(abs(math.sin(phase * 2.0)) * 2) if activity_detected else 0
        power_dbm = -54.0 if activity_detected else -87.0
        events = [
            PulseEvent(
                timestamp_s=index * duration_s / max(pulse_count, 1),
                frequency_hz=self._center_frequency_hz,
                pulse_width_s=0.0001,
                amplitude_dbm=power_dbm,
            )
            for index in range(pulse_count)
        ]
        observation = SDRObservation(
            input_mode="mock_sdr",
            device_name="Mock SDR (software simulation)",
            timestamp_s=0.0,
            center_frequency_hz=self._center_frequency_hz,
            bandwidth_hz=500e6,
            sample_rate_hz=self._sample_rate_hz,
            dwell_time_s=duration_s,
            observed_power_dbm=power_dbm,
            estimated_noise_floor_dbm=self.NOISE_FLOOR_DBM,
            activity_detected=activity_detected,
            capture_duration_s=duration_s,
            pulse_count=pulse_count,
            detected_events=events,
            simulated=True,
            message="Software simulated SDR - no physical RF measurements.",
        )
        self._last_observation = observation
        return observation

    def measure_power(self) -> SDRObservation:
        self._require_connected()
        return self.capture(0.001)

    def _require_connected(self) -> None:
        if not self._connected:
            raise RuntimeError("Mock SDR is not connected")