"""Render the current Coin Desk identity; retained entrypoint for existing docs."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("render_brand_v2.py")), run_name="__main__")
