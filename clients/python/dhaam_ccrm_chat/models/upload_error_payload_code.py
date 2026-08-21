from enum import Enum


class UploadErrorPayloadCode(str, Enum):
    NO_FILE = "NO_FILE"
    UNAUTHORIZED = "UNAUTHORIZED"
    UPLOAD_ERROR = "UPLOAD_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"

    def __str__(self) -> str:
        return str(self.value)
