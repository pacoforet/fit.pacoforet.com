#!/usr/bin/env node
// Generates FIT_PASSWORD_HASH (PBKDF2-SHA256 with random salt) for the login endpoint.
// Usage: npm run auth:hash <usuario>            -> asks for the password without echoing it
//        npm run auth:hash <usuario> <password> -> non-interactive (stays in shell history)
import crypto from 'crypto';
import readline from 'readline';

const ITERATIONS = 210000;
const [,, userArg, passArg] = process.argv;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

if (!userArg) {
  console.log('\nUso: npm run auth:hash <usuario> [contraseña]');
  console.log('Si omites la contraseña se pedirá sin mostrarla en pantalla.\n');
  process.exit(1);
}

const user = userArg.trim();
const pass = (passArg ?? await askHidden('Contraseña: ')).trim();

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
