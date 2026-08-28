from app.schemas.sdr import (
    BandPlanResponse,
    BandPlanValidationReport,
    DeviceCapabilities,
    MockBand,
    SDRDeviceDescriptor,
    SDRObservation,
    SDRStatus,
)
from app.sdr.mock import MockSDRDevice
from app.sdr.registry import SDRDeviceRegistry
from app.sdr.validation import validate_band_plan


class SDRDeviceManager:
    def __init__(self) -> None:
        self._mock = MockSDRDevice()
        self._registry = SDRDeviceRegistry(self._mock)

    def modes(self) -> list[dict[str, str]]:
        return [
            {"id": "tsrd_replay", "name": "TSRD Replay", "description": "Existing TSRD H5 simulation."},
            {"id": "mock_sdr", "name": "Mock SDR", "description": "Software simulated SDR - no physical RF measurements."},
            {
                "id": "live_sdr",
                "name": "Live SDR",
                "description": "SDR hardware not detected. The hardware integration layer is ready.",
            },
        ]

    def status(self) -> SDRStatus:
        return self._mock.status()

    def devices(self) -> list[SDRDeviceDescriptor]:
        return self._registry.descriptors()

    def capabilities(self) -> list[DeviceCapabilities]:
        return self._registry.capabilities()

    def capabilities_for(self, device_id: str = "mock_sdr") -> DeviceCapabilities | None:
        return self._registry.capability_for(device_id)

    def band_plan(self) -> list[MockBand]:
        return self._mock.default_band_plan()

    def band_plan_response(self) -> BandPlanResponse:
        return BandPlanResponse(
            input_mode="mock_sdr",
            simulated=True,
            bands=self.band_plan(),
            sample_rate_hz=self._mock.capabilities().current_sample_rate_hz or self._mock.DEFAULT_SAMPLE_RATE_HZ,
            bandwidth_hz=150e6,
            message="Mock SDR software band plan. Physical SDR band plans must be configured per device capabilities.",
        )

    def validate_band_plan(
        self,
        device_id: str,
        bands: list[MockBand] | None = None,
        sample_rate_hz: float | None = None,
        bandwidth_hz: float | None = None,
    ) -> BandPlanValidationReport:
        capabilities = self.capabilities_for(device_id)
        if capabilities is None:
            capabilities = DeviceCapabilities(
                device_id=device_id,
                device_name="Unknown SDR device",
                driver_name=device_id,
                connected=False,
                simulated=False,
                receive_supported=False,
                transmit_supported=False,
                warnings=["Device registry entry was not found."],
            )
        return validate_band_plan(
            capabilities,
            bands or self.band_plan(),
            sample_rate_hz if sample_rate_hz is not None else self._mock.DEFAULT_SAMPLE_RATE_HZ,
            bandwidth_hz,
        )

    def connect(self) -> SDRStatus:
        return self._mock.connect()

    def disconnect(self) -> SDRStatus:
        return self._mock.disconnect()

    def tune(self, frequency_hz: float) -> SDRStatus:
        return self._mock.tune(frequency_hz)

    def set_sample_rate(self, sample_rate_hz: float) -> SDRStatus:
        return self._mock.set_sample_rate(sample_rate_hz)

    def set_bandwidth(self, bandwidth_hz: float) -> SDRStatus:
        return self._mock.set_bandwidth(bandwidth_hz)

    def capture(self, duration_s: float) -> SDRObservation:
        return self._mock.capture(duration_s)


sdr_manager = SDRDeviceManager()
