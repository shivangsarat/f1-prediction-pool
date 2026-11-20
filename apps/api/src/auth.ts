import {randomBytes,scryptSync,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {get,run,transaction} from './db.ts';
import {utcNow} from '../../../packages/core/src/index.ts';
import type {IncomingMessage} from 'node:http';
export class HttpError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
export const bad=(message:string)=>new HttpError(400,message);
export const forbidden=(message='Forbidden')=>new HttpError(403,message);
export function passwordHash(pass:string):string{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(pass,salt,64).toString('hex')}
function checkPassword(pass:string,stored:string):boolean{try{const [salt,hash]=stored.split(':');const a=scryptSync(pass,salt,64),b=Buffer.from(hash,'hex');return a.length===b.length&&timingSafeEqual(a,b)}catch{return false}}
function tokenHash(token:string){return createHash('sha256').update(token).digest('hex')}
export type User={id:string;email:string;display_name:string;role:string};
export function register(email:string,name:string,password:string,bootstrapKey?:string){
 email=typeof email==='string'?email.trim().toLowerCase():'';name=typeof name==='string'?name.trim():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<2||name.length>80||typeof password!=='string'||password.length<12||password.length>256)throw bad('Valid email, name (2–80), and password (12+ characters) required');
 const isAdmin=email===process.env.ADMIN_EMAIL?.toLowerCase();
 if(isAdmin && (!process.env.ADMIN_BOOTSTRAP_KEY||bootstrapKey!==process.env.ADMIN_BOOTSTRAP_KEY))throw forbidden('Admin registration requires a valid bootstrap key');
 const user:User={id:randomUUID(),email,display_name:name,role:isAdmin?'admin':'participant'};
 try{transaction(()=>{run('INSERT INTO users(id,email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',user.id,user.email,user.display_name,passwordHash(password),user.role,utcNow())})}catch(err:any){if(/UNIQUE/.test(String(err)))throw new HttpError(409,'Email already registered');throw err}return {user,...newSession(user.id)};
}
export function login(email:string,password:string){const user=get('SELECT * FROM users WHERE email=?',String(email??'').trim().toLowerCase());if(!user||!checkPassword(String(password??''),user.password_hash))throw new HttpError(401,'Incorrect email or password');return {user:{id:user.id,email:user.email,display_name:user.display_name,role:user.role},...newSession(user.id)};}
export function newSession(userId:string){const token=randomBytes(32).toString('base64url');run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',tokenHash(token),userId,new Date(Date.now()+7*86400_000).toISOString());return {token,expiresAt:new Date(Date.now()+7*86400_000).toISOString()}}
export function auth(req:IncomingMessage):User{
 const header=req.headers.authorization??'',token=/^Bearer (.+)$/i.exec(header)?.[1];if(!token)throw new HttpError(401,'Authentication required');
 const user=get('SELECT u.id,u.email,u.display_name,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',tokenHash(token),utcNow());if(!user)throw new HttpError(401,'Session expired or invalid');return user as User;
}
export function logout(req:IncomingMessage){const t=/^Bearer (.+)$/i.exec(req.headers.authorization??'')?.[1];if(t)run('DELETE FROM sessions WHERE token_hash=?',tokenHash(t))}
export const requireAdmin=(u:User)=>{if(u.role!=='admin')throw forbidden('Commissioner privileges required')};
