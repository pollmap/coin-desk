"""Read the same frozen source identifiers used by the application and collectors."""
import json
from pathlib import Path
REGISTRY = json.loads((Path(__file__).resolve().parents[1]/'shared/asset-registry.json').read_text(encoding='utf-8'))
ASSETS = {a['id']:a for a in REGISTRY['assets']}
def network_id(asset):
    return ASSETS[asset]['network']['id']
def network_fields(asset):
    return ASSETS[asset]['network']['metrics'] if ASSETS[asset]['network'] else {}
