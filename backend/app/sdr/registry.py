from dataclasses import dataclass

from app.schemas.sdr import DeviceCapabilities, RFInputMode, SDRDeviceDescriptor, SDRHardwareStatus
from app.sdr.base import SDRDevice
from app.sdr.mock import MockSDRDevice


@dataclass(frozen=True)
class DriverPlaceholder:
    device_id: str
    device_name: str
    driver_name: str
    manufacturer: str | None
    transmit_supported: bool
    message: str


class SDRDeviceRegistry:
    def __init__(self, mock: MockSDRDevice) -> None:
        self._devices: dict[str, SDRDevice] = {"mock_sdr": mock}
        self._placeholders = [
            DriverPlaceholder("rtl_sdr", "RTL-SDR", "rtl_sdr", "Realtek", False, "Physical SDR driver not installed."),
            DriverPlaceholder("hackrf", "HackRF", "hackrf", "Great Scott Gadgets", True, "Physical SDR driver not installed."),
            DriverPlaceholder("plutosdr", "PlutoSDR", "plutosdr", "Analog Devices", True, "Physical SDR driver not installed."),
        ]

    def get(self, device_id: str) -> SDRDevice | None:
        return self._devices.get(device_id)

    def descriptors(self) -> list[SDRDeviceDescriptor]:
        descriptors = [self._descriptor_for_device("mock_sdr", self._devices["mock_sdr"])]
        descriptors.extend(self._descriptor_for_placeholder(placeholder) for placeholder in self._placeholders)
        return descriptors

    def capabilities(self) -> list[DeviceCapabilities]:
        capabilities = [device.capabilities() for device in self._devices.values()]
        capabilities.extend(self._placeholder_capabilities(placeholder) for placeholder in self._placeholders)
        return capabilities

    def capability_for(self, device_id: str) -> DeviceCapabilities | None:
        for capability in self.capabilities():
            if capability.device_id == device_id:
                return capability
        return None

    @staticmethod
    def _descriptor_for_device(device_id: str, device: SDRDevice) -> SDRDeviceDescriptor:
        capabilities = device.capabilities()
        status: SDRHardwareStatus = "available" if capabilities.connected else "disconnected"
        return SDRDeviceDescriptor(
            device_id=device_id,
            device_name=capabilities.device_name,
            driver_name=capabilities.driver_name,
            input_mode="mock_sdr",
            driver_available=True,
            connected=capabilities.connected,
            simulated=capabilities.simulated,
            receive_supported=capabilities.receive_supported,
            transmit_supported=capabilities.transmit_supported,
            hardware_status=status,
            message="Mock SDR connected" if capabilities.connected else "Mock SDR available but disconnected.",
        )

    @staticmethod
    def _descriptor_for_placeholder(placeholder: DriverPlaceholder) -> SDRDeviceDescriptor:
        return SDRDeviceDescriptor(
            device_id=placeholder.device_id,
            device_name=placeholder.device_name,
            driver_name=placeholder.driver_name,
            input_mode="live_sdr",
            driver_available=False,
            connected=False,
            simulated=False,
            receive_supported=True,
            transmit_supported=placeholder.transmit_supported,
            hardware_status="driver_not_installed",
            message=placeholder.message,
        )

    @staticmethod
    def _placeholder_capabilities(placeholder: DriverPlaceholder) -> DeviceCapabilities:
        return DeviceCapabilities(
            device_id=placeholder.device_id,
            device_name=placeholder.device_name,
            driver_name=placeholder.driver_name,
            manufacturer=placeholder.manufacturer,
            connected=False,
            simulated=False,
            receive_supported=True,
            transmit_supported=placeholder.transmit_supported,
            metadata={"driver_available": False},
            warnings=[
                "Physical SDR driver not installed.",
                "No hardware detection has been performed for this unavailable driver.",
                "Transmit support is informational only; this application exposes receive-only operations.",
            ],
        )
