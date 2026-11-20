/** Offline restore: node scripts/restore-backup.mjs <backup-file> <destination-sqlite> */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createDecipheriv} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const [source,target]=process.argv.slice(2);
if(!source||!target){console.error('Usage: node scripts/restore-backup.mjs <encrypted-backup> <new-database-file>');process.exit(1)}
const src=resolve(source),dest=resolve(target);
if(existsSync(dest)){console.error('Target already exists; stop the server and choose an empty target path.');process.exit(1)}
const blob=readFileSync(src);let plain;
if(blob.subarray(0,5).toString()==='F1BK\x01'){
 const key=process.env.BACKUP_ENCRYPTION_KEY;
 if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new Error('Set the original 64-hex-character BACKUP_ENCRYPTION_KEY');
 const iv=blob.subarray(5,17),tag=blob.subarray(17,33),encrypted=blob.subarray(33);
 const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);d.setAuthTag(tag);
 plain=gunzipSync(Buffer.concat([d.update(encrypted),d.final()]));
}else if(src.endsWith('.sqlite'))plain=blob;
else throw new Error('Unrecognized backup format');
if(plain.subarray(0,16).toString()!=='SQLite format 3\0')throw new Error('Backup is not an SQLite database');
mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,plain,{flag:'wx',mode:0o600});
console.log(`Restored SQLite backup into ${dest}. Before starting, ensure no stale -wal/-shm files remain from a previous database.`);
