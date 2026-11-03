/** File-internal provenance only: pixel payload is preserved. This is not a
 * blanket certification of all distribution/export legal requirements. */
export function aigcProvenance(contentId:string){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(contentId))throw Error('图片内容编号无效');
  return {AIGC:{Label:'1',ContentProducer:'智域',ProduceID:contentId,ReservedCode1:'',ContentPropagator:'智域',PropagateID:contentId,ReservedCode2:''}};
}
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pngChunk(type:string,data:Buffer){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);}
const xmlEscape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function addImageAigcMetadata(bytes:Buffer,contentId:string):Buffer{
  const text=JSON.stringify(aigcProvenance(contentId));
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    let offset=8;while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(length>bytes.length-offset-12)break;
      if(type==='IEND')return Buffer.concat([bytes.subarray(0,offset),pngChunk('iTXt',Buffer.concat([Buffer.from('AIGC\0\0\0\0\0'),Buffer.from(text)])),bytes.subarray(offset)]);offset+=length+12;}
    throw Error('PNG结构无效，未交付未标识图片');
  }
  const xml=Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:zy="urn:zhiyu:aigc" zy:AIGC="'+xmlEscape(text)+'"/></rdf:RDF></x:xmpmeta>');
  if(bytes[0]===0xff&&bytes[1]===0xd8){const data=Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'),xml]),head=Buffer.alloc(4);head[0]=0xff;head[1]=0xe1;head.writeUInt16BE(data.length+2,2);return Buffer.concat([bytes.subarray(0,2),head,data,bytes.subarray(2)]);}
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())){const end=bytes.length-1;if(bytes[end]!==0x3b)throw Error('GIF结构无效');const data=Buffer.from('AIGC='+text),blocks=[Buffer.from([0x21,0xfe])];for(let offset=0;offset<data.length;offset+=255){const chunk=data.subarray(offset,offset+255);blocks.push(Buffer.from([chunk.length]),chunk);}blocks.push(Buffer.from([0]));return Buffer.concat([bytes.subarray(0,end),...blocks,bytes.subarray(end)]);}
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const chunks:Buffer[]=[];let offset=12,extended=false,width=0,height=0,alpha=false;
    while(offset+8<=bytes.length){const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(size>bytes.length-offset-8)throw Error('WebP结构无效');const chunk=Buffer.from(bytes.subarray(offset,offset+8+size+(size%2)));
      if(name==='VP8X'){chunk[8]|=4;extended=true;}if(name==='ALPH')alpha=true;
      if(name==='VP8 '&&size>=10){width=bytes.readUInt16LE(offset+14)&0x3fff;height=bytes.readUInt16LE(offset+16)&0x3fff;}
      if(name==='VP8L'&&size>=5){const bits=bytes.readUInt32LE(offset+9);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;alpha=!!(bits&(1<<28));}
      chunks.push(chunk);offset+=8+size+(size%2);
    }
    if(!extended){if(!width||!height)throw Error('WebP尺寸缺失');const v=Buffer.alloc(18);v.write('VP8X');v.writeUInt32LE(10,4);v[8]=4|(alpha?16:0);v.writeUIntLE(width-1,12,3);v.writeUIntLE(height-1,15,3);chunks.unshift(v);}
    const meta=Buffer.alloc(8);meta.write('XMP ');meta.writeUInt32LE(xml.length,4);chunks.push(meta,xml,...(xml.length%2?[Buffer.alloc(1)]:[]));const body=Buffer.concat([Buffer.from('WEBP'),...chunks]),head=Buffer.alloc(8);head.write('RIFF');head.writeUInt32LE(body.length,4);return Buffer.concat([head,body]);
  }
  throw Error('图片格式未支持隐式标识，未交付未标识图片');
}
