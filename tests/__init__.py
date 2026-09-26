# Tests never use the network: the Photon backup (nearby shops) is off unless a test
# points it at a fake server.
from bonwise import config

config.PHOTON_URL = ""
