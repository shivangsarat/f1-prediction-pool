import {backup, type DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {dirname,resolve,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {db} from './db.ts';
const exec=promisify(execFile);
export interface BackupOutcome{location:string;encrypted:boolean;offsite:boolean;warning?:string}
/** Consistent SQLite backup (includes WAL writes) followed by optional authenticated encryption. */
export async function createBackup():Promise<BackupOutcome>{
 const dir=resolve(process.env.BACKUP_DIR??'./backups');mkdirSync(dir,{recursive:true,mode:0o700});
 const prefix=`pool-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`;
 const temp=resolve(dir,`${prefix}.sqlite`);let out=temp;
 try{
  await backup(db,temp);
  const keyString=process.env.BACKUP_ENCRYPTION_KEY??'';
  let encrypted=false;
  if(keyString){
   if(!/^[a-fA-F0-9]{64}$/.test(keyString))throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
   const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(keyString,'hex'),iv);
   const compressed=gzipSync(readFileSync(temp));const ciphertext=Buffer.concat([cipher.update(compressed),cipher.final()]);
   out=resolve(dir,`${prefix}.sqlite.gz.enc`);
   // Framing: F1BK v1 header, 12-byte IV, 16-byte GCM tag, encrypted gzipped SQLite data.
   writeFileSync(out,Buffer.concat([Buffer.from('F1BK\x01'),iv,cipher.getAuthTag(),ciphertext]),{mode:0o600});
   unlinkSync(temp);encrypted=true;
  }
  const remote=process.env.BACKUP_RCLONE_REMOTE;
  if(!remote)return {location:out,encrypted,offsite:false,warning:'Offsite destination not configured'};
  if(!encrypted)return {location:out,encrypted:false,offsite:false,warning:'Set BACKUP_ENCRYPTION_KEY before enabling offsite uploads'};
  try{await exec('rclone',['copyto',out,remote.replace(/\/$/,'')+'/'+basename(out)],{timeout:60000});return {location:out,encrypted:true,offsite:true}}
  catch(e:any){return {location:out,encrypted:true,offsite:false,warning:`Offsite upload failed: ${e.message}`}}
 }catch(e){if(existsSync(temp))unlinkSync(temp);throw e}
}
