import io
import uuid
from functools import lru_cache

from minio import Minio
from minio.error import S3Error

from app.config.settings import settings


@lru_cache
def get_client() -> Minio:
    client = Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    if not client.bucket_exists(settings.minio_bucket):
        client.make_bucket(settings.minio_bucket)
    return client


def _object_name(project_id: uuid.UUID, run_id: uuid.UUID) -> str:
    return f"{project_id}/{run_id}.ndjson"


def put_trace(project_id: uuid.UUID, run_id: uuid.UUID, ndjson_bytes: bytes) -> None:
    client = get_client()
    client.put_object(
        settings.minio_bucket,
        _object_name(project_id, run_id),
        io.BytesIO(ndjson_bytes),
        length=len(ndjson_bytes),
        content_type="application/x-ndjson",
    )


def get_trace(project_id: uuid.UUID, run_id: uuid.UUID) -> bytes | None:
    client = get_client()
    try:
        response = client.get_object(settings.minio_bucket, _object_name(project_id, run_id))
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    except S3Error as e:
        if e.code == "NoSuchKey":
            return None
        raise


def delete_trace(project_id: uuid.UUID, run_id: uuid.UUID) -> None:
    client = get_client()
    client.remove_object(settings.minio_bucket, _object_name(project_id, run_id))


def list_object_ids() -> list[tuple[uuid.UUID, uuid.UUID]]:
    """(project_id, run_id) for every stored blob — used by scripts/sweep_orphan_blobs.py
    to find blobs whose `runs` row is gone (see DATABASE.md's retention note: a failure
    between deleting the blob and the row leaves an orphan, swept here rather than in the
    same transaction as the row delete)."""
    client = get_client()
    ids = []
    for obj in client.list_objects(settings.minio_bucket, recursive=True):
        project_str, _, run_file = obj.object_name.partition("/")
        run_str = run_file.removesuffix(".ndjson")
        try:
            ids.append((uuid.UUID(project_str), uuid.UUID(run_str)))
        except ValueError:
            continue  # not one of ours — ignore rather than fail the whole sweep
    return ids
