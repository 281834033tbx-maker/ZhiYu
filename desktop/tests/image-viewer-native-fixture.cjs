// Isolated Electron fixture: no real profile, no production API requests.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const profile=path.join(process.env.ZHIYU_QA_STAGE,'output/native-viewer-user-data');
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
let main=null;
require('./image-viewer').registerImageViewer({baseURL:process.env.ZHIYU_QA_ORIGIN+'/',preload:path.join(__dirname,'preload.js'),allowedSender:sender=>main?.webContents===sender});
app.whenReady().then(()=>{main=new BrowserWindow({width:1060,height:720,show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});main.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());
