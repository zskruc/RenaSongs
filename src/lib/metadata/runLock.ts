/** One explicit metadata apply worker across the single-song and library UIs. */
let active:{kind:'single'|'bulk';id:string;current:()=>boolean;token:object}|undefined;
export function metadataRunIsBusy():boolean{return !!active?.current();}
export function claimMetadataRun(kind:'single'|'bulk',id:string,current:()=>boolean):()=>void{
 if(active?.current())throw new Error('A metadata task is already running');
 const token={};active={kind,id,current,token};return()=>{if(active?.token===token)active=undefined;};
}
