import argparse
import os
import configuration
from constants import CWD
import logging
import sys

logging.basicConfig(
  level=logging.INFO,
  datefmt="%d/%m/%Y %H:%M:%S",
  format="[%(asctime)s][%(name)s][%(levelname)s] ==> %(message)s",
  handlers=[logging.StreamHandler(stream=sys.stdout)]
)

    
Log = logging.getLogger(__name__)

parser = argparse.ArgumentParser(description='Telegram Manager')

parser.add_argument('config',
                    type=str,
                    help='config file path',
                    nargs="?",
                    default=os.path.join( CWD, "config.yaml") )

parser.add_argument('data',
                    type=str,
                    nargs="?",
                    help=f"data folder, default to {os.path.join( CWD, "data/")}")

parser.add_argument('database',
                    type=str,
                    nargs="?",
                    help="database URI for mongodb",
                    default="")

parser.add_argument('log',
                    type=str,
                    nargs="?",
                    help="set log level",
                    choices=['no', 'error', 'warn', 'info', 'debug'])

parser.add_argument('--http',
                    type = bool,
                    help='enable the HTTP server',
                    action=argparse.BooleanOptionalAction
                    )

parser.add_argument('http_host',
                    type = str,
                    nargs='?',
                    help='HTTP bind ip'
                    )

parser.add_argument('http_port',
                    type = int,
                    nargs='?',
                    help='HTTP bind port'
                    )

parser.add_argument('http_user',
                    type = str,
                    nargs='?',
                    help='HTTP Basic Auth user'
                    )

parser.add_argument('http_pass',
                    type = str,
                    nargs='?',
                    help='HTTP Basic Auth password'
                    )

Args = parser.parse_args()

if not os.path.exists(Args.config) :
  raise Exception(f"Config file '{Args.config}' is missing")


configuration.load_config(Args)

if not os.path.exists(configuration.Config.data):
  os.makedirs(configuration.onfig.data)


Log.info(f"using {configuration.Config.data} as data folder")

if configuration.Config.logger == 'debug':
  logging.root.setLevel(level=logging.DEBUG)
elif configuration.Config.logger == 'info':
  logging.root.setLevel(level=logging.INFO)
if configuration.Config.logger == 'warn':
  logging.root.setLevel(level=logging.WARN)
if configuration.Config.logger == 'error':
  logging.root.setLevel(level=logging.ERROR)
if configuration.Config.logger == 'no':
  logging.root.setLevel(level=logging.FATAL)
