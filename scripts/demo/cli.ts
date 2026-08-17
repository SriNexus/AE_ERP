import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function isMainModule(url:string,argv=process.argv){return Boolean(argv[1])&&resolve(fileURLToPath(url))===resolve(argv[1])}
