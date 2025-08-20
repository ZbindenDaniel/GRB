import io
import os
from pathlib import Path
from typing import List

import httpx
import segno
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_index():
    return FileResponse("static/index.html")


@app.post("/intake")
async def intake(files: List[UploadFile] = File(...)):
    upload_dir = Path("uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for file in files:
        dest = upload_dir / file.filename
        with open(dest, "wb") as f:
            f.write(await file.read())
        saved.append({"filename": file.filename, "path": str(dest)})
    return {"files": saved}


@app.get("/nc/ping")
async def nc_ping():
    base_url = os.getenv("NC_BASE_URL")
    user = os.getenv("NC_USER")
    password = os.getenv("NC_APP_PASSWORD")
    if not base_url or not user or not password:
        return JSONResponse(status_code=500, content={"error": "Nextcloud credentials missing"})
    url = base_url.rstrip("/") + "/ocs/v1.php/cloud/capabilities"
    headers = {"OCS-APIRequest": "true"}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, auth=(user, password), headers=headers)
    return JSONResponse(status_code=resp.status_code, content=resp.json())


@app.get("/qr")
async def generate_qr(text: str):
    qr = segno.make(text)
    buf = io.BytesIO()
    qr.save(buf, kind="png")
    return Response(content=buf.getvalue(), media_type="image/png")
