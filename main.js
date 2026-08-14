const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const Bonjour = require('bonjour-service').default;
const WebSocket = require('ws');

// Force WebRTC ICE candidates to use raw LAN IPs
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow;
app.isQuitting = false; 

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 480, height: 480, autoHideMenuBar: true,
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false 
        }
    });
    mainWindow.loadFile('index.html');

    // Intercept window close to minimize to the dock
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.minimize();
        }
        return false;
    });
}

app.whenReady().then(() => {
    createWindow();

    // Mute button mechanism
    globalShortcut.register('CommandOrControl+Shift+M', () => {
        if (mainWindow) mainWindow.webContents.send('toggle-mute-shortcut');
    });

    // Quit button mechanism 
    ipcMain.on('quit-app', () => {
        app.isQuitting = true;
        app.quit();
    });

    // Hard restart mechanism to pick up hardware plug changes
    ipcMain.on('relaunch-app', () => {
        app.relaunch();
        app.exit(0);
    });

    const wss = new WebSocket.Server({ port: 0, host: '0.0.0.0' }, () => {
        const MY_PORT = wss.address().port;

        wss.on('connection', (ws, req) => {
            let senderIp = req.socket.remoteAddress;
            if (senderIp.includes('::ffff:')) senderIp = senderIp.split('::ffff:')[1];
            
            ws.on('message', (message) => {
                const data = JSON.parse(message.toString());
                data.senderIp = senderIp;
                mainWindow.webContents.send('signal-receive', data);
            });
        });

        ipcMain.on('start-discovery', (event, username) => {
            const bonjour = new Bonjour();
            const myServiceName = `Iris-${Math.floor(Math.random() * 10000)}`;

            bonjour.publish({ 
                name: myServiceName, 
                type: 'mcvoice', 
                port: MY_PORT,
                txt: { username: username } 
            });

            const browser = bonjour.find({ type: 'mcvoice' });
            browser.on('up', (service) => {
                if (service.name === myServiceName) return; 
                
                const realIp = service.addresses.find(ip => 
                    ip.includes('.') && 
                    !ip.startsWith('127.') && 
                    !ip.startsWith('172.') && 
                    !ip.startsWith('169.254.')
                ) || service.addresses[0];

                const displayName = (service.txt && service.txt.username) ? service.txt.username : service.name;

                mainWindow.webContents.send('peer-found', { 
                    name: displayName, 
                    ip: realIp, 
                    port: service.port 
                });
            });
        });

        ipcMain.on('signal-send', (event, { ip, port, data }) => {
            data.senderPort = MY_PORT; 
            const ws = new WebSocket(`ws://${ip}:${port}`);
            ws.on('open', () => { ws.send(JSON.stringify(data)); ws.close(); });
            ws.on('error', (err) => { console.error(`Signaling failed to ${ip}:${port} -`, err.message); }); 
        });
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
