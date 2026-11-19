/** Offline preview suggestions, not a system IME. Dictionary is loaded only
 * when the desktop preview keyboard opens; no draft is sent to a service. */
export type PreviewPinyinCandidate={text:string;reading:string;consumed:number};
type Word={text:string;reading:string;key:string;weight:number;boundaries:number[]};
type Path={text:string;reading:string;score:number};

export function normalizePreviewPinyin(value:string){
 return value.toLowerCase().replaceAll('ü','v').replace(/[^a-z']/g,'').replace(/'{2,}/g,"'").slice(0,64);
}

export function createPreviewPinyinDictionary(source:string){
 const words=new Map<string,Word[]>();let count=0;
 for(const line of source.split(/\r?\n/)){
  const [text,reading,frequency]=line.split('\t');
  if(!text||!reading||!/^\d+$/.test(frequency||'')||!/^[a-z]+(?: [a-z]+)*$/.test(reading))continue;
  const syllables=reading.split(' '),key=syllables.join(''),boundaries:number[]=[];let offset=0;
  for(const syllable of syllables.slice(0,-1)){offset+=syllable.length;boundaries.push(offset);}
  const word={text,reading,key,weight:Number(frequency),boundaries},existing=words.get(key);
  if(existing)existing.push(word);else words.set(key,[word]);count++;
 }
 if(count<60000)throw Error('离线拼音词库不完整');
 for(const list of words.values())list.sort((a,b)=>b.weight-a.weight);
 const keys=Array.from(words.keys()).sort(),maxWordLength=keys.reduce((longest,key)=>Math.max(longest,key.length),0);
 const lowerBound=(key:string)=>{let lo=0,hi=keys.length;while(lo<hi){const mid=(lo+hi)>>>1;if(keys[mid]<key)lo=mid+1;else hi=mid;}return lo;};
 function candidates(raw:string,limit=30):PreviewPinyinCandidate[]{
  const input=normalizePreviewPinyin(raw),letters=input.replaceAll("'",'');if(!letters)return [];
  const boundaries=new Set<number>();let position=0;
  for(const char of input){if(char==="'")boundaries.add(position);else position++;}
  const accepts=(word:Word,start:number)=>{for(const boundary of boundaries)if(boundary>start&&boundary<start+word.key.length&&!word.boundaries.includes(boundary-start))return false;return true;};
  const consumed=(length:number)=>{let offset=0,n=0;while(offset<input.length&&n<length){if(input[offset]!=="'")n++;offset++;}while(input[offset]==="'")offset++;return offset;};
  const output:PreviewPinyinCandidate[]=[],seen=new Set<string>();
  const add=(text:string,reading:string,length:number)=>{const identity=text+'\0'+length;if(!seen.has(identity)){seen.add(identity);output.push({text,reading,consumed:consumed(length)});}};
  // Full phrase matches keep the source dictionary's frequency order.
  for(const word of words.get(letters)||[])if(accepts(word,0))add(word.text,word.reading,letters.length);
  // A bounded unigram beam permits continuous sentences across dictionary words.
  const paths:Path[][]=Array.from({length:letters.length+1},()=>[]);paths[letters.length]=[{text:'',reading:'',score:0}];
  for(let start=letters.length-1;start>=0;start--){
   const choices:Path[]=[];
   for(let end=start+1;end<=Math.min(letters.length,start+maxWordLength);end++){
    if(!paths[end].length)continue;
    for(const word of (words.get(letters.slice(start,end))||[]).slice(0,3))if(accepts(word,start))for(const tail of paths[end])choices.push({text:word.text+tail.text,reading:word.reading+(tail.reading?' '+tail.reading:''),score:Math.log(word.weight+1)-18+tail.score});
   }
   const unique=new Set<string>();paths[start]=choices.sort((a,b)=>b.score-a.score).filter(path=>{if(unique.has(path.text))return false;unique.add(path.text);return true;}).slice(0,5);
  }
  for(const path of paths[0])add(path.text,path.reading,letters.length);
  // An unfinished last syllable can suggest a whole word. The reading remains
  // visible, so selecting it is an explicit completion, never an auto-commit.
  const completions:Word[]=[];
  for(let i=lowerBound(letters);i<keys.length&&keys[i].startsWith(letters);i++)for(const word of words.get(keys[i])||[])if(accepts(word,0))completions.push(word);
  completions.sort((a,b)=>b.weight-a.weight);
  for(const word of completions.slice(0,limit))add(word.text,word.reading,letters.length);
  // Keep valid prefix selection available when a later syllable is mistyped.
  for(let end=letters.length-1;end>0;end--){const list=(words.get(letters.slice(0,end))||[]).filter(word=>accepts(word,0));if(list.length){for(const word of list.slice(0,6))add(word.text,word.reading,end);break;}}
  return output.slice(0,limit);
 }
 return {count,candidates};
}

export type PreviewPinyinDictionary=ReturnType<typeof createPreviewPinyinDictionary>;
let dictionaryPromise:Promise<PreviewPinyinDictionary>|undefined;
export function loadPreviewPinyinDictionary(){
 dictionaryPromise??=fetch('/ime/rime-pinyin-simp/pinyin_simp.dict.yaml').then(async response=>{if(!response.ok)throw Error('离线拼音词库暂时未能载入');return createPreviewPinyinDictionary(await response.text());}).catch(error=>{dictionaryPromise=undefined;throw error;});
 return dictionaryPromise;
}
