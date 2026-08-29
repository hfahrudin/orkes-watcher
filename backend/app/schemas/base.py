from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """snake_case in Python, camelCase over the wire — matches the frontend's existing
    TypeScript types (lib/types.ts) so swapping mockApi.ts for real fetch calls needs no
    field renaming on the client side."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)
