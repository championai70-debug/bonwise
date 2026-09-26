# Tests never use the network: the Photon backup (nearby shops) is off unless a test
# points it at a fake server.
from bonwise import config

config.PHOTON_URL = ""

# Open Prices data changes every week, so tests use a fixed sample (or none).
from bonwise import openprices  # noqa: E402

openprices.reset("/nonexistent/open_prices.json")
