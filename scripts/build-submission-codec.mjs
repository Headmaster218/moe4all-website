import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = require(process.env.MOE4ALL_BUILD_MODULES ? path.join(process.env.MOE4ALL_BUILD_MODULES, 'esbuild') : 'esbuild');
const pakoPackage = require.resolve(process.env.MOE4ALL_CODEC_MODULES ? path.join(process.env.MOE4ALL_CODEC_MODULES, 'pako/package.json') : 'pako/package.json');
const pakoRoot = path.dirname(pakoPackage);
if (JSON.parse(await fs.readFile(pakoPackage, 'utf8')).version !== '3.0.2') throw new Error('Expected pinned pako 3.0.2');
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--output') || !output || !path.isAbsolute(output)) throw new Error('Pass --output with an explicit absolute staging path');
await esbuild.build({ entryPoints: [path.join(root, 'backend/gzip-source.mjs')], bundle: true, format: 'esm', minify: true, platform: 'browser', alias: { pako: path.join(pakoRoot, 'dist/pako.mjs') }, outfile: output, legalComments: 'inline', banner: { js: '/*! Pako 3.0.2 with MoE4All single-member wrapper. MIT AND Zlib; see pako-LICENSE and pako-ZLIB-LICENSE. */' } });
await fs.copyFile(path.join(pakoRoot, 'LICENSE'), path.join(path.dirname(output), 'pako-LICENSE'));
await fs.copyFile(path.join(root, 'community/vendor/pako-ZLIB-LICENSE'), path.join(path.dirname(output), 'pako-ZLIB-LICENSE'));
console.log('Generated bounded single-member gzip decoder and license in the selected staging directory.');
