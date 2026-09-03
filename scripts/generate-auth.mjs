#!/usr/bin/env node
import crypto from 'crypto';

const [,, user, pass] = process.argv;

if (!user || !pass) {
  console.log('\nUso: npm run auth:hash <usuario> <contraseña>');
  console.log('Ejemplo: npm run auth:hash admin mipassword123\n');
  process.exit(1);
}

const input = `${user.trim()}:${pass.trim()}`;
const hash = crypto.createHash('sha256').update(input).digest('hex');

console.log('\n========================================');
console.log('🔐 Hash SHA-256 generado con éxito');
console.log('========================================');
console.log(`Usuario:     ${user}`);
console.log(`Contraseña:  ${'*'.repeat(pass.length)}`);
console.log(`Hash:        ${hash}\n`);
console.log('Copia esta línea en tu archivo .env o en las variables de entorno de Vercel:');
console.log(`FIT_AUTH_HASH=${hash}`);
console.log(`PUBLIC_AUTH_HASH=${hash}\n`);
