"""GET/PUT /locations — Read and modify the yard map."""

import json
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
LOCATIONS_FILE = os.path.join(DATA_DIR, "locations.json")


class Location(BaseModel):
    x: float
    y: float


class LocationsResponse(BaseModel):
    locations: dict[str, Location]


@router.get("/locations", response_model=LocationsResponse)
async def get_locations():
    """Return the current yard map (zone name → {x, y})."""
    if not os.path.exists(LOCATIONS_FILE):
        return LocationsResponse(locations={})
    with open(LOCATIONS_FILE) as f:
        raw: dict = json.load(f)
    locs = {k: Location(x=v["x"], y=v["y"]) for k, v in raw.items()}
    return LocationsResponse(locations=locs)


@router.put("/locations", response_model=LocationsResponse)
async def update_locations(body: LocationsResponse):
    """Replace the yard map with new locations. Validates format."""
    for name, loc in body.locations.items():
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(400, f"Invalid location name: {name}")
    raw = {k: {"x": v.x, "y": v.y} for k, v in body.locations.items()}
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LOCATIONS_FILE, "w") as f:
        json.dump(raw, f, indent=2)
    return LocationsResponse(locations=body.locations)
