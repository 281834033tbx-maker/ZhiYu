/** Only the top-bar recorder opts in. Ordinary chat keeps its existing manual
 * stop and sixty-second limit. Time and energy are injectable for local QA. */
export function createRecordingPauseDetector(startedAt:number,{silenceMs=1400,emptyMs=8000,threshold=.012}={}) {
 let lastSpeech=0;
 return (at:number,rms:number)=>{
  if(rms>=threshold)lastSpeech=at;
  return lastSpeech>0?at-lastSpeech>=silenceMs:at-startedAt>=emptyMs;
 };
}
