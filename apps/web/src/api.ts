const PREFIX='/api';
export const getToken=()=>sessionStorage.getItem('f1-session')||'';
export function setToken(token:string|null){if(token)sessionStorage.setItem('f1-session',token);else sessionStorage.removeItem('f1-session')}
export class ApiError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
export async function request<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);headers.set('Content-Type','application/json');if(getToken())headers.set('Authorization',`Bearer ${getToken()}`);
 const res=await fetch(PREFIX+path,{...options,headers});let data:any;try{data=await res.json()}catch{throw new ApiError(res.status,'Unexpected server response')}
 if(!res.ok)throw new ApiError(res.status,data.error??`Request failed (${res.status})`);return data as T;
}
export const get=<T=any>(p:string)=>request<T>(p);
export const post=<T=any>(p:string,b:any)=>request<T>(p,{method:'POST',body:JSON.stringify(b)});
export const put=<T=any>(p:string,b:any)=>request<T>(p,{method:'PUT',body:JSON.stringify(b)});
export const patch=<T=any>(p:string,b:any)=>request<T>(p,{method:'PATCH',body:JSON.stringify(b)});
export const money=(c:number,currency='EUR')=>new Intl.NumberFormat('en-IE',{style:'currency',currency}).format((c??0)/100);
export const date=(iso:string)=>iso?new Date(iso).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):'—';
