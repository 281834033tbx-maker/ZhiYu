'use strict';
// Modern macOS ICNS supports PNG representations; no artwork is redrawn here.
const fs = require('node:fs');
const path = require('node:path');
const representations = [
  ['icp4','icon_16x16.png'],['icp5','icon_32x32.png'],['icp6','icon_32x32@2x.png'],
  ['ic07','icon_128x128.png'],['ic08','icon_256x256.png'],['ic09','icon_512x512.png'],
  ['ic10','icon_512x512@2x.png'],['ic11','icon_16x16@2x.png'],['ic12','icon_32x32@2x.png'],
  ['ic13','icon_128x128@2x.png'],['ic14','icon_256x256@2x.png'],
];
const chunks = representations.map(([type,file]) => {
  const png=fs.readFileSync(path.join(__dirname,'Icon.iconset',file));
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error(`Not a PNG: ${file}`);
  const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(png.length+8,4);
  return Buffer.concat([header,png]);
});
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((sum,chunk)=>sum+chunk.length,0),4);
fs.writeFileSync(path.join(__dirname,'icon.icns'),Buffer.concat([header,...chunks]));
