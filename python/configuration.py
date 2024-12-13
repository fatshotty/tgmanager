import yaml
import os
from types import SimpleNamespace
from constants import UPLOAD_CHUNK, CWD

global Config
__Config = {}


def getYamlValue(options, keys, default = ""):
  obj = options
  for key in keys:
    if key in obj:
      obj = obj[key]
    else:
      return default
  return obj

def get_env(item):
  if item in os.environ:
    return os.environ[item]
  return None

def load_config(args):

  with open(args.config, 'r') as file:
    yamlFile = yaml.safe_load(file)


  uploadMinSize = int( getYamlValue(yamlFile, ['telegram', 'upload', 'min_size'], 0) )
  if uploadMinSize % UPLOAD_CHUNK != 0:
    raise Exception(f"Upload Min Size must be: ( UploadMinSize % {UPLOAD_CHUNK} == 0 )")
  
  __Config.update({
    "telegram": {
      "database": str( getYamlValue(yamlFile, ['telegram', 'database']) ) == 'true',
      "users": getYamlValue(yamlFile, ['telegram', 'users']),
      "upload": {
        "min_size": uploadMinSize,
        "channel": getYamlValue(yamlFile, ['telegram', 'upload', 'channel'] )
      },
      "notify": {
        "channel": getYamlValue(yamlFile, ['telegram', 'upload', 'channel'] )
      },
      "bot_token": getYamlValue(yamlFile, ['telegram','bot_token'])
    },
    "data": os.path.realpath( os.path.join( CWD, args.data or getYamlValue(yamlFile, ['data']) or './data/' ) ),
    
    "db": get_env('DB') or getYamlValue(yamlFile, ['db']),
    
    "logger": args.log or getYamlValue(yamlFile, ['logger']) or 'info',

    "http": {
      "enabled": args.http,
      "host": args.http_host or getYamlValue(yamlFile, ['http', 'host']),
      "port": args.http_port or getYamlValue(yamlFile, ['http', 'port']),
      "user": args.http_user or getYamlValue(yamlFile, ['http', 'user']),
      "password": args.http_pass or getYamlValue(yamlFile, ['http', 'pass']),
      "ignoreAuthFor": args.http_ignore_auth_for or getYamlValue(yamlFile, ['http', 'ignoreAuthFor']),
    },

    "strm": {
      "enabled": args.strm,
      "url": args.strm_url or getYamlValue(yamlFile, ['strm', 'url']),
      "source": args.strm_source or getYamlValue(yamlFile, ['strm', 'source']),
      "destination": args.strm_destination or getYamlValue(yamlFile, ['strm', 'destination']),
      "clear_folder": args.strm_clear_folder or getYamlValue(yamlFile, ['strm', 'clear_folder']),
    }
  })

  global Config
  Config = SimpleNamespace(**__Config)
  Config.telegram = SimpleNamespace(**Config.telegram)
  Config.telegram.upload = SimpleNamespace(**Config.telegram.upload)
  Config.telegram.notify = SimpleNamespace(**Config.telegram.notify)

  users = []
  for user in Config.telegram.users:
    users.append( SimpleNamespace(**user) )
  
  Config.telegram.users = users

  Config.http = SimpleNamespace( **Config.http )

  Config.strm = SimpleNamespace( **Config.strm )