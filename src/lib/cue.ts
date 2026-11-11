/** CUE indexes describe virtual tracks; no audio file is split or rewritten. */
import type { Song } from '@/api/subsonic';
export interface CueTrack { file: string; number: number; title: string; artist?: string; album?: string; albumArtist?: string; year?: number; genre?: string; start: number; end?: number; replayGain?: Song['replayGain']; }
function value(text: string): string { const input=text.trim(); return input.startsWith('"')&&input.endsWith('"')?input.slice(1,-1):input; }
function index(text: string): number { const match=text.match(/^(\d{1,5}):(\d{2}):(\d{2})$/); if(!match||+match[2]>=60||+match[3]>=75)throw new Error('Invalid CUE index'); return +match[1]*60 + +match[2] + +match[3]/75; }
export function cueFileName(path: string): string { return path.replace(/\\/g,'/').split('/').pop()!.normalize('NFC').toLowerCase(); }
export function parseCue(text: string): CueTrack[] {
  if(text.length>1024*1024)throw new Error('CUE sheet is too large');
  let file='',album='',artist='',year:number|undefined,genre:string|undefined,current:Partial<CueTrack>|undefined;
  let albumGain:number|undefined,albumPeak:number|undefined; const tracks:Partial<CueTrack>[]=[];
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trim(); if(!line)continue;
    let match=line.match(/^FILE\s+("[^"]+"|.+?)\s+(?:WAVE|MP3|AIFF|BINARY|MOTOROLA)$/i);
    if(match){file=value(match[1]);current=undefined;continue;}
    match=line.match(/^TRACK\s+(\d+)\s+(\S+)/i);
    if(match){if(match[2].toUpperCase()!=='AUDIO'){current=undefined;continue;} if(!file)throw new Error('CUE track has no file');current={file,number:+match[1],album,albumArtist:artist,artist,year,genre,replayGain:{...(albumGain===undefined?{}:{albumGain}),...(albumPeak===undefined?{}:{albumPeak})}};tracks.push(current);continue;}
    match=line.match(/^(TITLE|PERFORMER)\s+(.+)$/i);
    if(match){const text=value(match[2]);if(current){if(match[1].toUpperCase()==='TITLE')current.title=text;else current.artist=text;}else if(match[1].toUpperCase()==='TITLE')album=text;else artist=text;continue;}
    match=line.match(/^INDEX\s+01\s+(\S+)/i);if(match&&current){if(current.start!==undefined)throw new Error('Duplicate CUE INDEX 01');current.start=index(match[1]);continue;}
    match=line.match(/^REM\s+(DATE|GENRE|REPLAYGAIN_TRACK_GAIN|REPLAYGAIN_TRACK_PEAK|REPLAYGAIN_ALBUM_GAIN|REPLAYGAIN_ALBUM_PEAK)\s+(.+)$/i);
    if(match){const field=match[1].toUpperCase(),text=value(match[2]),number=parseFloat(text);
      if(field==='DATE'){const n=parseInt(text,10);if(n>=1000&&n<=3000){if(current)current.year=n;else year=n;}}
      else if(field==='GENRE'){if(current)current.genre=text;else genre=text;}
      else if(Number.isFinite(number)){
        const key=field.endsWith('TRACK_GAIN')?'trackGain':field.endsWith('TRACK_PEAK')?'trackPeak':field.endsWith('ALBUM_GAIN')?'albumGain':'albumPeak';
        if(key.endsWith('Peak')&&number<=0)continue;if(key.endsWith('Gain')&&Math.abs(number)>60)continue;
        if(current)current.replayGain={...current.replayGain,[key]:number};else if(key==='albumGain')albumGain=number;else if(key==='albumPeak')albumPeak=number;
      }
    }
  }
  if(!tracks.length||tracks.length>500)throw new Error('CUE sheet has no supported audio tracks');
  const result=tracks.map((item)=>{if(item.start===undefined||!item.file||!item.number)throw new Error('Every CUE track needs INDEX 01');return {...item,title:item.title||`Track ${item.number}`} as CueTrack;});
  const last=new Map<string,number>();for(let i=0;i<result.length;i++){const item=result[i],key=cueFileName(item.file),previous=last.get(key);if(previous!==undefined&&item.start<=previous)throw new Error('CUE indexes must increase within each file');last.set(key,item.start);const next=result[i+1];if(next&&cueFileName(next.file)===key)item.end=next.start;}
  return result;
}
export function cueSongs(tracks:readonly CueTrack[],files:Readonly<Record<string,{uri:string;id:string}>>,catalogId:string):Song[] {
  return tracks.map((track,index)=>{const file=files[cueFileName(track.file)];if(!file||!/^file:\/\//.test(file.uri))throw new Error('Select every audio file referenced by the CUE sheet');
    return {id:`cue:${catalogId}:${index+1}`,title:track.title,artist:track.artist,album:track.album,albumArtist:track.albumArtist,year:track.year,genre:track.genre,track:track.number,
      localUri:file.uri,url:file.uri,vod:true,mediaKind:'music',cueSourceId:file.id,cueStartSec:track.start,...(track.end===undefined?{}:{cueEndSec:track.end,duration:track.end-track.start}),replayGain:track.replayGain};});
}

/** Embedded/sidecar timestamps belong to the physical disc, not each virtual track. */
export function clipCueLyrics(song: Song, lyrics: import('@/api/subsonic').SongLyrics | null): import('@/api/subsonic').SongLyrics | null {
  if (!song.cueSourceId || !lyrics) return lyrics;
  if (!lyrics.synced) return null; // A full-disc plain document cannot be attributed to one track.
  const start = (song.cueStartSec ?? 0) * 1000, end = (song.cueEndSec ?? Infinity) * 1000;
  const lines = lyrics.lines.filter((line) => typeof line.start === 'number' && line.start >= start && line.start < end).map((line) => ({
    ...line, start: line.start! - start,
    ...(line.words ? { words: line.words.filter((word) => word.start >= start && word.start < end).map((word) => ({ ...word, start: word.start-start, ...(word.end === undefined ? {} : { end: Math.min(word.end,end)-start }) })) } : {}),
  }));
  return lines.length ? { synced: true, lines } : null;
}
