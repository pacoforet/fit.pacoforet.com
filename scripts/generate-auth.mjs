#!/usr/bin/env node
// Generates FIT_PASSWORD_HASH (PBKDF2-SHA256 with random salt) for the login endpoint.
// Usage: npm run auth:hash                       -> asks for user and password (password hidden)
//        npm run auth:hash <usuario>            -> asks only for the password
//        npm run auth:hash <usuario> <password> -> non-interactive (stays in shell history)
import crypto from 'crypto';
import readline from 'readline';

const ITERATIONS = 210000;
const [,, userArg, passArg] = process.argv;

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const user = (userArg ?? await ask('Usuario: ')).trim();
if (!user) {
  console.error('\nEl usuario no puede estar vacío.\n');
  process.exit(1);
}
console.log(`Generando hash para el usuario "${user}" (distingue mayúsculas).`);
const pass = (passArg ?? await ask('Contraseña: ', true)).trim();

if (pass.length < 10) {
  console.error('\nLa contraseña debe tener al menos 10 caracteres.\n');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const salt = crypto.randomBytes(16);
const derived = crypto.pbkdf2Sync(`${user}:${pass}`, salt, ITERATIONS, 32, 'sha256');
const hash = `pbkdf2-sha256:${ITERATIONS}:${b64url(salt)}:${b64url(derived)}`;

console.log('\n========================================');
console.log('🔐 Hash PBKDF2 generado con éxito');
console.log('========================================');
console.log(`Usuario:     ${user}`);
console.log(`Contraseña:  ${'*'.repeat(pass.length)}\n`);
console.log('Añade esta variable en Vercel (Production y Preview, tipo Sensitive) o en tu .env:');
console.log(`FIT_PASSWORD_HASH=${hash}\n`);
console.log('No la publiques: nunca debe llevar el prefijo PUBLIC_.\n');
