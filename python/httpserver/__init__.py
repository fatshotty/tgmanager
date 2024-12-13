import logging
from configuration import Config
from aiohttp import web
import os
from .routes import routes
from aiohttp_basicauth import BasicAuthMiddleware
from constants import CWD
from ipaddress import IPv4Address, IPv4Network

logger = logging.getLogger("WEB")

class CustomBasicAuth(BasicAuthMiddleware):

  net = None

  def __init__(self, force=True):
    super().__init__(force= force)
    if Config.http.ignoreAuthFor:
      self.net = IPv4Network(Config.http.ignoreAuthFor)
    
  async def check_credentials(self, username, password, request):
    logger.debug(f"request from: {str(request.remote)}")

    if Config.http.user and Config.http.password:
      if self.net is not None:
        ip = IPv4Address(str(request.remote)) 
        if ip in self.net:
          logger.info(f"request from {str(request.remote)} is in class {Config.http.ignoreAuthFor}, skip AUTH")
          return True
      else:
        return username == Config.http.user and password == Config.http.password
    
    return True


Auth = CustomBasicAuth(force= False)

@Auth.ignore
async def ping(request):
  return web.json_response( {'status': 'OK'} )

def web_server():
  logger.debug("Initializing..")
  
  web_app = web.Application(middlewares=[Auth], client_max_size=100 * 1024 * 1024 * 1024)
  web_app.router.add_get('/ping', ping)
  web_app.add_routes(routes)
  web_app.router.add_static('/public/', path= os.path.join(CWD, './public/'), name='static')
  return web_app