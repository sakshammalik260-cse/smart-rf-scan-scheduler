import pytest

from app.services.model_loader import ModelVerificationError, verify_artifact_hash


def test_sha_verification_rejects_wrong_hash(tmp_path) -> None:
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"not the frozen model")
    with pytest.raises(ModelVerificationError, match="Frozen model verification failed"):
        verify_artifact_hash(str(artifact), "0" * 64)