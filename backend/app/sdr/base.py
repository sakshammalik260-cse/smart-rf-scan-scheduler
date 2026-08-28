from abc import ABC, abstractmethod

from app.schemas.sdr import DeviceCapabilities, SDRObservation, SDRStatus


class SDRDevice(ABC):
    @abstractmethod
    def capabilities(self) -> DeviceCapabilities:
        raise NotImplementedError

    @abstractmethod
    def status(self) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def connect(self) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def disconnect(self) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def tune(self, frequency_hz: float) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def set_sample_rate(self, sample_rate_hz: float) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def set_bandwidth(self, bandwidth_hz: float) -> SDRStatus:
        raise NotImplementedError

    @abstractmethod
    def capture(self, duration_s: float) -> SDRObservation:
        raise NotImplementedError

    @abstractmethod
    def measure_power(self) -> SDRObservation:
        raise NotImplementedError
