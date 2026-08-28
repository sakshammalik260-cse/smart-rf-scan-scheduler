from abc import ABC, abstractmethod

from app.schemas.sdr import SDRObservation, SDRStatus


class SDRDevice(ABC):
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
    def capture(self, duration_s: float) -> SDRObservation:
        raise NotImplementedError

    @abstractmethod
    def measure_power(self) -> SDRObservation:
        raise NotImplementedError