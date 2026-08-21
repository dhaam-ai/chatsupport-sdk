from enum import Enum


class UploadResponseMediaType(str, Enum):
    AUDIO = "audio"
    DOCUMENTS = "documents"
    IMAGES = "images"
    VIDEOS = "videos"

    def __str__(self) -> str:
        return str(self.value)
