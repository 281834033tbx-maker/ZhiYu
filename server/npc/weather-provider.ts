import type {ReportCity,ReportWeather} from '../../lib/npc/experience';
export type WeatherProvider={lookup:(query:string,source:ReportCity['source'])=>Promise<ReportCity|undefined>;forecast:(city:ReportCity,date:string)=>Promise<ReportWeather|undefined>;ipCity:()=>Promise<ReportCity|undefined>};
type Json=Record<string,unknown>;
const object=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};
const numeric=(v:unknown)=>typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN;
/** Current official QWeather dedicated-host API. Credentials stay in request headers. */
export function createWeatherProvider(env:NodeJS.ProcessEnv=process.env,request:typeof fetch=fetch):WeatherProvider {
 const key=env.WEATHER_API_KEY,host=env.WEATHER_API_HOST;
 const enabled=!!key&&!!host&&/^[a-z0-9.-]+\.qweatherapi\.com$/i.test(host);
 const read=async(url:string,headers:Record<string,string>={})=>{const response=await request(url,{headers,signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)return {};return object(await response.json());};
 const lookup=async(query:string,source:ReportCity['source']):Promise<ReportCity|undefined>=>{
  if(!enabled)return;
  try{const result=await read(`https://${host}/geo/v2/city/lookup?location=${encodeURIComponent(query)}&range=cn&number=1&lang=zh`,{'X-QW-Api-Key':key!});
   const row=object(Array.isArray(result.location)?result.location[0]:undefined),latitude=numeric(row.lat),longitude=numeric(row.lon);
   if(result.code!=='200'||typeof row.name!=='string'||!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
   return {name:typeof row.adm2==='string'&&row.adm2?row.adm2:row.name,source,locationId:typeof row.id==='string'?row.id:undefined,latitude,longitude};
  }catch{return;}
 };
 return {lookup,async forecast(city,date){
  if(!enabled)return;
  let place=city;if(!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude)){const found=await lookup(city.locationId||city.name,city.source);if(!found)return;place=found;}
  try{const data=await read(`https://${host}/weather/v1/daily/${place.latitude!.toFixed(2)}/${place.longitude!.toFixed(2)}?days=1&localTime=true&lang=zh`,{'X-QW-Api-Key':key!});
   const row=object(Array.isArray(data.days)?data.days.find(value=>(typeof object(value).forecastStartTime==='string'&&(object(value).forecastStartTime as string).slice(0,10)===date))||data.days[0]:undefined);
   const min=numeric(object(row.temperatureMin).value),max=numeric(object(row.temperatureMax).value),condition=object(object(row.daytime).condition),text=condition.text;
   if(!Number.isFinite(min)||!Number.isFinite(max)||typeof text!=='string'||min>max)return;
   return {min,max,text,icon:typeof condition.code==='string'?condition.code:typeof condition.code==='number'?String(condition.code):'',summary:text,attribution:'和风天气',url:'https://www.qweather.com/'};
  }catch{return;}
 },async ipCity(){
  // Called only after the user chooses location and system location is unavailable.
  // The provider sees the local host's public IP; no account/history is transmitted.
  try{const row=await read('https://ipapi.co/json/'),latitude=numeric(row.latitude),longitude=numeric(row.longitude);
   if(row.error||typeof row.city!=='string'||!row.city.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
   return {name:row.city.slice(0,40),latitude,longitude,source:'ip'};
  }catch{return;}
 }};
}
export function parseReportCity(value:unknown):ReportCity|undefined {
 const row=object(value);
 if(typeof row.name!=='string'||!row.name.trim()||Array.from(row.name.trim()).length>40||/[<>\r\n]/.test(row.name)||!['manual','geolocation','ip'].includes(String(row.source)))return;
 const latitude=numeric(row.latitude),longitude=numeric(row.longitude);
 if(row.latitude!==undefined&&(!Number.isFinite(latitude)||latitude<-90||latitude>90)||row.longitude!==undefined&&(!Number.isFinite(longitude)||longitude<-180||longitude>180))return;
 return {name:row.name.trim(),source:row.source as ReportCity['source'],...(Number.isFinite(latitude)&&Number.isFinite(longitude)?{latitude,longitude}:{}),...(typeof row.locationId==='string'&&/^\d{5,20}$/.test(row.locationId)?{locationId:row.locationId}:{})};
}
