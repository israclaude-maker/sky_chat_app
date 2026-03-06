import os
import sys

# Add your project directory to the sys.path
project_home = '/home/YOUR_CPANEL_USERNAME/chat_app'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Add virtualenv site-packages
venv_path = '/home/YOUR_CPANEL_USERNAME/virtualenv/chat_app/3.10/lib/python3.10/site-packages'
if venv_path not in sys.path:
    sys.path.insert(0, venv_path)

os.environ['DJANGO_SETTINGS_MODULE'] = 'chat_app.settings_production'

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
