from app.schemas.sdr import SDRDriverErrorCode, SDRDriverErrorDetail


class SDRDriverError(RuntimeError):
    def __init__(self, code: SDRDriverErrorCode, message: str, device_id: str | None = None) -> None:
        super().__init__(message)
        self.detail = SDRDriverErrorDetail(code=code, message=message, device_id=device_id)
