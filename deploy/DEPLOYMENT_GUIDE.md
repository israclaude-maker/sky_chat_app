# SkyChat Deployment Guide

## ⚠️ Important: WebSocket Support

Your chat app uses **WebSockets** for real-time messaging. Standard shared cPanel hosting **does NOT support WebSockets**.

### Hosting Options:

| Option | WebSocket Support | Cost | Difficulty |
|--------|-------------------|------|------------|
| **Railway.app** | ✅ Yes | Free tier available | Easy |
| **Render.com** | ✅ Yes | Free tier available | Easy |
| **DigitalOcean VPS** | ✅ Yes | $4-6/month | Medium |
| **PythonAnywhere** | ⚠️ Limited | Free tier | Easy |
| **Shared cPanel** | ❌ No | Varies | Hard |

---

## Option 1: Railway.app (Recommended - Easiest)

### Step 1: Prepare Files
```bash
# Copy settings_production.py to chat_app/
cp deploy/settings_production.py chat_app/settings_production.py
```

### Step 2: Create Procfile
Create `Procfile` in project root:
```
web: daphne -b 0.0.0.0 -p $PORT chat_app.asgi:application
```

### Step 3: Create runtime.txt
```
python-3.10.12
```

### Step 4: Update settings_production.py
- Change `ALLOWED_HOSTS` to include your Railway domain
- Set `SECRET_KEY` from environment variable

### Step 5: Deploy
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your chat_app repository
5. Add environment variables:
   - `DJANGO_SETTINGS_MODULE=chat_app.settings_production`
   - `DJANGO_SECRET_KEY=your-random-secret-key`
6. Deploy!

Your app will be live at `your-app.railway.app`

---

## Option 2: DigitalOcean VPS ($4-6/month)

### Step 1: Create Droplet
1. Go to DigitalOcean.com
2. Create Ubuntu 22.04 droplet ($4/month)
3. Connect via SSH

### Step 2: Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and dependencies
sudo apt install python3.10 python3.10-venv python3-pip nginx supervisor -y

# Create app directory
mkdir -p /var/www/chat_app
cd /var/www/chat_app

# Upload your code (via git or scp)
git clone YOUR_REPO_URL .

# Create virtual environment
python3.10 -m venv venv
source venv/bin/activate
pip install -r deploy/requirements.txt

# Copy production settings
cp deploy/settings_production.py chat_app/settings_production.py

# Collect static files
python manage.py collectstatic --settings=chat_app.settings_production

# Run migrations
python manage.py migrate --settings=chat_app.settings_production
```

### Step 3: Supervisor Config
Create `/etc/supervisor/conf.d/chat_app.conf`:
```ini
[program:chat_app]
command=/var/www/chat_app/venv/bin/daphne -b 127.0.0.1 -p 8001 chat_app.asgi:application
directory=/var/www/chat_app
user=www-data
autostart=true
autorestart=true
environment=DJANGO_SETTINGS_MODULE="chat_app.settings_production"
```

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start chat_app
```

### Step 4: Nginx Config
Create `/etc/nginx/sites-available/chat_app`:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location /static/ {
        alias /var/www/chat_app/staticfiles/;
    }

    location /media/ {
        alias /var/www/chat_app/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/chat_app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 5: SSL Certificate (Free)
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Option 3: Shared cPanel (Limited - No WebSockets)

⚠️ **Warning**: Real-time messaging will NOT work. App will require page refresh.

### Step 1: Access cPanel
1. Login to your cPanel
2. Go to "Setup Python App"

### Step 2: Create Python App
1. Click "Create Application"
2. Python version: 3.10
3. Application root: `chat_app`
4. Application URL: Leave empty or subdomain
5. Application startup file: `passenger_wsgi.py`

### Step 3: Upload Files
1. Use File Manager or FTP
2. Upload all project files to `chat_app` folder
3. Copy `deploy/passenger_wsgi.py` to the root
4. Copy `deploy/settings_production.py` to `chat_app/`

### Step 4: Install Dependencies
```bash
# In cPanel terminal or SSH
cd ~/chat_app
source /home/USERNAME/virtualenv/chat_app/3.10/bin/activate
pip install -r deploy/requirements.txt
```

### Step 5: Update passenger_wsgi.py
Edit `passenger_wsgi.py` and replace:
- `YOUR_CPANEL_USERNAME` with your actual cPanel username

### Step 6: Update settings_production.py
- Update `ALLOWED_HOSTS` with your domain
- Update `SECRET_KEY`

### Step 7: Collect Static & Migrate
```bash
python manage.py collectstatic --settings=chat_app.settings_production --noinput
python manage.py migrate --settings=chat_app.settings_production
```

### Step 8: Restart App
In cPanel → Setup Python App → Click "Restart"

---

## Desktop App - Update Server URL

After deployment, update the desktop app to connect to your live server:

Edit `desktop/main.js`:
```javascript
// Change this line:
const SERVER_URL = 'http://127.0.0.1:8000';

// To your live server:
const SERVER_URL = 'https://yourdomain.com';
```

Then rebuild:
```bash
cd desktop
npm run build:win
```

---

## Troubleshooting

### "502 Bad Gateway"
- Check if Daphne/Gunicorn is running
- Check supervisor logs: `sudo tail -f /var/log/supervisor/chat_app-*.log`

### "Static files not loading"
- Run `python manage.py collectstatic`
- Check Nginx static file path

### "WebSocket connection failed"
- Make sure you're using a host that supports WebSockets
- Check Nginx WebSocket configuration
- Verify `proxy_set_header Upgrade` is present

### "CSRF verification failed"
- Add your domain to `CSRF_TRUSTED_ORIGINS` in settings
- Ensure you're using HTTPS and `CSRF_COOKIE_SECURE = True`
