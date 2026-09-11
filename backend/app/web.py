from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


def mount_frontend(application: FastAPI, directory: Path) -> None:
    # API routes must be registered first; only the built website is public.
    if (directory / "index.html").is_file():
        application.mount("/", StaticFiles(directory=directory, html=True), name="frontend")
