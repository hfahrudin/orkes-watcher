from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ORKES_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://orkes:orkes@localhost:5432/orkes"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "orkes"
    minio_secret_key: str = "orkes12345"
    minio_secure: bool = False
    minio_bucket: str = "orkes-traces"

    session_cookie_name: str = "orkes_session"
    # MVP: no bus, single process — buffered ingest + live fan-out live in-memory.
    # None of this survives a restart; see ARCHITECTURE.md's "cut for MVP" list.
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    bootstrap_admin_email: str = "admin@orkes.local"
    bootstrap_admin_password: str = "changeme"
    bootstrap_admin_name: str = "Admin"


settings = Settings()
