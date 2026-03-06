const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let tray;
let djangoProcess = null;

// Load config
let config = { serverUrl: 'http://127.0.0.1:8000', appName: 'SkyChat', mode: 'local' };
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
} catch (e) {
    console.error('Failed to load config:', e);
}

const SERVER_URL = config.serverUrl;
const APP_NAME = config.appName;
const APP_MODE = config.mode || 'local'; // 'local' or 'remote'

// Determine paths based on whether we're in development or production
function getPaths() {
    const isDev = !app.isPackaged;
    
    if (isDev) {
        // Development: use the parent directory (chat_app)
        const projectRoot = path.resolve(__dirname, '..');
        return {
            pythonPath: path.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
            managePyPath: path.join(projectRoot, 'manage.py'),
            projectRoot: projectRoot
        };
    } else {
        // Production: look for bundled Python in resources
        const resourcesPath = process.resourcesPath;
        return {
            pythonPath: path.join(resourcesPath, 'python', 'python.exe'),
            managePyPath: path.join(resourcesPath, 'backend', 'manage.py'),
            projectRoot: path.join(resourcesPath, 'backend')
        };
    }
}

// Check if server is already running
function isServerRunning(url) {
    return new Promise((resolve) => {
        http.get(url, (res) => {
            resolve(true);
        }).on('error', () => {
            resolve(false);
        });
    });
}

// Wait for server to be available
function waitForServer(url, maxAttempts = 30) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            attempts++;
            http.get(url, (res) => {
                resolve(true);
            }).on('error', () => {
                if (attempts < maxAttempts) {
                    setTimeout(check, 1000);
                } else {
                    reject(new Error('Server failed to start'));
                }
            });
        };
        check();
    });
}

// Start Django server
async function startDjangoServer() {
    const paths = getPaths();
    
    // Check if server is already running
    const running = await isServerRunning(SERVER_URL);
    if (running) {
        console.log('Django server already running');
        return true;
    }
    
    // Check if Python exists
    if (!fs.existsSync(paths.pythonPath)) {
        console.error('Python not found at:', paths.pythonPath);
        // Show error dialog
        const { dialog } = require('electron');
        dialog.showErrorBox('Server Error', 
            `Django server could not start.\n\nPython not found at: ${paths.pythonPath}\n\nPlease ensure the Python virtual environment is set up or start the Django server manually:\npython manage.py runserver`);
        return false;
    }
    
    console.log('Starting Django server...');
    console.log('Python path:', paths.pythonPath);
    console.log('Manage.py path:', paths.managePyPath);
    
    djangoProcess = spawn(paths.pythonPath, [paths.managePyPath, 'runserver', '127.0.0.1:8000'], {
        cwd: paths.projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    
    djangoProcess.stdout.on('data', (data) => {
        console.log(`Django: ${data}`);
    });
    
    djangoProcess.stderr.on('data', (data) => {
        console.error(`Django Error: ${data}`);
    });
    
    djangoProcess.on('error', (error) => {
        console.error('Failed to start Django:', error);
    });
    
    djangoProcess.on('exit', (code) => {
        console.log(`Django process exited with code ${code}`);
        djangoProcess = null;
    });
    
    // Wait for server to be ready
    try {
        await waitForServer(SERVER_URL);
        console.log('Django server is ready');
        return true;
    } catch (error) {
        console.error('Django server failed to start:', error);
        return false;
    }
}

// Stop Django server
function stopDjangoServer() {
    if (djangoProcess) {
        console.log('Stopping Django server...');
        // On Windows, we need to kill the process tree
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', djangoProcess.pid, '/f', '/t']);
        } else {
            djangoProcess.kill('SIGTERM');
        }
        djangoProcess = null;
    }
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 400,
        minHeight: 600,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        },
        frame: true,
        titleBarStyle: 'default',
        backgroundColor: '#111b21',
        show: false
    });

    // Remove menu bar
    mainWindow.setMenuBarVisibility(false);
    
    // Load the Django server URL  
    console.log('Loading URL:', SERVER_URL);
    
    mainWindow.loadURL(SERVER_URL).then(() => {
        console.log('URL loaded successfully');
    }).catch(err => {
        console.error('Failed to load URL:', err);
    });

    // Handle load failures - show error page
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
        mainWindow.loadURL(`data:text/html,
            <html>
            <head>
                <style>
                    body { 
                        font-family: 'Segoe UI', sans-serif; 
                        background: #111b21; 
                        color: white; 
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        margin: 0;
                        flex-direction: column;
                    }
                    h1 { color: #25d366; }
                    p { color: #aaa; margin: 10px 0; }
                    button {
                        background: #25d366;
                        border: none;
                        color: white;
                        padding: 12px 24px;
                        font-size: 16px;
                        border-radius: 8px;
                        cursor: pointer;
                        margin-top: 20px;
                    }
                    button:hover { background: #128c7e; }
                    code { background: #1e2428; padding: 10px; border-radius: 5px; display: block; margin: 10px 0; }
                </style>
            </head>
            <body>
                <h1>SkyChat</h1>
                <p>Unable to connect to the server.</p>
                <p>Please ensure the Django server is running:</p>
                <code>python manage.py runserver</code>
                <button onclick="location.href='${SERVER_URL}'">Retry Connection</button>
            </body>
            </html>
        `);
    });

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Only open DevTools in development
        if (!app.isPackaged) {
            mainWindow.webContents.openDevTools();
        }
    });
    
    // Add keyboard shortcuts for refresh
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F5' || (input.control && input.key === 'r')) {
            mainWindow.webContents.reload();
            event.preventDefault();
        }
        if (input.control && input.shift && input.key === 'R') {
            mainWindow.webContents.reloadIgnoringCache();
            event.preventDefault();
        }
    });
    
    // Log when page finishes loading
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Page finished loading');
    });
    
    mainWindow.webContents.on('dom-ready', () => {
        console.log('DOM is ready');
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Handle page title changes for notifications
    mainWindow.webContents.on('page-title-updated', (event, title) => {
        // You can parse title for unread count and show badge
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
    let trayIcon;
    
    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            // Create a simple default icon if file not found
            trayIcon = nativeImage.createEmpty();
        }
    } catch (e) {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open SkyChat',
            click: () => {
                mainWindow.show();
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('SkyChat');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
    });

    tray.on('double-click', () => {
        mainWindow.show();
    });
}

// App ready
app.whenReady().then(async () => {
    try {
        console.log('App ready, starting...');
        console.log('App mode:', APP_MODE);
        
        // Only start Django server in local mode
        if (APP_MODE === 'local') {
            // Start Django server first
            const serverStarted = await startDjangoServer();
            
            if (!serverStarted) {
                // Server failed to start - still create window to show error or allow manual server start
                console.log('Warning: Django server not started. App may not work correctly.');
            }
        } else {
            console.log('Remote mode - skipping local Django server');
        }
        
        console.log('Creating window...');
        createWindow();
        
        console.log('Creating tray...');
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            } else {
                mainWindow.show();
            }
        });
        
        console.log('Startup complete');
    } catch (error) {
        console.error('Startup error:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('Startup Error', error.message);
    }
}).catch(error => {
    console.error('whenReady error:', error);
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Before quit - clean up Django server
app.on('before-quit', () => {
    app.isQuitting = true;
    stopDjangoServer();
});

// Also stop on quit event
app.on('quit', () => {
    stopDjangoServer();
});

// Handle certificate errors (development only)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // For development with self-signed certs
    event.preventDefault();
    callback(true);
});
