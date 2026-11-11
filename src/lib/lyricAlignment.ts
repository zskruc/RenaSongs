import type { SongLyrics } from '@/api/subsonic';
export interface AlignmentLine { id:string;text:string;start?:number;end?:number; }
export function alignmentLines(document:SongLyrics,duration:number):AlignmentLine[]{
 if(!Number.isFinite(duration)||duration<=0||duration>600||!document.lines.length||document.lines.length>500)throw new Error('Alignment supports up to ten minutes and 500 lyric lines');
 if(document.lines.some(line=>line.value.length>2000)||document.lines.reduce((n,line)=>n+line.value.length,0)>30000)throw new Error('Lyrics are too large for alignment');
 let previous=0;const timed=document.synced&&document.lines.every(line=>line.start!==undefined);
 return document.lines.map((line,index)=>{const start=timed?line.start!/1000:undefined,end=timed?(document.lines[index+1]?.start??duration*1000)/1000:undefined;
 if(start!==undefined&&(!Number.isFinite(start)||start<previous||start>=duration||end!<=start||end!>duration+.01))throw new Error('Check the existing lyric timestamps before alignment');if(start!==undefined)previous=start;
 return {id:String(index),text:line.value,...(start===undefined?{}:{start,end})};});
}
export function applyLyricAlignment(document:SongLyrics,request:readonly AlignmentLine[],output:unknown,duration:number):SongLyrics{
 const rows=(output as {lines?:unknown[]})?.lines;if(!Array.isArray(rows)||rows.length!==request.length)throw new Error('Alignment response does not match the requested lyrics');
 const seen=new Set<string>(),result=document.lines.map(line=>({...line,words:line.words?.map(word=>({...word}))}));let aligned=0,previousEnd=0,words=0;
 for(let index=0;index<rows.length;index++){const row=rows[index] as {id?:unknown;status?:unknown;words?:unknown[]},source=request[index];if(String(row?.id)!==source.id||seen.has(source.id))throw new Error('Alignment returned a different lyric order');seen.add(source.id);
 if(row.status==='unaligned'){if(row.words?.length)throw new Error('Unaligned lyrics contain word times');previousEnd=source.end??previousEnd;continue;}
 if(!Array.isArray(row.words)||!row.words.length||(words+=row.words.length)>12000)throw new Error('Alignment has invalid word timing');
 const entries=row.words.map(value=>{const word=value as {text?:unknown;value?:unknown;start?:unknown;end?:unknown},text=word.text??word.value,start=Number(word.start),end=Number(word.end);
 if(typeof text!=='string'||!text||!Number.isFinite(start)||!Number.isFinite(end)||start<Math.max(previousEnd,source.start??0)-.001||end<=start||end>(source.end??duration)+.001)throw new Error('Word timing is outside its lyric window');previousEnd=end;return {value:text,start:Math.round(start*1000),end:Math.round(end*1000)};});
 if(entries.map(word=>word.value).join('')!==source.text)throw new Error('Alignment changed the lyric text');
 result[index]={...result[index],start:entries[0].start,words:entries};previousEnd=source.end??previousEnd;aligned++;
 }
 if(!aligned)throw new Error('No lyric lines could be aligned');return {...document,synced:true,lines:result};
}
export function alignmentPayload(body:string):unknown{
 try{const object=JSON.parse(body);if(object.lines)return object;if(object.data?.lines)return object.data;if(object.output?.lines)return object.output;}catch{/* Streaming replies below. */}
 let result:unknown;
 for(const line of body.split(/\r?\n/)){const text=line.replace(/^data:\s*/,'').trim();if(!text||text==='[DONE]')continue;let row:any;try{row=JSON.parse(text);}catch{continue;}
 if(row.type==='error'||row.event==='error')throw new Error(String(row.message??row.error?.message??'Alignment service failed'));
 const candidate=row.data??row.output??row.result??row;if(candidate?.lines&&(row.type==='completed'||row.event==='completed'||row.type==='result'||row.event==='result'||row.lines))result=candidate;
 }
 if(!result)throw new Error('Alignment service did not return completed word timing');return result;
}
