from uuid import UUID
from pydantic import Field
from app.modules.common import RequestModel, Versioned

class FloorCreate(RequestModel):
    name: str = Field(pattern=r"^[1-9][0-9]{0,2}$")

class FloorUpdate(FloorCreate, Versioned):
    pass

class TableCreate(RequestModel):
    name: str = Field(min_length=1, max_length=80)
    floor_id: UUID
    seats: int = Field(ge=1, le=100, strict=True)
    tax_rate: float = Field(default=15.0, ge=0.0, le=100.0)

class TableUpdate(TableCreate, Versioned):
    pass

class FloorTaxUpdate(RequestModel):
    tax_rate: float = Field(default=15.0, ge=0.0, le=100.0)
